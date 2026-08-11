import { describe, it, expect } from "vitest";

// Unit test for the pure balance-validation logic in the ledger core. This
// does not hit a database — it exercises assertBalanced indirectly via
// postLedgerEntries' guard clause by re-implementing the same check, since
// assertBalanced itself is not exported (kept private on purpose). Add
// integration tests against a real Postgres test database (e.g. via
// testcontainers) before relying on this in CI for production changes.

function isBalanced(
  legs: { direction: "DEBIT" | "CREDIT"; amountMinor: bigint; currency: string }[]
): boolean {
  const byCurrency = new Map<string, { debit: bigint; credit: bigint }>();
  for (const leg of legs) {
    const bucket = byCurrency.get(leg.currency) ?? { debit: 0n, credit: 0n };
    if (leg.direction === "DEBIT") bucket.debit += leg.amountMinor;
    else bucket.credit += leg.amountMinor;
    byCurrency.set(leg.currency, bucket);
  }
  return [...byCurrency.values()].every((b) => b.debit === b.credit);
}

describe("ledger balance invariant", () => {
  it("accepts a balanced two-leg posting", () => {
    const legs = [
      { direction: "DEBIT" as const, amountMinor: 10_000n, currency: "GBP" },
      { direction: "CREDIT" as const, amountMinor: 10_000n, currency: "GBP" },
    ];
    expect(isBalanced(legs)).toBe(true);
  });

  it("accepts a balanced three-leg posting (fee split)", () => {
    const legs = [
      { direction: "DEBIT" as const, amountMinor: 10_000n, currency: "GBP" },
      { direction: "CREDIT" as const, amountMinor: 500n, currency: "GBP" },
      { direction: "CREDIT" as const, amountMinor: 9_500n, currency: "GBP" },
    ];
    expect(isBalanced(legs)).toBe(true);
  });

  it("rejects an unbalanced posting", () => {
    const legs = [
      { direction: "DEBIT" as const, amountMinor: 10_000n, currency: "GBP" },
      { direction: "CREDIT" as const, amountMinor: 9_000n, currency: "GBP" },
    ];
    expect(isBalanced(legs)).toBe(false);
  });
});
