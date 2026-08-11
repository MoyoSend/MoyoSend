import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { decryptField } from "../../utils/crypto";

/**
 * Payout aggregator interface. Production implementations target regional
 * aggregators (Flutterwave/Cellulant for African corridors, Thunes/Nium for
 * South Asia — see research doc section 2.4 and roadmap section 4.1) rather
 * than integrating each bank/mobile-money operator directly.
 */
export interface PayoutRequest {
  transactionId: string;
  receiveCountry: string;
  receiveCurrency: string;
  amountMinor: bigint;
  recipient: {
    fullName: string;
    payoutMethod: "BANK_TRANSFER" | "MOBILE_MONEY";
    bankCode?: string | null;
    accountNumber?: string | null;
    mobileNetwork?: string | null;
    mobileNumber?: string | null;
  };
}

export interface PayoutResult {
  providerReference: string;
  status: "ACCEPTED" | "REJECTED";
  reason?: string;
}

export interface PayoutProvider {
  sendPayout(request: PayoutRequest): Promise<PayoutResult>;
}

class MockPayoutProvider implements PayoutProvider {
  async sendPayout(request: PayoutRequest): Promise<PayoutResult> {
    logger.info(
      { transactionId: request.transactionId, country: request.receiveCountry },
      "payout.mock_provider.send"
    );
    // Simulate an aggregator accepting the payout for async settlement; a
    // real integration confirms delivery later via webhook (see
    // payout.routes.ts webhook handler).
    return { providerReference: `mock-payout-${request.transactionId}`, status: "ACCEPTED" };
  }
}

const AFRICA_COUNTRIES = new Set(["NG", "GH", "GM", "SN", "KE", "UG", "TZ", "ZM", "CM", "CI", "SL", "ZA"]);

// Flutterwave's mobile money transfer coverage, per their docs
// (developer.flutterwave.com/v3.0/docs/mobile-money). Nigeria and Gambia
// are NOT in their supported network list — only bank transfer works there
// today. Don't add a country here until Flutterwave's docs actually list a
// network code for it; showing "mobile money available" for a country
// Flutterwave can't actually pay out to is worse than not offering it.
const MOBILE_MONEY_NETWORKS: Record<string, { code: string; name: string }[]> = {
  GH: [
    { code: "MTN", name: "MTN Mobile Money" },
    { code: "VODAFONE", name: "Vodafone Cash" },
    { code: "AIRTELTIGO", name: "AirtelTigo Money" },
  ],
  SN: [
    { code: "ORANGEMONEY", name: "Orange Money" },
    { code: "WAVE", name: "Wave" },
  ],
  KE: [{ code: "MPS", name: "M-Pesa" }],
  UG: [
    { code: "AIRTEL", name: "Airtel Money" },
    { code: "MTN", name: "MTN Mobile Money" },
  ],
  TZ: [
    { code: "AIRTEL", name: "Airtel Money" },
    { code: "HALOPESA", name: "HaloPesa" },
    { code: "TIGO", name: "Tigo Pesa" },
    { code: "VODACOM", name: "Vodacom M-Pesa" },
  ],
  ZM: [{ code: "MPS", name: "M-Pesa" }],
  CM: [
    { code: "MTN", name: "MTN Mobile Money" },
    { code: "ORANGEMONEY", name: "Orange Money" },
  ],
  CI: [
    { code: "MOOV", name: "Moov Money" },
    { code: "MTN", name: "MTN Mobile Money" },
    { code: "ORANGE", name: "Orange Money" },
    { code: "WAVE", name: "Wave" },
  ],
};

export function listMobileNetworksForCountry(country: string): { code: string; name: string }[] {
  return MOBILE_MONEY_NETWORKS[country.toUpperCase()] ?? [];
}

function isMobileMoneySupported(country: string): boolean {
  return listMobileNetworksForCountry(country).length > 0;
}

/**
 * Real payout dispatch via Flutterwave's transfers API. Handles both bank
 * transfer and mobile money — they hit the same /v3/transfers endpoint,
 * just with different account_bank/account_number semantics (network code
 * + mobile number instead of bank code + account number).
 */
