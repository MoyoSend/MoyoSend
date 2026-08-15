import { prisma } from "../../db/client";
import { logger } from "../../utils/logger";
import { createQuote } from "../fx/fx.service";
import { dispatchPayout } from "../payout/payout.service";
import { verifyPaymentIntent, refundPaymentIntent } from "../payments/payment.service";
import { sendTransferSentEmail, sendTransferCompletedEmail, sendTransferRefundedEmail } from "../email/email.service";
import {
  getOrCreateSystemAccount,
  getOrCreateUserWallet,
  postLedgerEntries,
  getAccountBalance,
} from "../ledger/ledger.service";
import type { TransactionStatus } from "@prisma/client";

function formatMoney(amountMinor: bigint, currency: string): string {
  return `${(Number(amountMinor) / 100).toFixed(2)} ${currency}`;
}

export class InsufficientFundsError extends Error {
  constructor() {
    super("Sender wallet balance is insufficient for this transaction");
    this.name = "InsufficientFundsError";
  }
}

export class ComplianceHoldError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Transaction placed on compliance hold: ${reasons.join(", ")}`);
    this.name = "ComplianceHoldError";
  }
}

interface CreateTransactionInput {
  idempotencyKey: string;
  senderId: string;
  recipientId: string;
  corridorId: string;
  sendAmountMinor: bigint;
  paymentIntentId?: string;
  payFromWallet?: boolean;
}

/**
 * Record a new status event alongside the status column update, in the same
 * DB transaction, so the two never drift apart. This is what lets support
 * and audit reconstruct exactly what happened to any transaction (see
 * architecture doc section 6.5).
 */
async function transitionStatus(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  transactionId: string,
  fromStatus: TransactionStatus | null,
  toStatus: TransactionStatus,
  actor: string,
  reason?: string
) {
  await tx.transaction.update({ where: { id: transactionId }, data: { status: toStatus } });
  await tx.transactionStatusEvent.create({
    data: { transactionId, fromStatus, toStatus, actor, reason },
  });
}

// e.g. £5,000.00 in pence — tune per corridor/risk tier. Exported so the
// /transactions/limits endpoint can show users the exact number this
// actually enforces, instead of a UI guessing at a different figure.
export const DAILY_VELOCITY_LIMIT_MINOR = 500_000n;

// Fixed bump applied when a limit-increase request is approved (see
// kyc.service.ts). A verified proof-of-funds document tells us it's
// genuine, not what the "right" new limit is, so this is a flat tier
// rather than something computed from the document — tune as needed.
export const INCREASED_DAILY_LIMIT_MINOR = DAILY_VELOCITY_LIMIT_MINOR * 3n;

/**
 * Very simple compliance placeholder: real velocity/sanctions/PEP screening
 * belongs in modules/kyc + a dedicated risk-scoring service, and should run
 * for every transaction, not just be a TODO. This function is the single
 * choke point where that screening plugs in.
 */
export async function runComplianceScreening(
  senderId: string,
  sendCurrency: string,
  sendAmountMinor: bigint
): Promise<string[]> {
  const flags: string[] = [];

  const sender = await prisma.user.findUniqueOrThrow({ where: { id: senderId } });
  if (sender.kycStatus !== "APPROVED") {
    flags.push("KYC_NOT_APPROVED");
  }

  // Velocity check: flag if this user has sent more than a threshold in the
  // last 24h, in this same currency. Scoped to a single currency
  // deliberately — summing amounts across different currencies (e.g. GBP
  // pence + USD cents) as one raw number would be meaningless, since a
  // minor unit isn't worth the same amount in every currency. Uses the
  // user's personal override if an approved limit-increase request has set
  // one, otherwise falls back to the global default.
  const effectiveLimitMinor = sender.dailyLimitOverrideMinor ?? DAILY_VELOCITY_LIMIT_MINOR;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.transaction.aggregate({
    where: {
      senderId,
      sendCurrency,
      createdAt: { gte: since },
      status: { notIn: ["FAILED", "REJECTED", "REFUNDED"] },
    },
    _sum: { sendAmount: true },
  });
  const dailyTotal = (recent._sum.sendAmount ?? 0n) + sendAmountMinor;
  if (dailyTotal > effectiveLimitMinor) {
    flags.push("VELOCITY_LIMIT_EXCEEDED");
  }

  return flags;
}

/**
 * Create + fully process a transaction end to end. In production this
 * would likely be split across async steps (quote -> confirm -> webhook-
 * driven payout confirmation) rather than one synchronous call, but the
 * state machine and ledger discipline are the same either way.
 */
export async function createAndProcessTransaction(input: CreateTransactionInput) {
  // Idempotency: if a transaction with this key already exists, return it
  // instead of creating a duplicate. This must be enforced at the DB level
  // via the unique constraint on idempotencyKey, not just checked-then-created.
  const existing = await prisma.transaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    logger.info({ transactionId: existing.id }, "transactions.idempotent_replay");
    return existing;
  }

  const corridor = await prisma.corridor.findUniqueOrThrow({ where: { id: input.corridorId } });
  if (!corridor.enabled) throw new Error("Corridor is not currently enabled");
  if (input.sendAmountMinor < corridor.minSendMinor || input.sendAmountMinor > corridor.maxSendMinor) {
    throw new Error("Send amount is outside the corridor's configured limits");
  }

  const quote = await createQuote(corridor.sendCurrency, corridor.receiveCurrency, corridor.fxMarginBps);
  const feeAmountMinor =
    corridor.feeFlatMinor + (input.sendAmountMinor * BigInt(corridor.feeBps)) / 10_000n;
  const receiveAmountMinor = BigInt(Math.floor(Number(input.sendAmountMinor) * quote.appliedRate));

  const transaction = await prisma.transaction.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      senderId: input.senderId,
      recipientId: input.recipientId,
      corridorId: input.corridorId,
      sendAmount: input.sendAmountMinor,
      sendCurrency: corridor.sendCurrency,
      receiveAmount: receiveAmountMinor,
      receiveCurrency: corridor.receiveCurrency,
      fxRateLocked: quote.appliedRate,
      feeAmount: feeAmountMinor,
      status: "CREATED",
      quoteExpiresAt: quote.expiresAt,
    },
  });
  await prisma.transactionStatusEvent.create({
    data: { transactionId: transaction.id, fromStatus: null, toStatus: "CREATED", actor: `user:${input.senderId}` },
  });

  // --- Payment verification (web sends only, for now — the mobile app
  // doesn't collect a real card payment yet, see task tracker). If a
  // paymentIntentId is provided, it must check out against Stripe directly
  // before anything else happens; if none is provided, we log it and let
  // the send through, as a temporary bridge until mobile also has this. ---
  if (input.payFromWallet) {
    const senderWalletForCheck = await getOrCreateUserWallet(input.senderId, corridor.sendCurrency);
    const walletBalance = await getAccountBalance(senderWalletForCheck.id);
    if (walletBalance < input.sendAmountMinor) {
      await prisma.$transaction(async (tx) => {
        await transitionStatus(tx, transaction.id, "CREATED", "FAILED", "system", "insufficient_wallet_balance");
      });
      throw new InsufficientFundsError();
    }
  } else if (input.paymentIntentId) {
    try {
      await verifyPaymentIntent(input.paymentIntentId, input.sendAmountMinor, corridor.sendCurrency);
    } catch (err) {
      await prisma.$transaction(async (tx) => {
        await transitionStatus(
          tx,
          transaction.id,
          "CREATED",
          "FAILED",
          "system",
          err instanceof Error ? err.message : "payment_not_verified"
        );
      });
      throw err;
    }
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { paymentIntentId: input.paymentIntentId },
    });
  } else {
    logger.warn(
      { transactionId: transaction.id, senderId: input.senderId },
      "transactions.no_payment_intent_provided"
    );
  }

  // --- Compliance screening ---
  const riskFlags = await runComplianceScreening(input.senderId, corridor.sendCurrency, input.sendAmountMinor);
  if (riskFlags.length > 0) {
    await prisma.$transaction(async (tx) => {
      await transitionStatus(tx, transaction.id, "CREATED", "COMPLIANCE_HOLD", "system", riskFlags.join(","));
    });
    throw new ComplianceHoldError(riskFlags);
  }

  // --- Fund collection + ledger posting (debit sender wallet, credit fee
  // and FX-spread revenue, credit payout-in-transit) ---
  const totalDebitMinor = input.sendAmountMinor; // sender is debited the full send amount; fee is carved out of it below
  const netToPayoutMinor = input.sendAmountMinor - feeAmountMinor;

  await prisma.$transaction(async (tx) => {
    const senderWallet = await getOrCreateUserWallet(input.senderId, corridor.sendCurrency, tx);
    const feeAccount = await getOrCreateSystemAccount("FEES_REVENUE", corridor.sendCurrency, tx);
    const payoutInTransit = await getOrCreateSystemAccount("PAYOUT_IN_TRANSIT", corridor.sendCurrency, tx);

    let legs;
    if (input.payFromWallet) {
      // Paying from an existing wallet balance — that money already
      // entered the platform at top-up time, so this is just a plain
      // spend: the wallet's resting balance actually goes down.
      legs = [
        { accountId: senderWallet.id, direction: "DEBIT" as const, amountMinor: totalDebitMinor, currency: corridor.sendCurrency },
        { accountId: feeAccount.id, direction: "CREDIT" as const, amountMinor: feeAmountMinor, currency: corridor.sendCurrency },
        { accountId: payoutInTransit.id, direction: "CREDIT" as const, amountMinor: netToPayoutMinor, currency: corridor.sendCurrency },
      ];
    } else {
      // Card-paid — the Stripe charge landing — money enters the
      // platform's cash account and is credited to the sender's wallet,
      // before immediately being spent below. Nets to zero effect on the
      // wallet's resting balance, which is correct: this money was never
      // actually sitting in a spendable balance.
      const platformCash = await getOrCreateSystemAccount("PLATFORM_CASH", corridor.sendCurrency, tx);
      legs = [
        { accountId: platformCash.id, direction: "DEBIT" as const, amountMinor: totalDebitMinor, currency: corridor.sendCurrency },
        { accountId: senderWallet.id, direction: "CREDIT" as const, amountMinor: totalDebitMinor, currency: corridor.sendCurrency },
        { accountId: senderWallet.id, direction: "DEBIT" as const, amountMinor: totalDebitMinor, currency: corridor.sendCurrency },
        { accountId: feeAccount.id, direction: "CREDIT" as const, amountMinor: feeAmountMinor, currency: corridor.sendCurrency },
        { accountId: payoutInTransit.id, direction: "CREDIT" as const, amountMinor: netToPayoutMinor, currency: corridor.sendCurrency },
      ];
    }

    await postLedgerEntries({ transactionId: transaction.id }, legs, tx);

    await transitionStatus(tx, transaction.id, "CREATED", "FUNDS_COLLECTED", "system");
    await transitionStatus(tx, transaction.id, "FUNDS_COLLECTED", "COMPLIANCE_SCREENED", "system");
  });

  // --- Dispatch to payout aggregator ---
  const recipient = await prisma.recipient.findUniqueOrThrow({ where: { id: input.recipientId } });
  const payoutResult = await dispatchPayout({
    transactionId: transaction.id,
    receiveCountry: recipient.country,
    receiveCurrency: corridor.receiveCurrency,
    amountMinor: receiveAmountMinor,
    recipient: {
      fullName: recipient.fullName,
      payoutMethod: recipient.payoutMethod,
      bankCode: recipient.bankCode,
      accountNumber: recipient.accountNumber,
      mobileNetwork: recipient.mobileNetwork,
      mobileNumber: recipient.mobileNumber,
    },
  });

  await prisma.$transaction(async (tx) => {
    if (payoutResult.status === "ACCEPTED") {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: { payoutReference: payoutResult.providerReference },
      });
      await transitionStatus(tx, transaction.id, "COMPLIANCE_SCREENED", "SENT_TO_PAYOUT", "system");
    } else {
      await transitionStatus(
        tx,
        transaction.id,
        "COMPLIANCE_SCREENED",
        "FAILED",
        "system",
        payoutResult.reason ?? "payout_rejected"
      );
    }
  });

  if (payoutResult.status === "ACCEPTED") {
    const sender = await prisma.user.findUnique({ where: { id: input.senderId } });
    if (sender) {
      await sendTransferSentEmail(sender.email, {
        recipientName: recipient.fullName,
        sendAmount: formatMoney(input.sendAmountMinor, corridor.sendCurrency),
        receiveAmount: formatMoney(receiveAmountMinor, corridor.receiveCurrency),
      });
    }
  }

  if (payoutResult.status !== "ACCEPTED") {
    // The aggregator never accepted the payout, so no money actually left —
    // refund immediately rather than leaving the sender's wallet debited.
    await refundTransaction(transaction.id, payoutResult.reason ?? "payout_rejected");
  }

  // Final payout confirmation (PAID_OUT) arrives asynchronously via the
  // payout provider's webhook — see modules/payout/payout.routes.ts. A
  // later-reported failure there also triggers refundTransaction.
  return prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
}

// Flat bonus per currency for referral/promo rewards — roughly $5-equivalent,
// same "approximate on purpose" spirit as the step-up threshold table.
const REFERRAL_BONUS_MINOR: Record<string, bigint> = {
  GBP: 500n,
  EUR: 500n,
  USD: 500n,
  MYR: 2300n,
};
const DEFAULT_REFERRAL_BONUS_MINOR = 500n;

/**
 * Pay out referral/promo bonuses on a sender's first-ever completed
 * transfer (roadmap growth strategy: "give $5, get $5" on first transfer).
 * Idempotent via the ReferralReward/PromoCodeRedemption unique-per-user
 * rows, not just the paidOutCount check, so a duplicate webhook delivery
 * can never double-pay.
 */
async function grantFirstTransferBonusesIfEligible(
  triggeringTransactionId: string,
  senderId: string,
  sendCurrency: string
) {
  const paidOutCount = await prisma.transaction.count({ where: { senderId, status: "PAID_OUT" } });
  if (paidOutCount !== 1) return; // not their first completed transfer

  const sender = await prisma.user.findUniqueOrThrow({ where: { id: senderId } });

  if (sender.referredByUserId) {
    const already = await prisma.referralReward.findUnique({ where: { refereeId: senderId } });
    if (!already) {
      const bonusMinor = REFERRAL_BONUS_MINOR[sendCurrency] ?? DEFAULT_REFERRAL_BONUS_MINOR;
      await prisma.$transaction(async (tx) => {
        const refereeWallet = await getOrCreateUserWallet(senderId, sendCurrency, tx);
        const referrerWallet = await getOrCreateUserWallet(sender.referredByUserId!, sendCurrency, tx);
        const expenseAccount = await getOrCreateSystemAccount("REFERRAL_BONUS_EXPENSE", sendCurrency, tx);

        await postLedgerEntries(
          { transactionId: triggeringTransactionId },
          [
            { accountId: expenseAccount.id, direction: "DEBIT", amountMinor: bonusMinor * 2n, currency: sendCurrency },
            { accountId: refereeWallet.id, direction: "CREDIT", amountMinor: bonusMinor, currency: sendCurrency },
            { accountId: referrerWallet.id, direction: "CREDIT", amountMinor: bonusMinor, currency: sendCurrency },
          ],
          tx
        );

        await tx.referralReward.create({
          data: {
            referrerId: sender.referredByUserId!,
            refereeId: senderId,
            triggeringTransactionId,
            referrerAmountMinor: bonusMinor,
            referrerCurrency: sendCurrency,
            refereeAmountMinor: bonusMinor,
            refereeCurrency: sendCurrency,
          },
        });
      });
      logger.info({ senderId, referrerId: sender.referredByUserId }, "referral.bonus_paid");
    }
    return;
  }

  if (sender.redeemedPromoCodeId) {
    const already = await prisma.promoCodeRedemption.findUnique({ where: { userId: senderId } });
    if (already) return;

    const promoCode = await prisma.promoCode.findUniqueOrThrow({ where: { id: sender.redeemedPromoCodeId } });
    if (!promoCode.active) return;

    await prisma.$transaction(async (tx) => {
      const wallet = await getOrCreateUserWallet(senderId, promoCode.bonusCurrency, tx);
      const expenseAccount = await getOrCreateSystemAccount("REFERRAL_BONUS_EXPENSE", promoCode.bonusCurrency, tx);

      await postLedgerEntries(
        { transactionId: triggeringTransactionId },
        [
          {
            accountId: expenseAccount.id,
            direction: "DEBIT",
            amountMinor: promoCode.bonusAmountMinor,
            currency: promoCode.bonusCurrency,
          },
          {
            accountId: wallet.id,
            direction: "CREDIT",
            amountMinor: promoCode.bonusAmountMinor,
            currency: promoCode.bonusCurrency,
          },
        ],
        tx
      );

      await tx.promoCodeRedemption.create({
        data: {
          promoCodeId: promoCode.id,
          userId: senderId,
          triggeringTransactionId,
          amountMinor: promoCode.bonusAmountMinor,
          currency: promoCode.bonusCurrency,
        },
      });
    });
    logger.info({ senderId, promoCodeId: promoCode.id }, "promo.bonus_paid");
  }
}

/** Called from the payout webhook once the aggregator confirms delivery. */
export async function confirmPayout(transactionId: string) {
  const transaction = await prisma.$transaction(async (tx) => {
    await transitionStatus(tx, transactionId, "SENT_TO_PAYOUT", "PAID_OUT", "webhook:payout_provider");
    return tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  });

  const [sender, recipient] = await Promise.all([
    prisma.user.findUnique({ where: { id: transaction.senderId } }),
    prisma.recipient.findUnique({ where: { id: transaction.recipientId } }),
  ]);
  if (sender && recipient) {
    await sendTransferCompletedEmail(sender.email, {
      recipientName: recipient.fullName,
      receiveAmount: formatMoney(transaction.receiveAmount, transaction.receiveCurrency),
    });
  }

  await grantFirstTransferBonusesIfEligible(transaction.id, transaction.senderId, transaction.sendCurrency);
}

/**
 * Reverse a failed transaction's ledger movements and return funds to the
 * sender's wallet. Called whenever a payout fails — either rejected
 * up-front by the aggregator (dispatchPayout returns REJECTED) or reported
 * as FAILED later via the payout provider's webhook.
 */
export async function refundTransaction(transactionId: string, reason: string) {
  const current = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });

  // Already refunded — avoid double-reversing on webhook retries.
  if (current.status === "REFUND_INITIATED" || current.status === "REFUNDED") {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await transitionStatus(tx, transactionId, current.status, "REFUND_INITIATED", "system", reason);
  });

  // Issue the real Stripe refund outside the DB transaction — it's a
  // network call to a third party and shouldn't hold DB locks open while
  // in flight. Idempotency key is derived from the transaction id, so this
  // can never double-refund the same charge even if refundTransaction runs
  // twice (e.g. a retried webhook).
  if (current.paymentIntentId) {
    try {
      await refundPaymentIntent(current.paymentIntentId, { transactionId, reason }, `refund_${transactionId}`);
      logger.info({ transactionId, paymentIntentId: current.paymentIntentId }, "transactions.stripe_refund_issued");
    } catch (err) {
      // Don't throw — the sender's internal wallet balance still needs to
      // be made whole via the ledger reversal below regardless. A failed
      // Stripe-side refund call needs manual follow-up, which this error
      // log is for.
      logger.error(
        { transactionId, paymentIntentId: current.paymentIntentId, err },
        "transactions.stripe_refund_failed"
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    // Mirror-reverse every ledger entry originally posted for this
    // transaction — never edit or delete the originals, always post
    // offsetting entries instead (see architecture doc 6.5).
    const originalEntries = await tx.ledgerEntry.findMany({ where: { transactionId } });
    for (const entry of originalEntries) {
      await tx.ledgerEntry.create({
        data: {
          accountId: entry.accountId,
          transactionId,
          direction: entry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
          amount: entry.amount,
          currency: entry.currency,
        },
      });
    }

    await transitionStatus(tx, transactionId, "REFUND_INITIATED", "REFUNDED", "system", reason);
  });

  const [sender, recipient] = await Promise.all([
    prisma.user.findUnique({ where: { id: current.senderId } }),
    prisma.recipient.findUnique({ where: { id: current.recipientId } }),
  ]);
  if (sender && recipient) {
    await sendTransferRefundedEmail(sender.email, {
      recipientName: recipient.fullName,
      sendAmount: formatMoney(current.sendAmount, current.sendCurrency),
      reason,
    });
  }

  logger.info({ transactionId, reason }, "transactions.refunded");
}