import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Every endpoint that moves money must require an Idempotency-Key header.
 * The actual dedupe happens at the DB layer (unique constraint on
 * Transaction.idempotencyKey — see transactions.service.ts): this
 * middleware just rejects requests that don't supply one at all, so a
 * client bug can never silently create an unkeyed, unsafe-to-retry request.
 */
export async function requireIdempotencyKey(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string" || key.length < 8) {
    return reply.badRequest("An Idempotency-Key header (>= 8 chars) is required for this endpoint");
  }
}

export function getIdempotencyKey(req: FastifyRequest): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string") throw new Error("Idempotency-Key missing — requireIdempotencyKey should run first");
  return key;
}
