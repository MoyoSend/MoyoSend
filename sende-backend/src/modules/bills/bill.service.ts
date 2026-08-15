import { randomUUID } from "crypto";
import { prisma } from "../../db/client";
import { logger } from "../../utils/logger";
import { createQuote } from "../fx/fx.service";
import { encryptField } from "../../utils/crypto";
import { sendBillPayment, getDataBundlePrice } from "../payout/payout.service";
import { getOrCreateSystemAccount, getOrCreateUserWallet, postLedgerEntries } from "../ledger/ledger.service";
import { runComplianceScreening, ComplianceHoldError } from "../transactions/transactions.service";
import { verifyPaymentIntent } from "../payments/payment.service";
interface CreateBillPaymentInput {
  idempotencyKey: string;
  userId: string;
  type: "AIRTIME" | "DATA";
  network: string;
  billerCode: string;
  itemCode: string;
  phoneNumber: string;
  ngnAmountMinor?: bigint; // required for AIRTIME; ignored for DATA (catalog price used instead)
  sendCurrency: string;
  paymentIntentId: string;
  sendAmountMinor: bigint; // amount actually charged via Stripe, locked in client-side at
                            // PaymentIntent-creation time — see note below.
}

/**
 * Create + process a Nigeria airtime/data bill payment. Deliberately a
 * lightweight sibling of transactions.service.ts's
 * createAndProcessTransaction rather than reusing the Transaction model
 * (see schema.prisma comment on BillPayment) — but reuses the same FX
 * engine, ledger discipline, and compliance screening as a remittance send.
 */
