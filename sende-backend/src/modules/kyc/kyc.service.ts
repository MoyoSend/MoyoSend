import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { prisma } from "../../db/client";
import { verifyHmacSignature } from "../../utils/crypto";
import { INCREASED_DAILY_LIMIT_MINOR } from "../transactions/transactions.service";

/**
 * KYC/AML vendor interface. The rest of the app only ever talks to this
 * interface — swap DiditKycProvider for another vendor without touching
 * anything outside this file.
 */
export interface KycProvider {
  startVerification(
    userId: string,
    email: string,
    workflowId?: string
  ): Promise<{ vendorReference: string; hostedUrl?: string }>;
  /**
   * `body` is the already-JSON-parsed webhook payload, not raw bytes.
   * Didit's recommended X-Signature-V2 scheme re-encodes the parsed JSON
   * with sorted keys before hashing, so we work from the parsed object.
   */
  verifyWebhookSignature(body: unknown, signature: string, timestamp: string): boolean;
}

class MockKycProvider implements KycProvider {
  async startVerification(userId: string, _email: string, workflowId?: string) {
    logger.info({ userId, workflowId }, "kyc.mock_provider.start_verification");
    return { vendorReference: `mock-ref-${workflowId ?? "kyc"}-${userId}-${Date.now()}`, hostedUrl: undefined };
  }

  verifyWebhookSignature(body: unknown, signature: string): boolean {
    const secret = env.KYC_WEBHOOK_SIGNING_SECRET ?? "mock-secret";
    return verifyHmacSignature(JSON.stringify(body), signature, secret);
  }
}

/**
 * Real integration with Didit (didit.me) for sender KYC: hosted identity
 * verification + liveness + face match + AML/sanctions screening.
 * Docs: https://docs.didit.me
 */
class DiditKycProvider implements KycProvider {
  private readonly baseUrl = "https://verification.didit.me";

  async startVerification(userId: string, email: string, workflowId: string | undefined = env.KYC_WORKFLOW_ID) {
    if (!env.KYC_API_KEY || !workflowId) {
      throw new Error("KYC_API_KEY and a workflow ID must be set to use the Didit KYC provider");
    }

    const res = await fetch(`${this.baseUrl}/v3/session/`, {
      method: "POST",
      headers: { "x-api-key": env.KYC_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: userId, // lets Didit's webhooks map back to our user
        metadata: { email },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ userId, status: res.status, body: text }, "kyc.didit.start_verification_failed");
      throw new Error(`Didit session creation failed (${res.status})`);
    }

    const data = (await res.json()) as { session_id: string; url: string };
    // TEMPORARY: logging the hosted URL so we can test manually before the
    // frontend has a "verify identity" button wired up. Remove this once
    // that UI exists — verification URLs carry a session token and
    // shouldn't sit in server logs long-term.
    logger.info({ userId, sessionId: data.session_id, hostedUrl: data.url }, "kyc.didit.start_verification");
    return { vendorReference: data.session_id, hostedUrl: data.url };
  }

  verifyWebhookSignature(body: unknown, signature: string, timestamp: string): boolean {
    if (!env.KYC_WEBHOOK_SIGNING_SECRET) {
      logger.error("kyc.didit.missing_webhook_secret");
      return false;
    }

    // Reject stale/replayed webhooks outright.
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp, 10);
    if (!ts || Math.abs(now - ts) > 300) return false;

    // Didit's X-Signature-V2 is HMAC-SHA256 over a canonical JSON form:
    // keys sorted recursively, compact separators, Unicode left unescaped.
    // This must be reproduced exactly or every signature check fails.
    const canonical = JSON.stringify(sortKeysDeep(body));
    return verifyHmacSignature(canonical, signature, env.KYC_WEBHOOK_SIGNING_SECRET);
  }
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function selectKycProvider(): KycProvider {
  switch (env.KYC_PROVIDER) {
    case "didit":
      return new DiditKycProvider();
    case "mock":
    default:
      return new MockKycProvider();
  }
}

export const kycProvider = selectKycProvider();

