import { prisma } from "../src/db/client";
import { getOrCreateSystemAccount, postLedgerEntries } from "../src/modules/ledger/ledger.service";

/**
 * One-time backfill: historical card-paid Transactions/BillPayments debited
 * USER_WALLET without ever crediting it (fixed going forward in
 * transactions.service.ts / bill.service.ts). Finds every reference whose
 * recorded debits exceed its credits and posts the missing
 * PLATFORM_CASH/USER_WALLET pair. Safe to re-run — already-balanced
 * references are skipped.
 */
async function main() {
  const wallets = await prisma.account.findMany({ where: { type: "USER_WALLET" } });
  let totalFixed = 0;

  for (const wallet of wallets) {
    const entries = await prisma.ledgerEntry.findMany({ where: { accountId: wallet.id } });

    const groups = new Map<string, { credit: bigint; debit: bigint; kind: "transactionId" | "billPaymentId" }>();
    for (const e of entries) {
      const ref = e.transactionId ?? e.billPaymentId;
      if (!ref) continue; // wallet top-ups / referral bonuses are credit-only by design
      const kind = e.transactionId ? "transactionId" : "billPaymentId";
      const key = `${kind}:${ref}`;
      const g = groups.get(key) ?? { credit: 0n, debit: 0n, kind };
      if (e.direction === "CREDIT") g.credit += e.amount;
      else g.debit += e.amount;
      groups.set(key, g);
    }

    for (const [key, g] of groups) {
      const shortfall = g.debit - g.credit;
      if (shortfall <= 0n) continue;

      const ref = key.split(":").slice(1).join(":");
      const platformCash = await getOrCreateSystemAccount("PLATFORM_CASH", wallet.currency);

      await prisma.$transaction(async (tx) => {
        await postLedgerEntries(
          g.kind === "transactionId" ? { transactionId: ref } : { billPaymentId: ref },
          [
            { accountId: platformCash.id, direction: "DEBIT", amountMinor: shortfall, currency: wallet.currency },
            { accountId: wallet.id, direction: "CREDIT", amountMinor: shortfall, currency: wallet.currency },
          ],
          tx
        );
      });

      totalFixed++;
      console.log(`Backfilled ${key}: credited ${shortfall} ${wallet.currency} to wallet ${wallet.id}`);
    }
  }

  console.log(`Done. Backfilled ${totalFixed} reference(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });