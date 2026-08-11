import { randomUUID } from "node:crypto";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

/**
 * FX rate provider interface. Swap `MockFxProvider` for a real market-data
 * feed (e.g. a bank partner rate API or a provider like CurrencyLayer/OpenFX)
 * without touching any calling code — this is the "vendor behind an
 * interface" pattern called out in the architecture doc (section 6.1).
 */
export interface FxProvider {
  getMidMarketRate(baseCurrency: string, quoteCurrency: string): Promise<number>;
}

class MockFxProvider implements FxProvider {
  // Static indicative rates for local dev / demo only. Never ship this to
  // production — a stale hardcoded rate on real money movement is a direct
  // financial-loss and mis-selling risk.
  private static readonly RATES: Record<string, number> = {
    "GBP:NGN": 2050.0,
    "GBP:GHS": 19.8,
    "EUR:NGN": 1780.0,
    "EUR:GHS": 17.2,
    "USD:NGN": 1620.0,
    "USD:GHS": 15.7,
    "MYR:NGN": 345.0,
    "MYR:GHS": 3.3,
    "USD:INR": 87.5,
    "USD:PKR": 281.0,
    "GBP:XOF": 785.0,
    "EUR:XOF": 670.0,
    "USD:XOF": 615.0,
    "MYR:XOF": 131.0,
    "GBP:GMD": 88.5,
    // Kenya (KES)
    "GBP:KES": 163.0,
    "EUR:KES": 142.0,
    "USD:KES": 129.0,
    "MYR:KES": 27.5,
    // Uganda (UGX)
    "GBP:UGX": 4680.0,
    "EUR:UGX": 4066.0,
    "USD:UGX": 3700.0,
    "MYR:UGX": 787.0,
    // Tanzania (TZS)
    "GBP:TZS": 3289.0,
    "EUR:TZS": 2857.0,
    "USD:TZS": 2600.0,
    "MYR:TZS": 553.0,
    // Zambia (ZMW)
    "GBP:ZMW": 34.2,
    "EUR:ZMW": 29.7,
    "USD:ZMW": 27.0,
    "MYR:ZMW": 5.7,
    // Cameroon (XAF)
    "GBP:XAF": 755.0,
    "EUR:XAF": 656.0,
    "USD:XAF": 597.0,
    "MYR:XAF": 127.0,
    // Sierra Leone (SLL, post-2022 redenomination)
    "GBP:SLL": 28.6,
    "EUR:SLL": 24.8,
    "USD:SLL": 22.6,
    "MYR:SLL": 4.8,
    // South Africa (ZAR)
    "GBP:ZAR": 23.5,
    "EUR:ZAR": 20.4,
    "USD:ZAR": 18.6,
    "MYR:ZAR": 4.0,
  };

  async getMidMarketRate(base: string, quote: string): Promise<number> {
    const key = `${base}:${quote}`;
    const rate = MockFxProvider.RATES[key];
    if (!rate) throw new Error(`No mock rate configured for ${key}`);
    return rate;
  }
}

/**
 * Live rates from Currencylayer (apilayer.net). The free plan only allows
 * USD as the query base and updates once a day, so we fetch every currency
 * we need relative to USD once per day and derive any pair from that via
 * cross-rate math — no need to pay for "source currency switching" at all.
 */
class LiveFxProvider implements FxProvider {
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly TARGET_CURRENCIES = [
    "GBP", "EUR", "MYR", "NGN", "GHS", "XOF", "XAF", "KES", "UGX", "TZS", "ZMW", "SLL", "ZAR", "GMD", "INR", "PKR",
  ];

  private cachedRates: Record<string, number> | null = null;
  private cachedAt = 0;
  private fetchPromise: Promise<Record<string, number>> | null = null;

  private async getUsdRates(): Promise<Record<string, number>> {
    if (this.cachedRates && Date.now() - this.cachedAt < LiveFxProvider.CACHE_TTL_MS) {
      return this.cachedRates;
    }
    // Avoid firing multiple simultaneous fetches if several quotes come in
    // right as the cache expires.
    if (!this.fetchPromise) {
      this.fetchPromise = this.fetchUsdRates().finally(() => {
        this.fetchPromise = null;
      });
    }
    return this.fetchPromise;
  }

  private async fetchUsdRates(): Promise<Record<string, number>> {
    if (!env.FX_API_KEY) {
      throw new Error("FX_API_KEY is not configured");
    }
    const currencies = LiveFxProvider.TARGET_CURRENCIES.join(",");
    const url = `https://apilayer.net/api/live?access_key=${env.FX_API_KEY}&currencies=${currencies}`;
    const res = await fetch(url);
    const body = (await res.json()) as {
      success: boolean;
      quotes?: Record<string, number>;
      error?: { code: number; info: string };
    };

    if (!body.success || !body.quotes) {
      logger.error({ error: body.error }, "fx.currencylayer.live_rate_failed");
      throw new Error(body.error?.info ?? "Couldn't fetch live FX rates");
    }

    // Quotes come back as "USDGBP": 0.79, "USDNGN": 1620.5, etc.
    const rates: Record<string, number> = { USD: 1 };
    for (const [pair, rate] of Object.entries(body.quotes)) {
      rates[pair.replace(/^USD/, "")] = rate;
    }
    this.cachedRates = rates;
    this.cachedAt = Date.now();
    return rates;
  }

  async getMidMarketRate(base: string, quote: string): Promise<number> {
    const rates = await this.getUsdRates();
    const baseRate = rates[base];
    const quoteRate = rates[quote];
    if (baseRate === undefined || quoteRate === undefined) {
      throw new Error(`Currencylayer doesn't have a rate for ${base} or ${quote}`);
    }
    // rates are "units of X per 1 USD" — so X->Y = (units of Y per USD) / (units of X per USD)
    return quoteRate / baseRate;
  }
}

function selectFxProvider(): FxProvider {
  switch (env.FX_PROVIDER) {
    case "currencylayer":
      return new LiveFxProvider();
    case "mock":
    default:
      return new MockFxProvider();
  }
}

export const fxProvider = selectFxProvider();

export interface Quote {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  midMarketRate: number;
  appliedRate: number; // mid-market rate adjusted by the corridor's FX margin
  fxMarginBps: number;
  expiresAt: Date;
}

const QUOTE_TTL_MS = 3 * 60 * 1000; // 3 minutes — short enough to bound FX risk between quote and settlement

/**
 * Produce a locked, time-boxed quote. The margin is the platform's FX
 * revenue on the transaction (see Account.type FX_SPREAD_REVENUE in the
 * ledger) and must be disclosed to the user before they confirm the send —
 * regulators and app-store review both expect this to be explicit, not
 * buried in the rate alone.
 */
export async function createQuote(
  baseCurrency: string,
  quoteCurrency: string,
  fxMarginBps: number
): Promise<Quote> {
  const midMarketRate = await fxProvider.getMidMarketRate(baseCurrency, quoteCurrency);
  const appliedRate = midMarketRate * (1 - fxMarginBps / 10_000);
  const quote: Quote = {
    id: randomUUID(),
    baseCurrency,
    quoteCurrency,
    midMarketRate,
    appliedRate,
    fxMarginBps,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
  };
  logger.info({ quoteId: quote.id, baseCurrency, quoteCurrency }, "fx.quote_created");
  return quote;
}
