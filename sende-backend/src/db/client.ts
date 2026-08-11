import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

// Single shared Prisma client. In serverless environments, follow Prisma's
// connection-pooling guidance (e.g. pgBouncer) instead of instantiating
// per-request clients.
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
