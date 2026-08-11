import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import {
  createPaymentIntent,
  constructWebhookEvent,
  getOrCreateStripeCustomer,
  createSetupIntent,
  listPaymentMethods,
  detachPaymentMethod,
} from "./payment.service";
import { prisma } from "../../db/client";
import { logger } from "../../utils/logger";

const createIntentSchema = z.object({
  amountMinor: z.coerce.bigint().positive(),
  currency: z.string().length(3),
  transactionRef: z.string().min(1),
  paymentMethodId: z.string().optional(),
  savePaymentMethod: z.boolean().optional(),
});

export default async function paymentsRoutes(app: FastifyInstance) {
  app.post("/payments/create-intent", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = createIntentSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    const customerId = await getOrCreateStripeCustomer(req.user.sub, user.email);

    const intent = await createPaymentIntent(
      body.amountMinor,
      body.currency,
      { userId: req.user.sub, transactionRef: body.transactionRef },
      { customerId, paymentMethodId: body.paymentMethodId, savePaymentMethod: body.savePaymentMethod }
    );
    return reply.send({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      status: intent.status,
    });
  });

  app.post("/payments/setup-intent", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    const customerId = await getOrCreateStripeCustomer(req.user.sub, user.email);
    const setupIntent = await createSetupIntent(customerId);
    return reply.send({ clientSecret: setupIntent.client_secret });
  });

  app.get("/payments/payment-methods", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    if (!user.stripeCustomerId) return reply.send({ cards: [] });
    const cards = await listPaymentMethods(user.stripeCustomerId);
    return reply.send({ cards });
  });

  app.delete("/payments/payment-methods/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    if (!user.stripeCustomerId) return reply.notFound();

    // Confirm this payment method actually belongs to the requesting
    // user's own Stripe customer before detaching it — otherwise anyone
    // could remove someone else's saved card by guessing its id.
    const cards = await listPaymentMethods(user.stripeCustomerId);
    if (!cards.some((c) => c.id === params.id)) return reply.notFound();

    await detachPaymentMethod(params.id);
    return reply.send({ removed: true });
  });

  // Stripe requires the raw, unparsed request body to verify its webhook
  // signature. Registering a buffer content-type parser inside this nested
  // plugin scopes it to just this route — every other JSON endpoint in the
  // app keeps using the default parser, thanks to Fastify's encapsulation.
  app.register(async function stripeWebhookScope(instance) {
    instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });

    instance.post("/webhooks/stripe", async (req, reply) => {
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string") {
        return reply.unauthorized("Missing Stripe signature");
      }

      let event;
      try {
        event = constructWebhookEvent(req.body as Buffer, signature);
      } catch (err) {
        logger.warn({ err }, "payments.stripe.invalid_webhook_signature");
        return reply.unauthorized("Invalid Stripe signature");
      }

      logger.info({ type: event.type }, "payments.stripe.webhook_received");
      // Event handling (payment_intent.succeeded / payment_failed) comes
      // in the next step, once we've confirmed this endpoint is reachable.

      return reply.send({ received: true });
    });
  });
}