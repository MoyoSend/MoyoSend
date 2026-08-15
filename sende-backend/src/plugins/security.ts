import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import jwt from "@fastify/jwt";
import { env } from "../config/env";

/**
 * Baseline security posture, applied globally. Route-specific extras
 * (stricter rate limits on auth endpoints, idempotency requirements on
 * money-moving endpoints) are layered on top in their own route files.
 */
export default fp(async function securityPlugin(app: FastifyInstance) {
  await app.register(helmet, {
    contentSecurityPolicy: true,
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  await app.register(cors, {
    origin: env.NODE_ENV === "production" ? env.FRONTEND_URL : true,
    credentials: true,
  });

  await app.register(sensible);

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TOKEN_TTL },
  });

  // Global baseline rate limit; auth and transaction routes apply tighter
  // per-route limits via `config: { rateLimit: {...} }`.
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    allowList: [],
  });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
  });
});
