import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const API_BASE = "http://192.168.0.20:3000/api/v1";

const TOKEN_KEY = "moyosend_access_token";
const DEVICE_ID_KEY = "moyosend_device_id";

// expo-secure-store is a native module and doesn't exist in a web browser.
// The real app targets iOS/Android where SecureStore is used properly; the
// localStorage fallback here exists purely so the same code can be
// sanity-checked in a browser during development.
export async function setAccessToken(token: string | null) {
  if (Platform.OS === "web") {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    return;
  }
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

// A stable per-install id so the backend can recognize "this is a device
// we've seen this user log in from before" — see requireStepUpForRisk in
// sende-backend/src/middleware/auth.ts. Not tied to identity, just to this
// one app install.
async function getDeviceFingerprint(): Promise<string> {
  try {
    if (Platform.OS === "web") {
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    }
    let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : "Request failed"
    );
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {}
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export function newIdempotencyKey(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface AuthResponse {
  user: { id: string; email: string; kycStatus?: string; role?: string };
  accessToken: string;
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
}

export interface Bank {
  code: string;
  name: string;
}

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface NewRecipient {
  fullName: string;
  country: string;
  payoutMethod: "BANK_TRANSFER" | "MOBILE_MONEY";
  bankCode?: string;
  accountNumber?: string;
  mobileNetwork?: string;
  mobileNumber?: string;
  mfaCode?: string;
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

export interface TransactionStatusEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  actor: string;
  createdAt: string;
}

export interface TransactionDetail extends Transaction {
  recipientId: string;
  corridorId: string;
  feeAmount: string;
  fxRateLocked: string;
  payoutReference: string | null;
  failureReason: string | null;
  updatedAt: string;
  recipient: Recipient;
  statusEvents: TransactionStatusEvent[];
}

export const api = {
  signUp: (email: string, password: string, homeCountry: string) =>
    request<AuthResponse>("/auth/signup", { method: "POST", body: { email, password, homeCountry } }),

  login: (email: string, password: string, mfaCode?: string) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: { email, password, mfaCode } }),

  listCorridors: () => request<{ corridors: Corridor[] }>("/corridors"),

  listRecipients: () => request<{ recipients: Recipient[] }>("/recipients"),

  createRecipient: (input: NewRecipient) =>
    request<{ id: string }>("/recipients", { method: "POST", body: input }),

  listBanks: (country: string) => request<{ banks: Bank[] }>(`/recipients/banks/${country}`),

  resolveAccount: (country: string, bankCode: string, accountNumber: string) =>
    request<{ accountName: string }>("/recipients/resolve-account", {
      method: "POST",
      body: { country, bankCode, accountNumber },
    }),

  listMobileNetworks: (country: string) => request<{ networks: Bank[] }>(`/recipients/mobile-networks/${country}`),

  getQuote: (sendCurrency: string, receiveCurrency: string, corridorId: string) =>
    request<Quote>("/quotes", { method: "POST", body: { sendCurrency, receiveCurrency, corridorId } }),

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

  createTransaction: async (input: NewTransaction, idempotencyKey: string, mfaCode?: string) => {
    const fingerprint = await getDeviceFingerprint();
    return request<{ transaction: Transaction }>("/transactions", {
      method: "POST",
      body: { ...input, mfaCode, fingerprint },
      idempotencyKey,
    });
  },

  listTransactions: () => request<{ transactions: Transaction[] }>("/transactions"),

  getTransaction: (id: string) => request<{ transaction: TransactionDetail }>(`/transactions/${id}`),
};

export { ApiError };