import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { createPaymentIntent } from "../payments/payment.service";
import { getOrCreateStripeCustomer } from "../payments/payment.service";
import { createAndProcessWalletTopUp, listWalletBalances } from "./wallet.service";
import { prisma } from "../../db/client";

const createTopUpIntentSchema = z.object({
  amountMinor: z.coerce.bigint().positive(),
  currency: z.string().length(3),
  paymentMethodId: z.string().optional(),
  savePaymentMethod: z.boolean().optional(),
});

const confirmTopUpSchema = z.object({
  amountMinor: z.coerce.bigint().positive(),
  currency: z.string().length(3),
  paymentIntentId: z.string().min(1),
});

export default async function walletRoutes(app: FastifyInstance) {
  // Step 1: start a top-up — creates a Stripe PaymentIntent the frontend
  // uses to collect card details, same two-step pattern as
  // /payments/create-intent.
  app.post("/wallet/top-up/intent", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = createTopUpIntentSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    const customerId = await getOrCreateStripeCustomer(req.user.sub, user.email);

    const intent = await createPaymentIntent(
      body.amountMinor,
      body.currency,
      { userId: req.user.sub, purpose: "wallet_top_up" },
      { customerId, paymentMethodId: body.paymentMethodId, savePaymentMethod: body.savePaymentMethod }
    );
    return reply.send({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      status: intent.status,
    });
  });

  // Step 2: once the frontend confirms the card charge with Stripe, call
  // this to verify it server-side and credit the wallet.
  app.post("/wallet/top-up/confirm", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = confirmTopUpSchema.parse(req.body);
    const idempotencyKey = req.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || !idempotencyKey) {
      return reply.badRequest("Missing Idempotency-Key header");
    }
    const topUp = await createAndProcessWalletTopUp({
      idempotencyKey,
      userId: req.user.sub,
      amountMinor: body.amountMinor,
      currency: body.currency,
      paymentIntentId: body.paymentIntentId,
    });
    return reply.send({ walletTopUp: topUp });
  });

  app.get("/wallet/balances", { preHandler: [requireAuth] }, async (req, reply) => {
    const balances = await listWalletBalances(req.user.sub);
    return reply.send({
      balances: balances.map((b) => ({ currency: b.currency, balanceMinor: b.balanceMinor.toString() })),
    });
  });
}