import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyMfaCode } from "../modules/auth/auth.service";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: UserRole };
    user: { sub: string; role: UserRole };
  }
}

/** Verify the JWT and attach the decoded payload to req.user. Use as a preHandler. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.unauthorized("Missing or invalid access token");
  }
}

/** RBAC guard — use after requireAuth. Staff-only endpoints (admin console, compliance review) must use this. */
export function requireRole(...allowed: UserRole[]) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const role = req.user?.role;
    if (!role || !allowed.includes(role)) {
      return reply.forbidden("You do not have permission to perform this action");
    }
  };
}

/**
 * Step-up MFA guard (roadmap section 7.1: step-up auth for adding a new
 * recipient or sending above a risk threshold). Use after requireAuth.
 *
 * LIMITATION: MFA is opt-in (User.mfaEnabled). A user who never enrolled
 * has no second factor to check, so this guard passes them through with no
 * extra protection. Worth revisiting if/when MFA enrollment becomes
 * mandatory at signup.
 */
export async function requireStepUp(req: FastifyRequest, reply: FastifyReply) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
  if (!user.mfaEnabled) return;

  const body = req.body as { mfaCode?: string } | undefined;
  if (!body?.mfaCode) {
    return reply.code(401).send({ error: "step_up_required" });
  }
  const valid = await verifyMfaCode(user.id, body.mfaCode);
  if (!valid) return reply.unauthorized("Invalid verification code");
}

// Roughly $1000-equivalent per currency, in minor units. Approximate on
// purpose — this is a risk control, not a precise FX conversion.
const STEP_UP_THRESHOLD_MINOR: Record<string, bigint> = {
  GBP: 100_000n,
  EUR: 100_000n,
  USD: 100_000n,
  MYR: 470_000n,
};
const DEFAULT_STEP_UP_THRESHOLD_MINOR = 100_000n;

/**
 * Same as requireStepUp, but only kicks in when the transfer looks risky —
 * either the amount is at or above a per-currency threshold, or the request
 * is coming from a device we haven't seen this user log in from before
 * (roadmap 7.4: "new device + high amount = step-up review"). A trusted
 * device sending a small amount skips the extra prompt; anything else gets
 * challenged.
 */
export async function requireStepUpForRisk(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as
    | {
        corridorId?: string;
        sendAmountMinor?: string | number;
        mfaCode?: string;
        fingerprint?: string;
      }
    | undefined;
  if (!body?.corridorId || body.sendAmountMinor === undefined) return;

  const corridor = await prisma.corridor.findUnique({ where: { id: body.corridorId } });
  if (!corridor) return;

  const threshold = STEP_UP_THRESHOLD_MINOR[corridor.sendCurrency] ?? DEFAULT_STEP_UP_THRESHOLD_MINOR;
  const isLargeAmount = BigInt(body.sendAmountMinor) >= threshold;

  let isUnrecognizedDevice = false;
  if (body.fingerprint) {
    const knownDevice = await prisma.device.findUnique({
      where: { userId_fingerprint: { userId: req.user.sub, fingerprint: body.fingerprint } },
    });
    isUnrecognizedDevice = !knownDevice;
  }

  if (!isLargeAmount && !isUnrecognizedDevice) return;

  return requireStepUp(req, reply);
}
