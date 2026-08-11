import { Prisma, AccountType, EntryDirection } from "@prisma/client";
import { prisma } from "../../db/client";
import { logger } from "../../utils/logger";

/**
 * Double-entry ledger core.
 *
 * Rules enforced here, not left to callers:
 *  1. Every posting is a set of entries whose debits equal its credits, in
 *     a single currency, written atomically in one DB transaction.
 *  2. Entries are append-only — there is no update/delete path. Corrections
 *     are new, offsetting entries that reference the same transaction.
 *  3. Idempotency is the caller's responsibility at the Transaction level
 *     (see modules/transactions) — the ledger itself just refuses to post
 *     an unbalanced set of entries.
 */

export interface PostingLeg {
  accountId: string;
  direction: EntryDirection;
  amountMinor: bigint;
  currency: string;
}

export class LedgerImbalanceError extends Error {
  constructor(details: string) {
    super(`Ledger posting rejected: unbalanced entries (${details})`);
    this.name = "LedgerImbalanceError";
  }
}

function assertBalanced(legs: PostingLeg[]) {
  const byCurrency = new Map<string, { debit: bigint; credit: bigint }>();
  for (const leg of legs) {
    const bucket = byCurrency.get(leg.currency) ?? { debit: 0n, credit: 0n };
    if (leg.direction === "DEBIT") bucket.debit += leg.amountMinor;
    else bucket.credit += leg.amountMinor;
    byCurrency.set(leg.currency, bucket);
  }
  for (const [currency, { debit, credit }] of byCurrency.entries()) {
    if (debit !== credit) {
      throw new LedgerImbalanceError(`${currency}: debits=${debit} credits=${credit}`);
    }
  }
}

export interface LedgerReference {
  transactionId?: string;
  billPaymentId?: string;
}

/**
 * Post a balanced set of ledger entries for either a remittance Transaction
 * or a BillPayment inside one DB transaction — exactly one of the two must
 * be set. Pass an existing Prisma transaction client (`tx`) when this is
 * called as part of a larger multi-step workflow so the ledger write is
 * atomic with the status-event write.
 */
export async function postLedgerEntries(
  reference: LedgerReference,
  legs: PostingLeg[],
  tx: Prisma.TransactionClient = prisma
) {
  if (!reference.transactionId && !reference.billPaymentId) {
    throw new Error("postLedgerEntries requires either a transactionId or a billPaymentId");
  }
  if (legs.length < 2) {
    throw new LedgerImbalanceError("a posting needs at least two legs (one debit, one credit)");
  }
  assertBalanced(legs);

  const entries = await tx.ledgerEntry.createMany({
    data: legs.map((leg) => ({
      accountId: leg.accountId,
      transactionId: reference.transactionId,
      billPaymentId: reference.billPaymentId,
      direction: leg.direction,
      amount: leg.amountMinor,
      currency: leg.currency,
    })),
  });

  logger.info({ ...reference, legCount: legs.length }, "ledger.entries_posted");
  return entries;
}

/** Get or create a user's wallet account for a given currency. */
export async function getOrCreateUserWallet(
  userId: string,
  currency: string,
  tx: Prisma.TransactionClient = prisma
) {
  return tx.account.upsert({
    where: { userId_type_currency: { userId, type: AccountType.USER_WALLET, currency } },
    update: {},
    create: { userId, type: AccountType.USER_WALLET, currency },
  });
}

/** Get or create one of the fixed internal/system accounts (singleton per type+currency). */
export async function getOrCreateSystemAccount(
  type: Exclude<AccountType, "USER_WALLET">,
  currency: string,
  tx: Prisma.TransactionClient = prisma
) {
  // Prisma's upsert() rejects `null` inside a compound-unique lookup (a
  // known limitation), so system accounts (userId: null) need a plain
  // find-then-create instead of upsert(). Fine for local dev; in
  // production, pre-seed these accounts once at startup so this rarely
  // races two concurrent creates for the same account.
  const existing = await tx.account.findFirst({
    where: { userId: null, type, currency },
  });
  if (existing) return existing;
  return tx.account.create({
    data: { userId: null, type, currency },
  });
}

/** Compute an account's current balance by summing its entries. Source of truth is always the entries, never a cached balance column. */
export async function getAccountBalance(accountId: string): Promise<bigint> {
  const [debitSum, creditSum] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: { accountId, direction: "DEBIT" },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { accountId, direction: "CREDIT" },
      _sum: { amount: true },
    }),
  ]);
  const debit = debitSum._sum.amount ?? 0n;
  const credit = creditSum._sum.amount ?? 0n;
  // Convention: for a USER_WALLET asset account, credits increase balance,
  // debits decrease it (standard for a liability-to-the-platform account).
  return credit - debit;
}
