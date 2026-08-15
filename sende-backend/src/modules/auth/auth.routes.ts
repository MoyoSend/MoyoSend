import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  signUp,
  login,
  verifyMfaCode,
  InvalidCredentialsError,
  enrollMfa,
  confirmMfaEnrollment,
  recordDeviceLogin,
  requestPasswordReset,
  resetPassword,
  InvalidResetTokenError,
  signUpWithPhone,
  verifyPhoneSignUp,
  InvalidOtpError,
} from "./auth.service";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../db/client";
import { recordAuditEvent } from "../../utils/audit";

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, "Password must be at least 12 characters"),
  homeCountry: z.string().length(2, "homeCountry must be an ISO 3166-1 alpha-2 code"),
  fingerprint: z.string().optional(),
  referralOrPromoCode: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().optional(),
  fingerprint: z.string().optional(),
});

const signUpPhoneStartSchema = z.object({
  phone: z.string().min(8, "Enter a valid phone number").max(20),
  password: z.string().min(12, "Password must be at least 12 characters"),
  homeCountry: z.string().length(2, "homeCountry must be an ISO 3166-1 alpha-2 code"),
  referralOrPromoCode: z.string().optional(),
});
const signUpPhoneVerifySchema = z.object({
  userId: z.string().uuid(),
  code: z.string().length(6, "Enter the 6-digit code"),
  fingerprint: z.string().optional(),
});
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12, "Password must be at least 12 characters"),
});

export default async function authRoutes(app: FastifyInstance) {
  // Tighter rate limit than the global default — auth endpoints are the
  // highest-value target for credential stuffing / brute force.
  const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/auth/signup", authRateLimit, async (req, reply) => {
    const body = signUpSchema.parse(req.body);
    const user = await signUp(body.email, body.password, body.homeCountry, body.referralOrPromoCode);
    
    if (body.fingerprint) {
      await recordDeviceLogin(user.id, body.fingerprint, req.headers["user-agent"], req.ip);
    }

    const token = app.jwt.sign({ sub: user.id, role: user.role });
    return reply.code(201).send({
      user: {
        id: user.id,
        email: user.email,
        kycStatus: user.kycStatus,
        kycVerificationUrl: user.kycVerificationUrl,
        mfaEnabled: false,
      },
      accessToken: token,
    });
  });

  app.post("/auth/signup/phone/start", authRateLimit, async (req, reply) => {
    const body = signUpPhoneStartSchema.parse(req.body);
    const { userId, devOtpCode } = await signUpWithPhone(
      body.phone,
      body.password,
      body.homeCountry,
      body.referralOrPromoCode
    );
    return reply.code(201).send({ userId, devOtpCode });
  });
  app.post("/auth/signup/phone/verify", authRateLimit, async (req, reply) => {
    const body = signUpPhoneVerifySchema.parse(req.body);
    try {
      const user = await verifyPhoneSignUp(body.userId, body.code);
      if (body.fingerprint) {
        await recordDeviceLogin(user.id, body.fingerprint, req.headers["user-agent"], req.ip);
      }
      const token = app.jwt.sign({ sub: user.id, role: user.role });
      return reply.code(201).send({
        user: { id: user.id, email: user.email, phone: user.phone, kycStatus: user.kycStatus, mfaEnabled: false },
        accessToken: token,
      });
    } catch (err) {
      if (err instanceof InvalidOtpError) {
        return reply.badRequest(err.message);
      }
      throw err;
    }
  });
  app.post("/auth/login", authRateLimit, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    try {
      const { user, mfaRequired } = await login(body.email, body.password);

      if (mfaRequired) {
        if (!body.mfaCode) {
          return reply.code(401).send({ error: "mfa_required" });
        }
        const validCode = await verifyMfaCode(user.id, body.mfaCode);
        if (!validCode) return reply.unauthorized("Invalid MFA code");
      }

      let newDevice = false;
      if (body.fingerprint) {
        const deviceResult = await recordDeviceLogin(user.id, body.fingerprint, req.headers["user-agent"], req.ip);
        newDevice = deviceResult.isNewDevice;
        if (newDevice) {
          await recordAuditEvent({
            actorId: user.id,
            actorLabel: `user:${user.id}`,
            action: "auth.new_device_login",
            targetType: "User",
            targetId: user.id,
            metadata: { userAgent: req.headers["user-agent"], ip: req.ip },
          });
        }
      }

      const token = app.jwt.sign({ sub: user.id, role: user.role as never });
      return reply.send({ user: { ...user, mfaEnabled: mfaRequired }, accessToken: token, newDevice });
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        return reply.unauthorized(err.message);
      }
      throw err;
    }
  });

  app.post("/auth/mfa/enroll", { preHandler: [requireAuth] }, async (req, reply) => {
    const { sub } = req.user;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: sub } });
    const { otpauthUrl } = await enrollMfa(sub, user.email);
    return reply.send({ otpauthUrl });
  });

  app.post("/auth/mfa/confirm", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = z.object({ code: z.string() }).parse(req.body);
    const ok = await confirmMfaEnrollment(req.user.sub, body.code);
    if (!ok) return reply.badRequest("Invalid MFA code");
    return reply.send({ mfaEnabled: true });
  });

  app.post("/auth/forgot-password", authRateLimit, async (req, reply) => {
    const body = forgotPasswordSchema.parse(req.body);
    await requestPasswordReset(body.email);
    // Always the same response, whether or not the email exists — never
    // reveal which emails are registered.
    return reply.send({ message: "If that email is registered, a reset link has been sent." });
  });

  app.post("/auth/reset-password", authRateLimit, async (req, reply) => {
    const body = resetPasswordSchema.parse(req.body);
    try {
      await resetPassword(body.token, body.newPassword);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof InvalidResetTokenError) {
        return reply.badRequest(err.message);
      }
      throw err;
    }
  });
}
