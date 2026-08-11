import Stripe from "stripe";
import { env } from "../../config/env";
import { prisma } from "../../db/client";

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

export const stripeEnabled = Boolean(stripe);

/**
 * Every user gets at most one Stripe Customer object, created lazily the
 * first time they save or use a card. The id is cached on User so we never
 * create duplicate customers for the same person.
 */
export async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe is not configured — set STRIPE_SECRET_KEY to save cards");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({ email, metadata: { userId } });
  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/**
 * A SetupIntent saves a card to the customer without charging anything —
 * used by the "Manage Cards" add-card flow, as opposed to
 * createPaymentIntent (with setup_future_usage) which saves a card as a
 * side effect of an actual payment.
 */
export async function createSetupIntent(customerId: string) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }
  return stripe.setupIntents.create({ customer: customerId, automatic_payment_methods: { enabled: true } });
}

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export async function listPaymentMethods(customerId: string): Promise<SavedCard[]> {
  if (!stripe) return [];
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card" });
  return methods.data
    .filter((m) => m.card)
    .map((m) => ({
      id: m.id,
      brand: m.card!.brand,
      last4: m.card!.last4,
      expMonth: m.card!.exp_month,
      expYear: m.card!.exp_year,
    }));
}

/**
 * Detach a saved card from its customer. Caller is responsible for
 * confirming the payment method actually belongs to the requesting user's
 * Stripe customer before calling this — see payments.routes.ts.
 */
export async function detachPaymentMethod(paymentMethodId: string) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }
  await stripe.paymentMethods.detach(paymentMethodId);
}

/**
 * Create a Stripe PaymentIntent for a pending transaction. The frontend
 * uses the returned client secret to collect card details and confirm the
 * charge directly with Stripe — our server never sees the raw card number.
 */
export interface CreatePaymentIntentOptions {
  customerId?: string;
  // Charge a previously-saved card directly instead of collecting a new
  // one — confirmed immediately since the cardholder is already present
  // (about to enter their step-up code), so there's no need to show the
  // full Payment Element / Payment Sheet UI again.
  paymentMethodId?: string;
  // For new cards only: save this card to the customer after a successful
  // charge, so it shows up next time in Manage Cards.
  savePaymentMethod?: boolean;
}

export async function createPaymentIntent(
  amountMinor: bigint,
  currency: string,
  metadata: Record<string, string>,
  options: CreatePaymentIntentOptions = {}
) {
  if (!stripe) {
    throw new Error("Stripe is not configured — set STRIPE_SECRET_KEY to collect real payments");
  }

  if (options.paymentMethodId) {
    return stripe.paymentIntents.create({
      amount: Number(amountMinor),
      currency: currency.toLowerCase(),
      metadata,
      customer: options.customerId,
      payment_method: options.paymentMethodId,
      payment_method_types: ["card"],
      off_session: false,
      confirm: true,
    });
  }

  return stripe.paymentIntents.create({
    amount: Number(amountMinor),
    currency: currency.toLowerCase(),
    metadata,
    customer: options.customerId,
    setup_future_usage: options.savePaymentMethod ? "on_session" : undefined,
    automatic_payment_methods: { enabled: true },
  });
}

/**
 * Verify + parse a Stripe webhook event from the raw request body. Stripe
 * signs the exact raw bytes it sent, so this only works if the caller
 * passes the unparsed body — see payments.routes.ts's buffer content-type
 * parser scoped to just the webhook route.
 */
export function constructWebhookEvent(rawBody: Buffer, signature: string) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Stripe webhook is not configured");
  }
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

export class PaymentNotVerifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentNotVerifiedError";
  }
}

/**
 * Confirm a Stripe PaymentIntent actually succeeded, and that it's for the
 * exact amount/currency this transaction expects, before we ever touch the
 * ledger or dispatch a payout. Never trust the client's own claim that a
 * charge succeeded — always re-check against Stripe directly.
 */
export async function verifyPaymentIntent(
  paymentIntentId: string,
  expectedAmountMinor: bigint,
  expectedCurrency: string
) {
  if (!stripe) {
    throw new PaymentNotVerifiedError("Stripe is not configured");
  }
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (intent.status !== "succeeded") {
    throw new PaymentNotVerifiedError(`Payment has not succeeded (status: ${intent.status})`);
  }
  if (intent.amount !== Number(expectedAmountMinor)) {
    throw new PaymentNotVerifiedError("Payment amount does not match the transaction amount");
  }
  if (intent.currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
    throw new PaymentNotVerifiedError("Payment currency does not match the transaction currency");
  }

  return intent;
}

/**
 * Refund a Stripe PaymentIntent for real — used when a transaction fails or
 * is reversed after the cardholder was already charged (payout rejected,
 * compliance reversal, admin refund, etc). The idempotency key is supplied
 * by the caller, derived from the transaction id, so retries (e.g. a
 * webhook firing twice) can never trigger two refunds on the same charge.
 */
export async function refundPaymentIntent(
  paymentIntentId: string,
  metadata: Record<string, string>,
  idempotencyKey: string
) {
  if (!stripe) {
    throw new Error("Stripe is not configured — set STRIPE_SECRET_KEY to issue refunds");
  }
  return stripe.refunds.create({ payment_intent: paymentIntentId, metadata }, { idempotencyKey });
}
