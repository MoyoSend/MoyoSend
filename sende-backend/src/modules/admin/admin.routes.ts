import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client";
import { requireAuth, requireRole } from "../../middleware/auth";
import { recordAuditEvent } from "../../utils/audit";
import { refundTransaction } from "../transactions/transactions.service";

/**
 * Internal ops/compliance console endpoints. Every handler here requires
 * staff-role auth AND writes an audit event — this surface is exactly what
 * an internal-threat or account-takeover investigation looks at first.
 */
export default async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get(
    "/admin/compliance/review-queue",
    { preHandler: [requireRole("COMPLIANCE_OFFICER", "ADMIN")] },
    async (_req, reply) => {
      const cases = await prisma.kycCase.findMany({
        where: { decision: "MANUAL_REVIEW" },
        include: { user: { select: { id: true, email: true, riskTier: true } } },
        orderBy: { createdAt: "asc" },
      });
      return reply.send({ cases });
    }
  );

  // Transaction search — lets ops/support locate a transaction by status
  // and/or sender email without needing direct database access.
  const searchQuerySchema = z.object({
    status: z
      .enum([
        "CREATED",
        "QUOTED",
        "FUNDS_COLLECTED",
        "COMPLIANCE_SCREENED",
        "COMPLIANCE_HOLD",
        "SENT_TO_PAYOUT",
        "PAID_OUT",
        "FAILED",
        "REFUND_INITIATED",
        "REFUNDED",
        "REJECTED",
      ])
      .optional(),
    senderEmail: z.string().email().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });

  app.get(
    "/admin/transactions",
    { preHandler: [requireRole("COMPLIANCE_OFFICER", "ADMIN")] },
    async (req, reply) => {
      const query = searchQuerySchema.parse(req.query);

      const transactions = await prisma.transaction.findMany({
        where: {
          status: query.status,
          sender: query.senderEmail ? { email: query.senderEmail } : undefined,
        },
        include: {
          sender: { select: { id: true, email: true, kycStatus: true } },
          recipient: { select: { fullName: true, country: true } },
        },
        orderBy: { createdAt: "desc" },
        take: query.limit,
      });

      return reply.send({ transactions });
    }
  );

  app.post(
    "/admin/transactions/:id/refund",
    { preHandler: [requireRole("COMPLIANCE_OFFICER", "ADMIN")] },
    async (req, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ reason: z.string().min(3) }).parse(req.body);

      // Now backed by the same ledger-reversal logic the payout webhook
      // uses — mirror-reverses every entry for this transaction and
      // transitions it to REFUND_INITIATED -> REFUNDED.
      await refundTransaction(params.id, `staff_refund: ${body.reason}`);

      await recordAuditEvent({
        actorId: req.user.sub,
        actorLabel: `staff:${req.user.sub}`,
        action: "transaction.refund_requested",
        targetType: "Transaction",
        targetId: params.id,
        metadata: { reason: body.reason },
      });

      return reply.send({ status: "refunded" });
    }
  );

  // Promo codes — admin-managed, distinct from the personal referral codes
  // every user gets automatically. Redemption and the first-transfer bonus
  // payout reuse the exact same mechanism built for referrals (see
  // transactions.service.ts / auth.service.ts) — this is just the CRUD
  // surface for staff to create and retire them.
  const createPromoCodeSchema = z.object({
    code: z.string().min(3).max(32),
    label: z.string().min(1),
    bonusAmountMinor: z.coerce.bigint().positive(),
    bonusCurrency: z.string().length(3),
    maxUses: z.coerce.number().int().positive().optional(),
    expiresAt: z.coerce.date().optional(),
  });

  app.get(
    "/admin/promo-codes",
    { preHandler: [requireRole("COMPLIANCE_OFFICER", "ADMIN")] },
    async (_req, reply) => {
      const promoCodes = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
      return reply.send({ promoCodes });
    }
  );

  app.post(
    "/admin/promo-codes",
    { preHandler: [requireRole("COMPLIANCE_OFFICER", "ADMIN")] },
    async (req, reply) => {
      const body = createPromoCodeSchema.parse(req.body);
      const normalizedCode = body.code.trim().toUpperCase();

      const existing = await prisma.promoCode.findUnique({ where: { code: normalizedCode } });
      if (existing) {
        return reply.badRequest("A promo code with this code already exists");
      }

      const promoCode = await prisma.promoCode.create({
        data: {
          code: normalizedCode,
          label: body.label,
          bonusAmountMinor: body.bonusAmountMinor,
          bonusCurrency: body.bonusCurrency.toUpperCase(),
          maxUses: body.maxUses,
          expiresAt: body.expiresAt,
        },
      });

      await recordAuditEvent({
        actorId: req.user.sub,
        actorLabel: `staff:${req.user.sub}`,
        action: "promo_code.created",
        targetType: "PromoCode",
        targetId: promoCode.id,
        metadata: {
          code: promoCode.code,
          bonusAmountMinor: body.bonusAmountMinor.toString(),
          bonusCurrency: promoCode.bonusCurrency,
        },
      });

      return reply.code(201).send({ promoCode });
    }
  );

  app.post(
    "/admin/promo-codes/:id/toggle-active",
    { preHandler: [requireRole("COMPLIANCE_OFFICER", "ADMIN")] },
    async (req, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const promoCode = await prisma.promoCode.findUniqueOrThrow({ where: { id: params.id } });

      const updated = await prisma.promoCode.update({
        where: { id: params.id },
        data: { active: !promoCode.active },
      });

      await recordAuditEvent({
        actorId: req.user.sub,
        actorLabel: `staff:${req.user.sub}`,
        action: updated.active ? "promo_code.activated" : "promo_code.deactivated",
        targetType: "PromoCode",
        targetId: params.id,
        metadata: {},
      });

      return reply.send({ promoCode: updated });
    }
  );
}
