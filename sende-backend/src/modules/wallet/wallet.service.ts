import { prisma } from "../../db/client";
import { logger } from "../../utils/logger";
import { verifyPaymentIntent } from "../payments/payment.service";
import {
  getOrCreateSystemAccount,
  getOrCreateUserWallet,
  postLedgerEntries,
  getAccountBalance,
} from "../ledger/ledger.service";

interface CreateWalletTopUpInput {
  idempotencyKey: string;
  userId: string;
  amountMinor: bigint;
  currency: string;
  paymentIntentId: string;
}

/**
 * Create + process a wallet top-up: verify the Stripe charge actually
 * succeeded for this exact amount, then credit the user's USER_WALLET
 * ledger account. Mirrors bill.service.ts's createAndProcessBillPayment
 * (idempotency, payment verification, ledger posting) but simpler — no
 * corridor, no FX, no payout dispatch. Unlike a card-paid transaction/bill
 * payment, this posting has no offsetting debit: the money really is now
 * sitting in the user's spendable balance until they spend it.
 */
export async function createAndProcessWalletTopUp(input: CreateWalletTopUpInput) {
  const existing = await prisma.walletTopUp.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    logger.info({ walletTopUpId: existing.id }, "wallet.idempotent_replay");
    return existing;
  }

  const topUp = await prisma.walletTopUp.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "CREATED",
    },
  });

  // --- Payment verification — the card must actually be charged for this
  // exact amount before we credit anything. Mirrors bill.service.ts /
  // transactions.service.ts. ---
  try {
    await verifyPaymentIntent(input.paymentIntentId, input.amountMinor, input.currency);
  } catch (err) {
    await prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: { status: "FAILED", failureReason: err instanceof Error ? err.message : "payment_not_verified" },
    });
    throw err;
  }
  await prisma.walletTopUp.update({
    where: { id: topUp.id },
    data: { paymentIntentId: input.paymentIntentId },
  });

  // --- Ledger posting: cash lands, wallet balance goes up ---
  await prisma.$transaction(async (tx) => {
    const wallet = await getOrCreateUserWallet(input.userId, input.currency, tx);
    const platformCash = await getOrCreateSystemAccount("PLATFORM_CASH", input.currency, tx);

    await postLedgerEntries(
      { walletTopUpId: topUp.id },
      [
        { accountId: platformCash.id, direction: "DEBIT", amountMinor: input.amountMinor, currency: input.currency },
        { accountId: wallet.id, direction: "CREDIT", amountMinor: input.amountMinor, currency: input.currency },
      ],
      tx
    );

    await tx.walletTopUp.update({ where: { id: topUp.id }, data: { status: "FUNDS_COLLECTED" } });
  });

  logger.info({ walletTopUpId: topUp.id, userId: input.userId }, "wallet.topped_up");
  return prisma.walletTopUp.findUniqueOrThrow({ where: { id: topUp.id } });
}

/** A user's current wallet balance for one currency (0 if they've never touched it). */
export async function getWalletBalance(userId: string, currency: string): Promise<bigint> {
  const account = await prisma.account.findUnique({
    where: { userId_type_currency: { userId, type: "USER_WALLET", currency } },
  });
  if (!account) return 0n;
  return getAccountBalance(account.id);
}

/** Every currency a user has ever held a wallet balance in, with current balances — for a balances screen that doesn't assume one home currency. */
export async function listWalletBalances(userId: string): Promise<{ currency: string; balanceMinor: bigint }[]> {
  const accounts = await prisma.account.findMany({ where: { userId, type: "USER_WALLET" } });
  return Promise.all(
    accounts.map(async (account) => ({
      currency: account.currency,
      balanceMinor: await getAccountBalance(account.id),
    }))
  );
}