import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  kycProvider,
  applyKycDecision,
  getLatestKycCase,
  startLimitIncreaseRequest,
  getLatestLimitIncreaseRequest,
  applyLimitIncreaseDecision,
} from "./kyc.service";
import { recordAuditEvent } from "../../utils/audit";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../db/client";
import { logger } from "../../utils/logger";

// Didit's real webhook payload. passthrough() keeps extra fields (like
// `decision`) around without us having to model every one of them.
const diditWebhookSchema = z
  .object({
    session_id: z.string(),
    status: z.string(),
    webhook_type: z.string().optional(),
  })
  .passthrough();

// Legacy shape used by the local mock-provider test scripts
// (approve-kyc.js). Only reachable when KYC_PROVIDER=mock.
const mockWebhookSchema = z.object({
  vendorReference: z.string(),
  decision: z.enum(["APPROVED", "REJECTED", "MANUAL_REVIEW"]),
  riskFlags: z.array(z.string()).default([]),
});

// Didit's verification statuses -> our internal decision. Anything not
// listed here (In Progress, Not Started, Awaiting User, Resubmitted, ...)
// just means "still pending" — we don't touch the record for those.
const DIDIT_STATUS_MAP: Record<string, "APPROVED" | "REJECTED" | "MANUAL_REVIEW"> = {
  Approved: "APPROVED",
  Declined: "REJECTED",
  Abandoned: "REJECTED",
  Expired: "REJECTED",
  "Kyc Expired": "REJECTED",
  "In Review": "MANUAL_REVIEW",
};

export default async function kycRoutes(app: FastifyInstance) {
  // Vendor webhook — authenticated by HMAC signature, NOT by JWT (the
  // vendor is not a logged-in user). Never trust an inbound KYC decision
  // without verifying this signature; a spoofed "APPROVED" here is a
  // direct path to unlimited money movement by an unverified user.
  app.post("/webhooks/kyc", async (req, reply) => {
    const signatureV2 = req.headers["x-signature-v2"];
    const timestamp = req.headers["x-timestamp"];
    const legacySignature = req.headers["x-webhook-signature"];

    if (typeof signatureV2 === "string" && typeof timestamp === "string") {
      // Real Didit webhook.
      if (!kycProvider.verifyWebhookSignature(req.body, signatureV2, timestamp)) {
        return reply.unauthorized("Invalid webhook signature");
      }

      const body = diditWebhookSchema.parse(req.body);
      const decision = DIDIT_STATUS_MAP[body.status];

      if (!decision) {
        // Still in progress — acknowledge, but don't change anything yet.
        return reply.send({ received: true, ignored: true, status: body.status });
      }

      // Didit is shared across two different session purposes (identity
      // KYC and limit-increase document review), each tracked in its own
      // table. A session_id only ever belongs to one — check which before
      // applying a decision, so one can never be mistaken for the other.
      const kycCase = await prisma.kycCase.findFirst({ where: { vendorReference: body.session_id } });
      if (kycCase) {
        await applyKycDecision(body.session_id, decision, []);
        await recordAuditEvent({
          actorLabel: "webhook:didit",
          action: "kyc.decision_received",
          targetType: "KycCase",
          targetId: body.session_id,
          metadata: { status: body.status, decision },
        });
        return reply.send({ received: true });
      }

      const limitRequest = await prisma.limitIncreaseRequest.findFirst({
        where: { vendorReference: body.session_id },
      });
      if (limitRequest) {
        await applyLimitIncreaseDecision(body.session_id, decision);
        await recordAuditEvent({
          actorLabel: "webhook:didit",
          action: "limit_increase.decision_received",
          targetType: "LimitIncreaseRequest",
          targetId: body.session_id,
          metadata: { status: body.status, decision },
        });
        return reply.send({ received: true });
      }

      logger.warn({ sessionId: body.session_id }, "kyc.webhook_unknown_session");
      return reply.send({ received: true, ignored: true });
    }

    if (typeof legacySignature === "string") {
      // Local mock-provider testing path (approve-kyc.js).
      if (!kycProvider.verifyWebhookSignature(req.body, legacySignature, "")) {
        return reply.unauthorized("Invalid webhook signature");
      }

      const body = mockWebhookSchema.parse(req.body);
      await applyKycDecision(body.vendorReference, body.decision, body.riskFlags);

      await recordAuditEvent({
        actorLabel: "webhook:kyc_provider",
        action: "kyc.decision_received",
        targetType: "KycCase",
        targetId: body.vendorReference,
        metadata: { decision: body.decision, riskFlags: body.riskFlags },
      });

      return reply.send({ received: true });
    }

    return reply.unauthorized("Missing webhook signature");
  });

  // Lets the frontend show/refresh the "verify your identity" link without
  // starting a brand new (billable) Didit session every time.
  app.get("/kyc/status", { preHandler: [requireAuth] }, async (req, reply) => {
    const kycCase = await getLatestKycCase(req.user.sub);
    return reply.send({
      status: kycCase?.decision ?? "NOT_STARTED",
      verificationUrl: kycCase?.verificationUrl ?? null,
    });
  });

  const limitIncreaseSchema = z.object({
    documentType: z.enum(["PAY_SLIP", "BANK_STATEMENT", "TAX_RETURN", "INVESTMENT_PENSION"]),
  });

  app.post("/limits/increase-requests", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = limitIncreaseSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    const request = await startLimitIncreaseRequest(user.id, user.email, body.documentType);
    return reply.code(201).send({
      status: request.status,
      verificationUrl: request.verificationUrl,
    });
  });

  app.get("/limits/increase-requests/latest", { preHandler: [requireAuth] }, async (req, reply) => {
    const request = await getLatestLimitIncreaseRequest(req.user.sub);
    return reply.send({
      status: request?.status ?? null,
      documentType: request?.documentType ?? null,
      verificationUrl: request?.verificationUrl ?? null,
    });
  });
}