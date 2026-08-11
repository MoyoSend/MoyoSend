import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds every send-currency x receive-country combination this app
 * currently supports. Corridors are generated from the two lists below
 * instead of hand-written one by one — add a country or send currency here
 * and every combination gets seeded automatically.
 *
 * IMPORTANT: a corridor existing here does NOT mean it's compliant to use
 * with real money yet. GBP/EUR are covered by the UK/EU agent-of-EMI
 * structure from Phase 0/1. USD and MYR corridors are sandbox-only for now —
 * collecting real USD from US senders needs US money-transmitter licensing
 * (Phase 3 gate), and MYR needs a licensed Malaysia-side partner. Don't
 * enable these for real users before that work is done.
 *
 * Run with: npx tsx prisma/seed.ts
 */

const SEND_CURRENCIES = ["GBP", "EUR", "USD", "MYR"] as const;

const RECEIVE_COUNTRIES = [
  { country: "NG", currency: "NGN", payoutMethods: ["BANK_TRANSFER", "MOBILE_MONEY"] as const },
  { country: "GH", currency: "GHS", payoutMethods: ["BANK_TRANSFER", "MOBILE_MONEY"] as const },
  // Senegal: no bank-account verification built yet, mobile money only.
  { country: "SN", currency: "XOF", payoutMethods: ["MOBILE_MONEY"] as const },
  { country: "KE", currency: "KES", payoutMethods: ["BANK_TRANSFER", "MOBILE_MONEY"] as const },
  { country: "UG", currency: "UGX", payoutMethods: ["BANK_TRANSFER", "MOBILE_MONEY"] as const },
  { country: "TZ", currency: "TZS", payoutMethods: ["BANK_TRANSFER", "MOBILE_MONEY"] as const },
  { country: "ZM", currency: "ZMW", payoutMethods: ["BANK_TRANSFER", "MOBILE_MONEY"] as const },
  { country: "CM", currency: "XAF", payoutMethods: ["BANK_TRANSFER", "MOBILE_MONEY"] as const },
  { country: "CI", currency: "XOF", payoutMethods: ["BANK_TRANSFER", "MOBILE_MONEY"] as const },
  // Sierra Leone and South Africa aren't on Flutterwave's mobile money
  // network list — bank transfer only.
  { country: "SL", currency: "SLL", payoutMethods: ["BANK_TRANSFER"] as const },
  { country: "ZA", currency: "ZAR", payoutMethods: ["BANK_TRANSFER"] as const },
];

async function main() {
  const corridors = SEND_CURRENCIES.flatMap((sendCurrency) =>
    RECEIVE_COUNTRIES.map(({ country, currency, payoutMethods }) => ({
      sendCurrency,
      receiveCountry: country,
      receiveCurrency: currency,
      payoutMethods,
      minSendMinor: 500n,
      maxSendMinor: 500_000n,
      feeFlatMinor: 0n,
      feeBps: 0,
      fxMarginBps: 150,
      enabled: true,
      payoutProvider: "flutterwave",
    }))
  );

  for (const corridor of corridors) {
    await prisma.corridor.upsert({
      where: {
        sendCurrency_receiveCountry_receiveCurrency: {
          sendCurrency: corridor.sendCurrency,
          receiveCountry: corridor.receiveCountry,
          receiveCurrency: corridor.receiveCurrency,
        },
      },
      update: corridor,
      create: corridor,
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${corridors.length} corridors.`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());