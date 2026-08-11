import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client";
import { requireAuth, requireStepUp } from "../../middleware/auth";
import { encryptField } from "../../utils/crypto";
import { listBanksForCountry, resolveBankAccount, listMobileNetworksForCountry } from "../payout/payout.service";

const createRecipientSchema = z.object({
  fullName: z.string().min(2),
  country: z.string().length(2),
  payoutMethod: z.enum(["BANK_TRANSFER", "MOBILE_MONEY"]),
  bankCode: z.string().optional(),
  accountNumber: z.string().optional(),
  mobileNetwork: z.string().optional(),
  mobileNumber: z.string().optional(),
});

// Countries where we can automatically verify the account holder's name
// before saving a recipient. Only expand this after confirming the
// provider actually supports name-enquiry there — pretending to verify an
// account we can't really check is worse than not verifying at all.
const ACCOUNT_VERIFICATION_SUPPORTED_COUNTRIES = new Set(["NG"]);

export default async function recipientsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Bank list for the "Bank" dropdown when adding a recipient.
  app.get("/recipients/banks/:country", async (req, reply) => {
    const { country } = req.params as { country: string };
    const banks = await listBanksForCountry(country.toUpperCase());
    return reply.send({ banks });
  });

  // Mobile money network list (MTN, Vodafone, etc.) for the mobile money
  // dropdown. Returns an empty list for countries Flutterwave doesn't
  // support mobile money payouts to yet.
  app.get("/recipients/mobile-networks/:country", async (req, reply) => {
    const { country } = req.params as { country: string };
    const networks = listMobileNetworksForCountry(country.toUpperCase());
    return reply.send({ networks });
  });

  // Lets the frontend show "this account belongs to X" before the user
  // commits to saving the recipient.
  app.post("/recipients/resolve-account", async (req, reply) => {
    const body = z
      .object({ country: z.string().length(2), bankCode: z.string().min(1), accountNumber: z.string().min(1) })
      .parse(req.body);

    if (!ACCOUNT_VERIFICATION_SUPPORTED_COUNTRIES.has(body.country.toUpperCase())) {
      return reply.badRequest("Account verification isn't available for this country yet");
    }

    const result = await resolveBankAccount(body.bankCode, body.accountNumber);
    if (!result) {
      return reply.badRequest("Couldn't verify this account — please check the bank and account number");
    }

    return reply.send(result);
  });

  app.post("/recipients", { preHandler: [requireStepUp] }, async (req, reply) => {
    const body = createRecipientSchema.parse(req.body);

    let verified = false;
    let verifiedAccountName: string | undefined;

    if (
      body.payoutMethod === "BANK_TRANSFER" &&
      body.bankCode &&
      body.accountNumber &&
      ACCOUNT_VERIFICATION_SUPPORTED_COUNTRIES.has(body.country.toUpperCase())
    ) {
      // Never trust the frontend's "I already verified this" — re-check
      // server-side, since this is the check standing between a user and
      // sending money to the wrong account.
      const result = await resolveBankAccount(body.bankCode, body.accountNumber);
      if (!result) {
        return reply.badRequest("Couldn't verify this bank account — please check the details and try again");
      }
      verified = true;
      verifiedAccountName = result.accountName;
    }

    if (body.payoutMethod === "BANK_TRANSFER" && (!body.bankCode || !body.accountNumber)) {
      return reply.badRequest("Please select a bank and enter an account number");
    }

    if (body.payoutMethod === "MOBILE_MONEY") {
      // There's no account-name lookup for mobile money the way there is
      // for bank accounts, so we can't auto-verify — but we CAN reject an
      // invalid/unsupported network server-side rather than trusting
      // whatever the frontend sent.
      const validNetworks = listMobileNetworksForCountry(body.country).map((n) => n.code);
      if (!body.mobileNetwork || !validNetworks.includes(body.mobileNetwork)) {
        return reply.badRequest("Please select a valid mobile money network for this country");
      }
      if (!body.mobileNumber) {
        return reply.badRequest("Mobile money number is required");
      }
    }

    const recipient = await prisma.recipient.create({
      data: {
        userId: req.user.sub,
        fullName: body.fullName,
        country: body.country,
        payoutMethod: body.payoutMethod,
        bankCode: body.bankCode,
        accountNumber: body.accountNumber ? encryptField(body.accountNumber) : undefined,
        mobileNetwork: body.mobileNetwork,
        mobileNumber: body.mobileNumber ? encryptField(body.mobileNumber) : undefined,
        verified,
        verifiedAccountName,
      },
    });
    return reply.code(201).send({ id: recipient.id, verified, verifiedAccountName });
  });

  app.get("/recipients", async (req, reply) => {
    const recipients = await prisma.recipient.findMany({
      where: { userId: req.user.sub, archived: false },
      select: {
        id: true,
        fullName: true,
        country: true,
        payoutMethod: true,
        verified: true,
        verifiedAccountName: true,
        bankCode: true,
        mobileNetwork: true,
      },
    });
    return reply.send({ recipients });
  });

  const updateRecipientSchema = z.object({
    fullName: z.string().min(2).optional(),
    bankCode: z.string().optional(),
    accountNumber: z.string().optional(),
    mobileNetwork: z.string().optional(),
    mobileNumber: z.string().optional(),
  });

  // Editing keeps the recipient's original payout method fixed — switching
  // a recipient from bank transfer to mobile money (or back) is really a
  // different recipient, not an edit of this one.
  app.patch("/recipients/:id", { preHandler: [requireStepUp] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.recipient.findFirst({ where: { id, userId: req.user.sub, archived: false } });
    if (!existing) return reply.notFound();

    const body = updateRecipientSchema.parse(req.body);
    let verified = existing.verified;
    let verifiedAccountName: string | undefined = existing.verifiedAccountName ?? undefined;

    if (existing.payoutMethod === "BANK_TRANSFER") {
      const bankCode = body.bankCode ?? existing.bankCode ?? undefined;
      if (!bankCode) return reply.badRequest("Please select a bank");

      const detailsChanged = Boolean(body.bankCode || body.accountNumber);
      if (
        detailsChanged &&
        body.accountNumber &&
        ACCOUNT_VERIFICATION_SUPPORTED_COUNTRIES.has(existing.country.toUpperCase())
      ) {
        const result = await resolveBankAccount(bankCode, body.accountNumber);
        if (!result) {
          return reply.badRequest("Couldn't verify this bank account — please check the details and try again");
        }
        verified = true;
        verifiedAccountName = result.accountName;
      } else if (detailsChanged) {
        verified = false;
        verifiedAccountName = undefined;
      }

      await prisma.recipient.update({
        where: { id },
        data: {
          fullName: body.fullName ?? existing.fullName,
          bankCode,
          accountNumber: body.accountNumber ? encryptField(body.accountNumber) : existing.accountNumber,
          verified,
          verifiedAccountName,
        },
      });
    } else {
      const validNetworks = listMobileNetworksForCountry(existing.country).map((n) => n.code);
      const mobileNetwork = body.mobileNetwork ?? existing.mobileNetwork ?? undefined;
      if (!mobileNetwork || !validNetworks.includes(mobileNetwork)) {
        return reply.badRequest("Please select a valid mobile money network for this country");
      }

      await prisma.recipient.update({
        where: { id },
        data: {
          fullName: body.fullName ?? existing.fullName,
          mobileNetwork,
          mobileNumber: body.mobileNumber ? encryptField(body.mobileNumber) : existing.mobileNumber,
        },
      });
    }

    const updated = await prisma.recipient.findUniqueOrThrow({ where: { id } });
    return reply.send({ id: updated.id, verified: updated.verified, verifiedAccountName: updated.verifiedAccountName });
  });

  // Soft-delete only — a real DELETE would violate the foreign key from any
  // past transactions pointing at this recipient (see schema.prisma).
  app.delete("/recipients/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.recipient.findFirst({ where: { id, userId: req.user.sub, archived: false } });
    if (!existing) return reply.notFound();

    await prisma.recipient.update({ where: { id }, data: { archived: true } });
    return reply.send({ archived: true });
  });
}
