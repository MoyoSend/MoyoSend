import { prisma } from "../db/client";
import type { Prisma } from "@prisma/client";

/**
 * Every action a staff member (or the system) takes against money or KYC
 * data gets an immutable audit row. This is what regulators and internal
 * investigations rely on — write to it from the route/service layer, never
 * skip it for "small" admin actions.
 */
export async function recordAuditEvent(params: {
  actorId?: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditEvent.create({
    data: {
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
