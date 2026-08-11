import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { confirmPayout, refundTransaction } from "../transactions/transactions.service";
import { confirmBillPayment, refundBillPayment } from "../bills/bill.service";
import { verifyHmacSignature, timingSafeEqual } from "../../utils/crypto";
import { recordAuditEvent } from "../../utils/audit";
import { env } from "../../config/env";
import { prisma } from "../../db/client";
import { logger } from "../../utils/logger";

const legacyMockWebhookSchema = z.object({
  transactionId: z.string().uuid(),
  status: z.enum(["DELIVERED", "FAILED"]),
  providerReference: z.string(),
});

// Flutterwave sends every account event (charges, transfers, bill
// payments, subscriptions, ...) to this one webhook URL. Different event
// types have entirely different `data`/`transfer` shapes, so we parse a
// loose envelope first and only apply a strict shape once we know which
// event type we're looking at.
const flutterwaveEnvelopeSchema = z.object({ "event.type": z.string() }).passthrough();

const transferWebhookSchema = z.object({
  transfer: z.object({ reference: z.string(), status: z.string() }).passthrough(),
});

const billPaymentWebhookSchema = z.object({
  data: z
    .object({
      customer_reference: z.string().nullable().optional(),
      tx_ref: z.string().nullable().optional(),
      status: z.string(),
    })
    .passthrough(),
});

// Only act on statuses we've actually seen documented — anything else
// (including genuinely pending states we haven't catalogued) is
// acknowledged without action, same "don't guess" convention as
// DIDIT_STATUS_MAP in kyc.routes.ts.
const BILL_PAYMENT_SUCCESS_STATUSES = new Set(["success", "successful"]);
const BILL_PAYMENT_FAILURE_STATUSES = new Set(["failed", "failure"]);

export default async function payoutRoutes(app: FastifyInstance) {
  app.post("/webhooks/payout", async (req, reply) => {
    const flwSignature = req.headers["verif-hash"];
    const legacySignature = req.headers["x-webhook-signature"];

    if (typeof flwSignature === "string") {
      if (!env.FLW_WEBHOOK_SECRET_HASH || !timingSafeEqual(flwSignature, env.FLW_WEBHOOK_SECRET_HASH)) {
        return reply.unauthorized("Invalid webhook signature");
      }

      const envelope = flutterwaveEnvelopeSchema.parse(req.body);
      const eventType = envelope["event.type"];

      if (eventType === "Transfer") {
        const body = transferWebhookSchema.parse(req.body);
        // We set the transfer's `reference` to our transaction's UUID when
        // creating it (with a test-mode-only suffix appended in sandbox) —
        // strip that suffix back off to recover the transaction id.
        const transactionId = body.transfer.reference.split("_PMCK")[0];

        if (body.transfer.status === "SUCCESSFUL") {
          await confirmPayout(transactionId);
        } else if (body.transfer.status === "FAILED") {
          await refundTransaction(transactionId, "payout_provider_reported_failure");
        }

        await recordAuditEvent({
          actorLabel: "webhook:flutterwave",
          action: "payout.status_received",
          targetType: "Transaction",
          targetId: transactionId,
          metadata: { status: body.transfer.status, eventType },
        });

        return reply.send({ received: true });
      }

      if (eventType === "SingleBillPayment") {
        const body = billPaymentWebhookSchema.parse(req.body);
        const { customer_reference, tx_ref } = body.data;
        const status = body.data.status.toLowerCase();

        // customer_reference is what we expect (it's our own UUID echoed
        // back), but this integration has already observed it come back
        // null on a real failure event — tx_ref is Flutterwave's own id
        // for the attempt and is the fallback join key for exactly that case.
        let billPayment = customer_reference
          ? await prisma.billPayment.findFirst({ where: { providerReference: customer_reference } })
          : null;
        if (!billPayment && tx_ref) {
          billPayment = await prisma.billPayment.findFirst({ where: { providerTxRef: tx_ref } });
        }

        if (!billPayment) {
          logger.warn({ status, rawPayload: req.body }, "payout.flutterwave.bill_webhook_missing_reference");
          return reply.send({ received: true, ignored: true });
        }

        if (BILL_PAYMENT_SUCCESS_STATUSES.has(status)) {
          await confirmBillPayment(billPayment.id);
        } else if (BILL_PAYMENT_FAILURE_STATUSES.has(status)) {
          await refundBillPayment(billPayment.id, "payout_provider_reported_failure");
        } else {
          return reply.send({ received: true, ignored: true, status });
        }

        await recordAuditEvent({
          actorLabel: "webhook:flutterwave",
          action: "bill_payment.status_received",
          targetType: "BillPayment",
          targetId: billPayment.id,
          metadata: { status, eventType },
        });

        return reply.send({ received: true });
      }

      return reply.send({ received: true, ignored: true });
    }

    if (typeof legacySignature === "string") {
      // Local mock-provider testing path (confirm-payout.js).
      const secret = env.PAYOUT_AFRICA_API_KEY ?? "mock-secret";
      const rawBody = JSON.stringify(req.body);
      if (!verifyHmacSignature(rawBody, legacySignature, secret)) {
        return reply.unauthorized("Invalid webhook signature");
      }

      const body = legacyMockWebhookSchema.parse(req.body);

      if (body.status === "DELIVERED") {
        await confirmPayout(body.transactionId);
      } else if (body.status === "FAILED") {
        await refundTransaction(body.transactionId, "payout_provider_reported_failure");
      }

      await recordAuditEvent({
        actorLabel: "webhook:payout_provider",
        action: "payout.status_received",
        targetType: "Transaction",
        targetId: body.transactionId,
        metadata: { status: body.status, providerReference: body.providerReference },
      });

      return reply.send({ received: true });
    }

    return reply.unauthorized("Missing webhook signature");
  });
}