/** Kick off a KYC case for a user. Called right after signup, before the user can send money. */
export async function startKycCase(userId: string, email: string) {
  const existing = await prisma.kycCase.findFirst({
    where: { userId, decision: { in: ["PENDING", "MANUAL_REVIEW"] } },
  });
  if (existing) return existing;

  const { vendorReference, hostedUrl } = await kycProvider.startVerification(userId, email);

  const kycCase = await prisma.kycCase.create({
    data: {
      userId,
      vendor: env.KYC_PROVIDER,
      vendorReference,
      verificationUrl: hostedUrl,
      decision: "PENDING",
      riskFlags: [],
      documentPointers: [],
    },
  });

  await prisma.user.update({ where: { id: userId }, data: { kycStatus: "PENDING" } });

  return kycCase;
}

/** Look up the current KYC case for a user without starting a new (billable) verification session. */
export async function getLatestKycCase(userId: string) {
  return prisma.kycCase.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
}

/**
 * Apply a decision that arrived via webhook from the KYC vendor. Always
 * verify the webhook signature (see kyc.routes.ts) before calling this —
 * an unauthenticated KYC decision endpoint is a critical account-takeover
 * and fraud vector.
 */
export async function applyKycDecision(
  vendorReference: string,
  decision: "APPROVED" | "REJECTED" | "MANUAL_REVIEW",
  riskFlags: string[] = []
) {
  const kycCase = await prisma.kycCase.findFirst({ where: { vendorReference } });
  if (!kycCase) throw new Error(`No KYC case found for vendor reference ${vendorReference}`);

  await prisma.$transaction([
    prisma.kycCase.update({
      where: { id: kycCase.id },
      data: { decision, riskFlags, decidedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: kycCase.userId },
      data: { kycStatus: decision, riskTier: riskFlags.length > 0 ? "HIGH" : "LOW" },
    }),
  ]);

  logger.info({ userId: kycCase.userId, decision }, "kyc.decision_applied");
}

/**
 * Request a limit increase by having the user submit a proof-of-funds
 * document through the same vendor-hosted flow used for identity KYC —
 * just against a different workflow, so raw documents still never touch
 * our own storage. See LimitIncreaseRequest in schema.prisma.
 */
export async function startLimitIncreaseRequest(userId: string, email: string, documentType: string) {
  const existing = await prisma.limitIncreaseRequest.findFirst({
    where: { userId, status: { in: ["PENDING", "MANUAL_REVIEW"] } },
  });
  if (existing) return existing;

  const { vendorReference, hostedUrl } = await kycProvider.startVerification(
    userId,
    email,
    env.LIMIT_INCREASE_WORKFLOW_ID
  );

  return prisma.limitIncreaseRequest.create({
    data: {
      userId,
      documentType,
      vendor: env.KYC_PROVIDER,
      vendorReference,
      verificationUrl: hostedUrl,
      status: "PENDING",
    },
  });
}

export async function getLatestLimitIncreaseRequest(userId: string) {
  return prisma.limitIncreaseRequest.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
}

/**
 * Apply a limit-increase decision from the vendor webhook. On approval this
 * is a fixed automatic bump (INCREASED_DAILY_LIMIT_MINOR) rather than an
 * admin picking a custom number — Didit verifies the document is genuine,
 * it doesn't judge what limit that should translate to.
 */
export async function applyLimitIncreaseDecision(
  vendorReference: string,
  decision: "APPROVED" | "REJECTED" | "MANUAL_REVIEW"
) {
  const request = await prisma.limitIncreaseRequest.findFirst({ where: { vendorReference } });
  if (!request) throw new Error(`No limit increase request found for vendor reference ${vendorReference}`);

  await prisma.limitIncreaseRequest.update({
    where: { id: request.id },
    data: { status: decision, decidedAt: new Date() },
  });

  if (decision === "APPROVED") {
    await prisma.user.update({
      where: { id: request.userId },
      data: { dailyLimitOverrideMinor: INCREASED_DAILY_LIMIT_MINOR },
    });
  }

  logger.info({ userId: request.userId, decision }, "limit_increase.decision_applied");
}