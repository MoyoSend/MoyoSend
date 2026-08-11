const API_BASE = "/api/v1";

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : "Request failed");
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export interface AuthResponse {
  user: { id: string; email: string; kycStatus?: string; role?: string; mfaEnabled?: boolean };
  accessToken: string;
  newDevice?: boolean;
}

function getDeviceFingerprint(): string {
  const KEY = "moyosend_device_id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // localStorage unavailable (private browsing, etc.) — device tracking
    // is a nice-to-have security signal, not worth breaking login over.
    return "unknown";
  }
}

export const api = {
  signUp: (email: string, password: string, homeCountry: string, referralOrPromoCode?: string) =>
    request<AuthResponse>("/auth/signup", {
      method: "POST",
      body: { email, password, homeCountry, referralOrPromoCode, fingerprint: getDeviceFingerprint() },
    }),

  login: (email: string, password: string, mfaCode?: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password, mfaCode, fingerprint: getDeviceFingerprint() },
    }),

  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: { email },
    }),

  resetPassword: (token: string, newPassword: string) =>
    request<{ success: boolean }>("/auth/reset-password", {
      method: "POST",
      body: { token, newPassword },
    }),

  enrollMfa: () => request<{ otpauthUrl: string }>("/auth/mfa/enroll", { method: "POST", body: {} }),

  confirmMfa: (code: string) =>
    request<{ mfaEnabled: boolean }>("/auth/mfa/confirm", { method: "POST", body: { code } }),

  listRecipients: () => request<{ recipients: Recipient[] }>("/recipients"),

  createRecipient: (input: NewRecipient, mfaCode?: string) =>
    request<{ id: string }>("/recipients", { method: "POST", body: { ...input, mfaCode } }),

  updateRecipient: (
    id: string,
    input: {
      fullName?: string;
      bankCode?: string;
      accountNumber?: string;
      mobileNetwork?: string;
      mobileNumber?: string;
    },
    mfaCode?: string
  ) => request<{ id: string; verified: boolean; verifiedAccountName: string | null }>(`/recipients/${id}`, {
    method: "PATCH",
    body: { ...input, mfaCode },
  }),

  deleteRecipient: (id: string) => request<{ archived: boolean }>(`/recipients/${id}`, { method: "DELETE" }),

  getQuote: (sendCurrency: string, receiveCurrency: string, corridorId: string) =>
    request<Quote>("/quotes", { method: "POST", body: { sendCurrency, receiveCurrency, corridorId } }),

  createTransaction: (input: NewTransaction, idempotencyKey: string, mfaCode?: string) =>
    request<{ transaction: Transaction }>("/transactions", {
      method: "POST",
      body: { ...input, mfaCode, fingerprint: getDeviceFingerprint() },
      idempotencyKey,
    }),

  listTransactions: () => request<{ transactions: Transaction[] }>("/transactions"),

  getTransferLimits: () => request<{ limits: TransferLimit[] }>("/transactions/limits"),

  getTransaction: (id: string) => request<{ transaction: TransactionDetail }>(`/transactions/${id}`),

  listCorridors: () => request<{ corridors: Corridor[] }>("/corridors"),

  listBanks: (country: string) => request<{ banks: Bank[] }>(`/recipients/banks/${country}`),

  resolveAccount: (country: string, bankCode: string, accountNumber: string) =>
    request<{ accountName: string }>("/recipients/resolve-account", {
      method: "POST",
      body: { country, bankCode, accountNumber },
    }),

  listMobileNetworks: (country: string) => request<{ networks: Bank[] }>(`/recipients/mobile-networks/${country}`),

  adminSearchTransactions: (params: { status?: string; senderEmail?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.senderEmail) qs.set("senderEmail", params.senderEmail);
    if (params.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<{ transactions: AdminTransaction[] }>(`/admin/transactions${query ? `?${query}` : ""}`);
  },

  adminRefundTransaction: (id: string, reason: string) =>
    request<{ status: string }>(`/admin/transactions/${id}/refund`, { method: "POST", body: { reason } }),

  adminListPromoCodes: () => request<{ promoCodes: AdminPromoCode[] }>("/admin/promo-codes"),

  adminCreatePromoCode: (input: {
    code: string;
    label: string;
    bonusAmountMinor: string;
    bonusCurrency: string;
    maxUses?: number;
    expiresAt?: string;
  }) => request<{ promoCode: AdminPromoCode }>("/admin/promo-codes", { method: "POST", body: input }),

  adminTogglePromoCode: (id: string) =>
    request<{ promoCode: AdminPromoCode }>(`/admin/promo-codes/${id}/toggle-active`, { method: "POST" }),

  getReferralInfo: () => request<ReferralInfo>("/referrals/me"),

  createPaymentIntent: (
    amountMinor: string,
    currency: string,
    transactionRef: string,
    options?: { paymentMethodId?: string; savePaymentMethod?: boolean }
  ) =>
    request<{ clientSecret: string; paymentIntentId: string; status: string }>("/payments/create-intent", {
      method: "POST",
      body: { amountMinor, currency, transactionRef, ...options },
    }),

  createSetupIntent: () => request<{ clientSecret: string }>("/payments/setup-intent", { method: "POST", body: {} }),

  listPaymentMethods: () => request<{ cards: SavedCard[] }>("/payments/payment-methods"),

  deletePaymentMethod: (id: string) =>
    request<{ removed: boolean }>(`/payments/payment-methods/${id}`, { method: "DELETE" }),

  listBillNetworks: (type: "AIRTIME" | "DATA") =>
    request<{ networks: BillNetwork[] }>(`/bills/networks?type=${type}`),

  listDataBundles: (billerCode: string) =>
    request<{ bundles: BillDataBundle[] }>(`/bills/data-bundles?billerCode=${encodeURIComponent(billerCode)}`),

  createBillPayment: (
    input: {
      type: "AIRTIME" | "DATA";
      network: string;
      billerCode: string;
      itemCode: string;
      phoneNumber: string;
      ngnAmountMinor?: string;
      sendCurrency: string;
      paymentIntentId: string;
      sendAmountMinor: string;
    },
    idempotencyKey: string
  ) => request<{ billPayment: BillPayment }>("/bills", { method: "POST", body: input, idempotencyKey }),

  listBillPayments: () => request<{ billPayments: BillPayment[] }>("/bills"),

  requestLimitIncrease: (documentType: LimitIncreaseDocumentType) =>
    request<{ status: string; verificationUrl: string | null }>("/limits/increase-requests", {
      method: "POST",
      body: { documentType },
    }),

  getLimitIncreaseStatus: () =>
    request<{ status: string | null; documentType: string | null; verificationUrl: string | null }>(
      "/limits/increase-requests/latest"
    ),
};

