import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client";
import { requireAuth } from "../../middleware/auth";
import { requireIdempotencyKey, getIdempotencyKey } from "../../middleware/idempotency";
import { listNigeriaBillNetworks, listNigeriaDataBundles } from "../payout/payout.service";
import { createAndProcessBillPayment } from "./bill.service";
import { ComplianceHoldError } from "../transactions/transactions.service";

const createBillPaymentSchema = z
  .object({
    type: z.enum(["AIRTIME", "DATA"]),
    network: z.string().min(1),
    billerCode: z.string().min(1),
    itemCode: z.string().min(1),
    phoneNumber: z.string().min(5),
    ngnAmountMinor: z.coerce.bigint().positive().optional(),
    sendCurrency: z.string().length(3),
    paymentIntentId: z.string().min(1),
    sendAmountMinor: z.coerce.bigint().positive(),
  })
  .refine((data) => data.type !== "AIRTIME" || data.ngnAmountMinor !== undefined, {
    message: "ngnAmountMinor is required for airtime top-ups",
    path: ["ngnAmountMinor"],
  });

export default async function billsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/bills/networks", async (req, reply) => {
    const query = z.object({ type: z.enum(["AIRTIME", "DATA"]) }).parse(req.query);
    const networks = await listNigeriaBillNetworks(query.type);
    return reply.send({ networks });
  });

  app.get("/bills/data-bundles", async (req, reply) => {
    const query = z.object({ billerCode: z.string().min(1) }).parse(req.query);
    const bundles = await listNigeriaDataBundles(query.billerCode);
    return reply.send({ bundles });
  });

  app.post(
    "/bills",
    {
      preHandler: [requireIdempotencyKey],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = createBillPaymentSchema.parse(req.body);
      const idempotencyKey = getIdempotencyKey(req);

      try {
        const billPayment = await createAndProcessBillPayment({
          idempotencyKey,
          userId: req.user.sub,
          type: body.type,
          network: body.network,
          billerCode: body.billerCode,
          itemCode: body.itemCode,
          phoneNumber: body.phoneNumber,
          ngnAmountMinor: body.ngnAmountMinor,
          sendCurrency: body.sendCurrency,
          paymentIntentId: body.paymentIntentId,
          sendAmountMinor: body.sendAmountMinor,
        });
        return reply.code(201).send({ billPayment });
      } catch (err) {
        if (err instanceof ComplianceHoldError) {
          return reply.code(202).send({ status: "COMPLIANCE_HOLD", reasons: err.reasons });
        }
        throw err;
      }
    }
  );

  app.get("/bills", async (req, reply) => {
    const billPayments = await prisma.billPayment.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return reply.send({ billPayments });
  });

  app.get("/bills/:id", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const billPayment = await prisma.billPayment.findFirst({ where: { id: params.id, userId: req.user.sub } });
    if (!billPayment) return reply.notFound();
    return reply.send({ billPayment });
  });
}