class FlutterwaveTransferProvider implements PayoutProvider {
  async sendPayout(request: PayoutRequest): Promise<PayoutResult> {
    if (!env.PAYOUT_AFRICA_API_KEY) {
      return { providerReference: "", status: "REJECTED", reason: "Flutterwave API key not configured" };
    }

    let accountBank: string;
    let accountNumber: string;

    if (request.recipient.payoutMethod === "BANK_TRANSFER") {
      if (!request.recipient.bankCode || !request.recipient.accountNumber) {
        return { providerReference: "", status: "REJECTED", reason: "Missing bank details for this recipient" };
      }
      accountBank = request.recipient.bankCode;
      accountNumber = decryptField(request.recipient.accountNumber);
    } else {
      if (!request.recipient.mobileNetwork || !request.recipient.mobileNumber) {
        return { providerReference: "", status: "REJECTED", reason: "Missing mobile money details for this recipient" };
      }
      if (!isMobileMoneySupported(request.receiveCountry)) {
        return {
          providerReference: "",
          status: "REJECTED",
          reason: `Mobile money payouts aren't supported for ${request.receiveCountry} yet`,
        };
      }
      accountBank = request.recipient.mobileNetwork;
      accountNumber = decryptField(request.recipient.mobileNumber);
    }

    const isTestKey = env.PAYOUT_AFRICA_API_KEY.includes("_TEST-");
    // Sandbox transfers otherwise sit in PENDING indefinitely; this special
    // reference suffix tells Flutterwave's test environment to resolve it
    // (as a success) after about a minute. Never applied with a live key.
    const reference = isTestKey ? `${request.transactionId}_PMCKDU_1` : request.transactionId;

    const res = await fetch(`${FLUTTERWAVE_BASE_URL}/transfers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PAYOUT_AFRICA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_bank: accountBank,
        account_number: accountNumber,
        amount: Number(request.amountMinor) / 100,
        currency: request.receiveCurrency,
        reference,
        narration: `Sende transfer ${request.transactionId}`,
        beneficiary_name: request.recipient.fullName,
      }),
    });

    const body = (await res.json()) as { status: string; message: string; data?: unknown };

    if (!res.ok || body.status !== "success") {
      logger.error(
        { transactionId: request.transactionId, statusCode: res.status, fullResponse: body, sentPayload: { account_bank: accountBank, account_number: accountNumber, amount: Number(request.amountMinor) / 100, currency: request.receiveCurrency } },
        "payout.flutterwave.transfer_failed"
      );
      return { providerReference: reference, status: "REJECTED", reason: body.message };
    }

    logger.info({ transactionId: request.transactionId, reference }, "payout.flutterwave.transfer_accepted");
    return { providerReference: reference, status: "ACCEPTED" };
  }
}

function selectPayoutProvider(country: string): PayoutProvider {
  const configured = AFRICA_COUNTRIES.has(country)
    ? env.PAYOUT_PROVIDER_AFRICA
    : env.PAYOUT_PROVIDER_SOUTH_ASIA;

  switch (configured) {
    case "flutterwave":
      return new FlutterwaveTransferProvider();
    case "mock":
    default:
      return new MockPayoutProvider();
  }
}

export async function dispatchPayout(request: PayoutRequest): Promise<PayoutResult> {
  const provider = selectPayoutProvider(request.receiveCountry);
  return provider.sendPayout(request);
}
/**
 * Bank account name-enquiry ("account resolve") — lets us show the real
 * account holder's name before a recipient is saved, so money can't be
 * sent to the wrong account by typo or fraud. Flutterwave's resolve-account
 * endpoint currently only covers Nigerian banks — do not call this for
 * other countries until that coverage is confirmed and tested.
 */
const FLUTTERWAVE_BASE_URL = "https://api.flutterwave.com/v3";

export interface Bank {
  code: string;
  name: string;
}

export async function listBanksForCountry(country: string): Promise<Bank[]> {
  if (env.PAYOUT_PROVIDER_AFRICA !== "flutterwave" || !env.PAYOUT_AFRICA_API_KEY) {
    return [];
  }

  const res = await fetch(`${FLUTTERWAVE_BASE_URL}/banks/${country}`, {
    headers: { Authorization: `Bearer ${env.PAYOUT_AFRICA_API_KEY}` },
  });

  if (!res.ok) {
    logger.error({ country, status: res.status }, "payout.flutterwave.list_banks_failed");
    return [];
  }

  const body = (await res.json()) as { data?: { code: string; name: string }[] };
  return (body.data ?? []).map((b) => ({ code: b.code, name: b.name }));
}

export async function resolveBankAccount(
  bankCode: string,
  accountNumber: string
): Promise<{ accountName: string } | null> {
  if (env.PAYOUT_PROVIDER_AFRICA !== "flutterwave" || !env.PAYOUT_AFRICA_API_KEY) {
    return null;
  }

  const res = await fetch(`${FLUTTERWAVE_BASE_URL}/accounts/resolve`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PAYOUT_AFRICA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ account_number: accountNumber, account_bank: bankCode }),
  });

  const body = (await res.json()) as {
    status: string;
    message: string;
    data: { account_number: string; account_name: string } | null;
  };

  if (!res.ok || body.status !== "success" || !body.data) {
    logger.info({ bankCode, message: body.message }, "payout.flutterwave.resolve_account_failed");
    return null;
  }

  return { accountName: body.data.account_name };
}

// ---- Nigeria bill payments (airtime/data) — same Flutterwave account,
// different API surface (Bills, not Transfers). Kept in this file since it
// shares the base URL, API key, and error-handling conventions above. ----

export interface BillNetwork {
  billerCode: string;
  itemCode: string;
  network: string;
}

interface RawBillerItem {
  item_code: string;
  biller_name: string;
  amount: number;
  validity_period?: string;
  is_data?: boolean;
}

/**
 * Fetch one network's item catalog and de-duplicate it. Confirmed against
 * sandbox: Flutterwave returns the same item_code twice (different
 * internal `id`, identical everything else) — keep the first occurrence.
 */
async function fetchBillerItems(billerCode: string): Promise<RawBillerItem[]> {
  const itemsRes = await fetch(`${FLUTTERWAVE_BASE_URL}/billers/${billerCode}/items`, {
    headers: { Authorization: `Bearer ${env.PAYOUT_AFRICA_API_KEY}` },
  });
  if (!itemsRes.ok) return [];
  const itemsBody = (await itemsRes.json()) as { data?: RawBillerItem[] };

  const seen = new Set<string>();
  const deduped: RawBillerItem[] = [];
  for (const item of itemsBody.data ?? []) {
    if (seen.has(item.item_code)) continue;
    seen.add(item.item_code);
    deduped.push(item);
  }
  return deduped;
}

/**
 * Discover the biller_code + a representative item_code for airtime/data
 * on each Nigerian network live from Flutterwave. For DATA this is just
 * used to populate the network picker — the real bundle catalog for a
 * chosen network comes from listNigeriaDataBundles below.
 */
export async function listNigeriaBillNetworks(type: "AIRTIME" | "DATA"): Promise<BillNetwork[]> {
  if (env.PAYOUT_PROVIDER_AFRICA !== "flutterwave" || !env.PAYOUT_AFRICA_API_KEY) {
    return [];
  }

  const categoryCode = type === "AIRTIME" ? "AIRTIME" : "MOBILEDATA";

  const billersRes = await fetch(`${FLUTTERWAVE_BASE_URL}/bills/${categoryCode}/billers?country=NG`, {
    headers: { Authorization: `Bearer ${env.PAYOUT_AFRICA_API_KEY}` },
  });
  if (!billersRes.ok) {
    logger.error({ categoryCode, status: billersRes.status }, "payout.flutterwave.list_billers_failed");
    return [];
  }
  const billersBody = (await billersRes.json()) as { data?: { biller_code: string; name: string }[] };

  const networks: BillNetwork[] = [];
  for (const biller of billersBody.data ?? []) {
    const items = await fetchBillerItems(biller.biller_code);
    const item = items[0];
    if (item) {
      networks.push({ billerCode: biller.biller_code, itemCode: item.item_code, network: biller.name });
    }
  }

  return networks;
}

export interface BillDataBundle {
  billerCode: string;
  itemCode: string;
  name: string;
  amountNgnMinor: string;
  validityDays: number | null;
}

/**
 * Full catalog of fixed-price data bundles for one Nigerian network (e.g.
 * every GB size / validity / price combo Glo or MTN sell). Unlike airtime,
 * data bundles are fixed SKUs — a user picks one of these, not an
 * arbitrary amount.
 */
export async function listNigeriaDataBundles(billerCode: string): Promise<BillDataBundle[]> {
  if (env.PAYOUT_PROVIDER_AFRICA !== "flutterwave" || !env.PAYOUT_AFRICA_API_KEY) {
    return [];
  }

  const items = await fetchBillerItems(billerCode);
  return items
    .filter((item) => item.is_data !== false)
    .map((item) => ({
      billerCode,
      itemCode: item.item_code,
      name: item.biller_name,
      amountNgnMinor: String(Math.round(item.amount * 100)),
      validityDays: item.validity_period ? Number(item.validity_period) : null,
    }));
}

/**
 * Look up a data bundle's authoritative fixed price directly from
 * Flutterwave's catalog at payment time, rather than trusting whatever
 * amount the client sent — the amount we actually bill must match the
 * catalog exactly.
 */
export async function getDataBundlePrice(billerCode: string, itemCode: string): Promise<bigint | null> {
  const items = await fetchBillerItems(billerCode);
  const item = items.find((i) => i.item_code === itemCode);
  if (!item) return null;
  return BigInt(Math.round(item.amount * 100));
}

export interface BillPaymentDispatch {
  billerCode: string;
  itemCode: string;
  phoneNumber: string; // plaintext — caller is responsible for decrypting first
  amountNgnMinor: bigint;
  reference: string;
}

export interface BillPaymentDispatchResult {
  status: "ACCEPTED" | "REJECTED";
  reason?: string;
  // Flutterwave's own tracking id for this specific attempt — present on
  // (almost) every response, unlike `customer_reference` on webhooks, which
  // this integration has already seen come back empty on a failure event.
  // Kept as a fallback join key for matching webhooks to BillPayment rows.
  providerTxRef?: string;
}

/**
 * Pay an airtime/data bill via Flutterwave. Like transfers, this returns
 * ACCEPTED for "the request was taken in for processing", not "delivered"
 * — final confirmation arrives asynchronously via the SingleBillPayment
 * webhook event (see payout.routes.ts).
 */
export async function sendBillPayment(request: BillPaymentDispatch): Promise<BillPaymentDispatchResult> {
  if (env.PAYOUT_PROVIDER_AFRICA !== "flutterwave" || !env.PAYOUT_AFRICA_API_KEY) {
    return { status: "REJECTED", reason: "Flutterwave API key not configured" };
  }

  const res = await fetch(
    `${FLUTTERWAVE_BASE_URL}/billers/${request.billerCode}/items/${request.itemCode}/payment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PAYOUT_AFRICA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        country: "NG",
        customer_id: request.phoneNumber,
        amount: Number(request.amountNgnMinor) / 100,
        reference: request.reference,
      }),
    }
  );

  const body = (await res.json()) as {
    status: string;
    message: string;
    data?: { tx_ref?: string; flw_ref?: string };
  };

  if (!res.ok || body.status !== "success") {
    logger.error(
      { reference: request.reference, statusCode: res.status, body },
      "payout.flutterwave.bill_payment_failed"
    );
    return { status: "REJECTED", reason: body.message, providerTxRef: body.data?.tx_ref };
  }

  logger.info({ reference: request.reference, txRef: body.data?.tx_ref }, "payout.flutterwave.bill_payment_accepted");
  return { status: "ACCEPTED", providerTxRef: body.data?.tx_ref };
}