export type LimitIncreaseDocumentType = "PAY_SLIP" | "BANK_STATEMENT" | "TAX_RETURN" | "INVESTMENT_PENSION";

export interface BillNetwork {
  billerCode: string;
  itemCode: string;
  network: string;
}

export interface BillDataBundle {
  billerCode: string;
  itemCode: string;
  name: string;
  amountNgnMinor: string;
  validityDays: number | null;
}

export interface BillPayment {
  id: string;
  type: "AIRTIME" | "DATA";
  network: string;
  sendAmount: string;
  sendCurrency: string;
  ngnAmountMinor: string;
  status: string;
  createdAt: string;
}

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface ReferralInfo {
  referralCode: string | null;
  referralCount: number;
  totalEarnedByCurrency: Record<string, string>;
}

export interface Corridor {
  id: string;
  sendCurrency: string;
  receiveCountry: string;
  receiveCurrency: string;
  payoutMethods: ("BANK_TRANSFER" | "MOBILE_MONEY")[];
  minSendMinor: string;
  maxSendMinor: string;
  feeFlatMinor: string;
  feeBps: number;
}

export interface Recipient {
  id: string;
  fullName: string;
  country: string;
  payoutMethod: "BANK_TRANSFER" | "MOBILE_MONEY";
  verified: boolean;
  verifiedAccountName?: string | null;
  bankCode?: string | null;
  mobileNetwork?: string | null;
}

export interface Bank {
  code: string;
  name: string;
}

export interface NewRecipient {
  fullName: string;
  country: string;
  payoutMethod: "BANK_TRANSFER" | "MOBILE_MONEY";
  bankCode?: string;
  accountNumber?: string;
  mobileNetwork?: string;
  mobileNumber?: string;
}

export interface Quote {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  midMarketRate: number;
  appliedRate: number;
  fxMarginBps: number;
  expiresAt: string;
}

export interface NewTransaction {
  recipientId: string;
  corridorId: string;
  sendAmountMinor: string;
  paymentIntentId?: string;
}

export interface Transaction {
  id: string;
  status: string;
  sendAmount: string;
  sendCurrency: string;
  receiveAmount: string;
  receiveCurrency: string;
  createdAt: string;
}

export interface TransferLimit {
  currency: string;
  usedMinor: string;
  limitMinor: string;
  windowHours: number;
}

export interface TransactionStatusEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  actor: string;
  createdAt: string;
}

export interface TransactionDetail extends Transaction {
  feeAmount: string;
  fxRateLocked: string;
  payoutReference: string | null;
  updatedAt: string;
  recipient: { id: string; fullName: string; country: string; payoutMethod: string };
  statusEvents: TransactionStatusEvent[];
}

export interface AdminPromoCode {
  id: string;
  code: string;
  label: string;
  bonusAmountMinor: string;
  bonusCurrency: string;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface AdminTransaction {
  id: string;
  status: string;
  sendAmount: string;
  sendCurrency: string;
  receiveAmount: string;
  receiveCurrency: string;
  createdAt: string;
  sender: { id: string; email: string; kycStatus: string };
  recipient: { fullName: string; country: string };
}

export { ApiError };
