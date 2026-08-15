import Fastify from "fastify";
import { logger } from "./utils/logger";
import securityPlugin from "./plugins/security";
import authRoutes from "./modules/auth/auth.routes";
import recipientsRoutes from "./modules/recipients/recipients.routes";
import transactionsRoutes from "./modules/transactions/transactions.routes";
import kycRoutes from "./modules/kyc/kyc.routes";
import payoutRoutes from "./modules/payout/payout.routes";
import adminRoutes from "./modules/admin/admin.routes";
import corridorsRoutes from "./modules/corridors/corridors.routes";
import referralsRoutes from "./modules/referrals/referrals.routes";
import billsRoutes from "./modules/bills/bills.routes";
import paymentsRoutes from "./modules/payments/payments.routes";
import walletRoutes from "./modules/wallet/wallet.routes";

// JSON.stringify can't serialize BigInt by default. We use BigInt for money
// amounts to avoid floating-point precision bugs, so teach it here — this
// makes every API response automatically convert BigInt to a string.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function buildApp() {
  const app = Fastify({
    logger,
    trustProxy: true, // required to get real client IPs behind a load balancer, used for rate limiting + fraud signals
    bodyLimit: 1_048_576, // 1MB — remittance payloads are small; reject oversized bodies outright
  });

  await app.register(securityPlugin);

  await app.register(authRoutes, { prefix: "/api/v1" });
  await app.register(recipientsRoutes, { prefix: "/api/v1" });
  await app.register(transactionsRoutes, { prefix: "/api/v1" });
  await app.register(kycRoutes, { prefix: "/api/v1" });
  await app.register(payoutRoutes, { prefix: "/api/v1" });
  await app.register(adminRoutes, { prefix: "/api/v1" });
  await app.register(corridorsRoutes, { prefix: "/api/v1" });
  await app.register(referralsRoutes, { prefix: "/api/v1" });
  await app.register(billsRoutes, { prefix: "/api/v1" });
  await app.register(paymentsRoutes, { prefix: "/api/v1" });
  await app.register(walletRoutes, { prefix: "/api/v1" });
  app.get("/healthz", async () => ({ status: "ok" }));

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, "unhandled_error");
    // Never leak stack traces or internal error detail to the client in
    // production — this is a fintech app handling PII and money.
    const statusCode = err.statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "internal_server_error" : err.message,
    });
  });

  return app;
}
