import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client";
import { requireAuth } from "../../middleware/auth";

export default async function referralsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/referrals/me", async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });

    const [referralCount, rewards] = await Promise.all([
      prisma.user.count({ where: { referredByUserId: user.id } }),
      prisma.referralReward.findMany({ where: { referrerId: user.id } }),
    ]);

    const totalEarnedByCurrency = rewards.reduce<Record<string, bigint>>((totals, r) => {
      totals[r.referrerCurrency] = (totals[r.referrerCurrency] ?? 0n) + r.referrerAmountMinor;
      return totals;
    }, {});

    return reply.send({
      referralCode: user.referralCode,
      referralCount,
      totalEarnedByCurrency,
    });
  });
}