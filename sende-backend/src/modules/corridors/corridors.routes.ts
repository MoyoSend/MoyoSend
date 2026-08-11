import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client";

/** Public read-only listing of enabled corridors — powers the send-money currency/country pickers on web and mobile. */
export default async function corridorsRoutes(app: FastifyInstance) {
  app.get("/corridors", async (_req, reply) => {
    const corridors = await prisma.corridor.findMany({
      where: { enabled: true },
      select: {
        id: true,
        sendCurrency: true,
        receiveCountry: true,
        receiveCurrency: true,
        payoutMethods: true,
        minSendMinor: true,
        maxSendMinor: true,
        feeFlatMinor: true,
        feeBps: true,
      },
    });
    return reply.send({ corridors });
  });
}