export async function createAndProcessBillPayment(input: CreateBillPaymentInput) {
  const existing = await prisma.billPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    logger.info({ billPaymentId: existing.id }, "bills.idempotent_replay");
    return existing;
  }

  // Borrow the FX margin + fee schedule already configured for this send
  // currency's NG remittance corridor, rather than inventing a separate
  // pricing model just for bills.
  const corridor = await prisma.corridor.findFirst({
    where: { sendCurrency: input.sendCurrency, receiveCountry: "NG" },
  });
  if (!corridor) {
    throw new Error(`No NG corridor configured for ${input.sendCurrency} — can't price this bill payment`);
  }

  const quote = await createQuote(input.sendCurrency, "NGN", corridor.fxMarginBps);

  // Both airtime and data are priced the same way: figure out the exact
  // Naira amount being delivered first, then work backwards to what the
  // sender is charged (base amount + fee) at today's rate. Airtime has no
  // fixed catalog, so the caller specifies the Naira top-up amount
  // directly; data bundles are fixed-price SKUs, so the price comes from
  // Flutterwave's own catalog instead of trusting whatever the client sent.
  let ngnAmountMinor: bigint;
  if (input.type === "DATA") {
    const bundlePrice = await getDataBundlePrice(input.billerCode, input.itemCode);
    if (bundlePrice === null) {
      throw new Error(`Couldn't find bundle ${input.itemCode} in the current catalog for ${input.billerCode}`);
    }
    ngnAmountMinor = bundlePrice;
  } else {
    if (input.ngnAmountMinor === undefined || input.ngnAmountMinor <= 0n) {
      throw new Error("ngnAmountMinor is required for airtime top-ups");
    }
    ngnAmountMinor = input.ngnAmountMinor;
  }

  // The amount actually charged to the card is decided by the frontend at
  // PaymentIntent-creation time, not recomputed here — card entry plus any
  // 3D Secure challenge can take a while, and re-deriving the charge from
  // "today's rate" at this point would almost always disagree with what
  // Stripe actually collected, failing verifyPaymentIntent on a perfectly
  // good payment. We still compute today's minimum acceptable amount as a
  // floor, to reject a stale quote that would undercharge what's needed to
  // cover the NGN being delivered.
  const baseSendAmountMinor = BigInt(Math.ceil(Number(ngnAmountMinor) / quote.appliedRate));
  const feeAmountMinor = corridor.feeFlatMinor + (baseSendAmountMinor * BigInt(corridor.feeBps)) / 10_000n;
  const minSendAmountMinor = baseSendAmountMinor + feeAmountMinor;

  if (input.sendAmountMinor < minSendAmountMinor) {
    throw new Error("This quote has expired. Please try again.");
  }
  const sendAmountMinor = input.sendAmountMinor;

  // Our own reference — sent to Flutterwave as `reference`, expected back
  // as `customer_reference` on the webhook (see payout.routes.ts). Verify
  // this mapping against real sandbox webhooks before trusting it in
  // production; Flutterwave's docs are inconsistent about which field
  // actually echoes the caller-supplied value.
  const providerReference = randomUUID();

  const billPayment = await prisma.billPayment.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      type: input.type,
      network: input.network,
      phoneNumber: encryptField(input.phoneNumber),
      billerCode: input.billerCode,
      itemCode: input.itemCode,
      sendAmount: sendAmountMinor,
      sendCurrency: input.sendCurrency,
      ngnAmountMinor,
      fxRateLocked: quote.appliedRate,
      feeAmount: feeAmountMinor,
      status: "CREATED",
      providerReference,
    },
  });

  // --- Payment verification — the card must actually be charged for this
  // exact amount before anything else happens. Mirrors
  // transactions.service.ts's createAndProcessTransaction. ---
  try {
    await verifyPaymentIntent(input.paymentIntentId, sendAmountMinor, input.sendCurrency);
  } catch (err) {
    await prisma.billPayment.update({
      where: { id: billPayment.id },
      data: { status: "FAILED", failureReason: err instanceof Error ? err.message : "payment_not_verified" },
    });
    throw err;
  }
  await prisma.billPayment.update({
    where: { id: billPayment.id },
    data: { paymentIntentId: input.paymentIntentId },
  });

  // --- Compliance screening — same rules as a remittance send ---
  const riskFlags = await runComplianceScreening(input.userId, input.sendCurrency, sendAmountMinor);
  if (riskFlags.length > 0) {
    logger.warn({ billPaymentId: billPayment.id, riskFlags }, "bills.compliance_hold");
    await prisma.billPayment.update({
      where: { id: billPayment.id },
      data: { status: "COMPLIANCE_HOLD", failureReason: riskFlags.join(",") },
    });
    throw new ComplianceHoldError(riskFlags);
  }

  // --- Fund collection + ledger posting — mirrors transactions.service.ts ---
  await prisma.$transaction(async (tx) => {
    const senderWallet = await getOrCreateUserWallet(input.userId, input.sendCurrency, tx);
    const feeAccount = await getOrCreateSystemAccount("FEES_REVENUE", input.sendCurrency, tx);
    const inTransitAccount = await getOrCreateSystemAccount("PAYOUT_IN_TRANSIT", input.sendCurrency, tx);

    const platformCash = await getOrCreateSystemAccount("PLATFORM_CASH", input.sendCurrency, tx);

    await postLedgerEntries(
      { billPaymentId: billPayment.id },
      [
        // The Stripe charge landing — money enters the platform's cash
        // account and is credited to the user's wallet, before immediately
        // being spent below. Net effect on the wallet's resting balance is
        // zero for a card-paid bill, which is correct: this money was
        // never actually sitting in a spendable balance.
        { accountId: platformCash.id, direction: "DEBIT", amountMinor: sendAmountMinor, currency: input.sendCurrency },
        { accountId: senderWallet.id, direction: "CREDIT", amountMinor: sendAmountMinor, currency: input.sendCurrency },
        { accountId: senderWallet.id, direction: "DEBIT", amountMinor: sendAmountMinor, currency: input.sendCurrency },
        { accountId: feeAccount.id, direction: "CREDIT", amountMinor: feeAmountMinor, currency: input.sendCurrency },
        {
          accountId: inTransitAccount.id,
          direction: "CREDIT",
          amountMinor: sendAmountMinor - feeAmountMinor,
          currency: input.sendCurrency,
        },
      ],
      tx
    );

    await tx.billPayment.update({ where: { id: billPayment.id }, data: { status: "FUNDS_COLLECTED" } });
  });

  // --- Dispatch to Flutterwave Bills ---
  const result = await sendBillPayment({
    billerCode: input.billerCode,
    itemCode: input.itemCode,
    phoneNumber: input.phoneNumber,
    amountNgnMinor: ngnAmountMinor,
    reference: providerReference,
  });

  if (result.providerTxRef) {
    await prisma.billPayment.update({ where: { id: billPayment.id }, data: { providerTxRef: result.providerTxRef } });
  }

  if (result.status === "ACCEPTED") {
    await prisma.billPayment.update({ where: { id: billPayment.id }, data: { status: "SENT_TO_PROVIDER" } });
  } else {
    await refundBillPayment(billPayment.id, result.reason ?? "provider_rejected");
  }

  return prisma.billPayment.findUniqueOrThrow({ where: { id: billPayment.id } });
}

/**
 * Called from the payout webhook once Flutterwave confirms delivery. Takes
 * the row's own id rather than a provider-supplied reference string — the
 * webhook route resolves which BillPayment this event belongs to first
 * (trying customer_reference, then falling back to tx_ref), since neither
 * field is reliably present on every event.
 */
export async function confirmBillPayment(billPaymentId: string) {
  await prisma.billPayment.update({ where: { id: billPaymentId }, data: { status: "SUCCESSFUL" } });
}

/**
 * Reverse a failed bill payment's ledger movements and return funds to the
 * sender's wallet — same mirror-reversal approach as
 * transactions.service.ts's refundTransaction.
 */
export async function refundBillPayment(billPaymentId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.billPayment.findUniqueOrThrow({ where: { id: billPaymentId } });
    if (current.status === "REFUND_INITIATED" || current.status === "REFUNDED") return;

    await tx.billPayment.update({
      where: { id: billPaymentId },
      data: { status: "REFUND_INITIATED", failureReason: reason },
    });

    const originalEntries = await tx.ledgerEntry.findMany({ where: { billPaymentId } });
    for (const entry of originalEntries) {
      await tx.ledgerEntry.create({
        data: {
          accountId: entry.accountId,
          billPaymentId,
          direction: entry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
          amount: entry.amount,
          currency: entry.currency,
        },
      });
    }

    await tx.billPayment.update({ where: { id: billPaymentId }, data: { status: "REFUNDED" } });
  });

  logger.info({ billPaymentId, reason }, "bills.refunded");
}