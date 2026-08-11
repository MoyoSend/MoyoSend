import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client";
import { requireAuth, requireStepUpForRisk } from "../../middleware/auth";
import { requireIdempotencyKey, getIdempotencyKey } from "../../middleware/idempotency";
import { createQuote } from "../fx/fx.service";
import {
  createAndProcessTransaction,
  ComplianceHoldError,
  InsufficientFundsError,
  DAILY_VELOCITY_LIMIT_MINOR,
} from "./transactions.service";
import { PaymentNotVerifiedError } from "../payments/payment.service";

const quoteSchema = z.object({
  sendCurrency: z.string().length(3),
  receiveCurrency: z.string().length(3),
  corridorId: z.string().uuid(),
});

const createTransactionSchema = z.object({
  recipientId: z.string().uuid(),
  corridorId: z.string().uuid(),
  sendAmountMinor: z.coerce.bigint().positive(),
  paymentIntentId: z.string().min(1).optional(),
});

export default async function transactionsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.post("/quotes", async (req, reply) => {
    const body = quoteSchema.parse(req.body);
    const corridor = await prisma.corridor.findUniqueOrThrow({ where: { id: body.corridorId } });
    const quote = await createQuote(body.sendCurrency, body.receiveCurrency, corridor.fxMarginBps);
    return reply.send(quote);
  });

  // Money-moving endpoint: idempotency key is mandatory, plus a tighter
  // rate limit than general reads.
  app.post(
    "/transactions",
    {
      preHandler: [requireIdempotencyKey, requireStepUpForRisk],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = createTransactionSchema.parse(req.body);
      const idempotencyKey = getIdempotencyKey(req);

      try {
        const transaction = await createAndProcessTransaction({
          idempotencyKey,
          senderId: req.user.sub,
          recipientId: body.recipientId,
          corridorId: body.corridorId,
          sendAmountMinor: body.sendAmountMinor,
          paymentIntentId: body.paymentIntentId,
        });
        return reply.code(201).send({ transaction });
      } catch (err) {
        if (err instanceof ComplianceHoldError) {
          return reply.code(202).send({ status: "COMPLIANCE_HOLD", reasons: err.reasons });
        }
        if (err instanceof InsufficientFundsError) {
          return reply.badRequest(err.message);
        }
        if (err instanceof PaymentNotVerifiedError) {
          return reply.code(402).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // Surfaces the same velocity limit runComplianceScreening enforces, so
  // users can see their usage before hitting a compliance hold instead of
  // discovering the limit only when a transfer gets blocked.
  app.get("/transactions/limits", async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    const effectiveLimitMinor = user.dailyLimitOverrideMinor ?? DAILY_VELOCITY_LIMIT_MINOR;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const usageByCurrency = await prisma.transaction.groupBy({
      by: ["sendCurrency"],
      where: {
        senderId: req.user.sub,
        createdAt: { gte: since },
        status: { notIn: ["FAILED", "REJECTED", "REFUNDED"] },
      },
      _sum: { sendAmount: true },
    });

    const limits = usageByCurrency.map((row) => ({
      currency: row.sendCurrency,
      usedMinor: row._sum.sendAmount ?? 0n,
      limitMinor: effectiveLimitMinor,
      windowHours: 24,
    }));

    return reply.send({ limits });
  });

  app.get("/transactions/:id", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const transaction = await prisma.transaction.findFirst({
      where: { id: params.id, senderId: req.user.sub },
    include: {
      statusEvents: { orderBy: { createdAt: "asc" } },
      recipient: true,
    },
    });
    if (!transaction) return reply.notFound();
    return reply.send({ transaction });
  });

  app.get("/transactions", async (req, reply) => {
    const transactions = await prisma.transaction.findMany({
      where: { senderId: req.user.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return reply.send({ transactions });
  });
}
