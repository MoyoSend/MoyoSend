import { authenticator } from "otplib";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../../db/client";
import { hashPassword, verifyPassword, encryptField, decryptField } from "../../utils/crypto";
import { startKycCase } from "../kyc/kyc.service";
import { logger } from "../../utils/logger";
import { generateReferralCode } from "../../utils/referral";
import { env } from "../../config/env";
import { sendPasswordResetEmail, sendPasswordChangedEmail } from "../email/email.service";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class MfaRequiredError extends Error {
  constructor() {
    super("MFA code required");
    this.name = "MfaRequiredError";
  }
}

/** Generate a referral code, retrying on the rare collision. */
async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const existing = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique referral code after 5 attempts");
}

export async function signUp(
  email: string,
  password: string,
  homeCountry: string,
  referralOrPromoCode?: string
) {
  const passwordHash = await hashPassword(password);

  // Resolve an optional referral/promo code before creating the user. A
  // bad, expired, or exhausted code is silently ignored rather than
  // rejected — it should never be the reason signup fails.
  let referredByUserId: string | undefined;
  let redeemedPromoCodeId: string | undefined;
  if (referralOrPromoCode) {
    const normalizedCode = referralOrPromoCode.trim().toUpperCase();
    const referrer = await prisma.user.findUnique({ where: { referralCode: normalizedCode } });
    if (referrer) {
      referredByUserId = referrer.id;
    } else {
      const promoCode = await prisma.promoCode.findUnique({ where: { code: normalizedCode } });
      const isUsable =
        promoCode?.active &&
        (promoCode.maxUses === null || promoCode.usedCount < promoCode.maxUses) &&
        (!promoCode.expiresAt || promoCode.expiresAt > new Date());
      if (isUsable && promoCode) {
        redeemedPromoCodeId = promoCode.id;
      }
    }
  }

  const ownReferralCode = await generateUniqueReferralCode();

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      homeCountry,
      role: "CUSTOMER",
      referralCode: ownReferralCode,
      referredByUserId,
      redeemedPromoCodeId,
    },
  });

  // Kick off KYC immediately — the user can browse but cannot send money
  // until kycStatus is APPROVED (enforced in transactions.service via
  // runComplianceScreening).
  try {
    const kycCase = await startKycCase(user.id, user.email);

    // Reserve the promo code slot only once signup has actually succeeded —
    // if KYC startup fails below and the user record is rolled back, this
    // line is never reached, so usedCount never needs to be undone.
    if (redeemedPromoCodeId) {
      await prisma.promoCode.update({
        where: { id: redeemedPromoCodeId },
        data: { usedCount: { increment: 1 } },
      });
    }

    logger.info({ userId: user.id, referredByUserId, redeemedPromoCodeId }, "auth.signup");
    return { ...user, kycStatus: "PENDING" as const, kycVerificationUrl: kycCase.verificationUrl };
  } catch (err) {
    // Starting the KYC session failed (vendor outage, bad API key, out of
    // credits, etc.) — don't leave an orphaned user behind with no way to
    // retry signup using the same email. Roll back and surface the failure.
    logger.error({ userId: user.id, err }, "auth.signup_kyc_failed_rolling_back");
    await prisma.user.delete({ where: { id: user.id } });
    throw err;
  }
}
export class InvalidMfaCodeError extends Error {
  constructor() {
    super("Invalid MFA code");
    this.name = "InvalidMfaCodeError";
  }
}


interface LoginResult {
  user: { id: string; email: string; role: string };
  mfaRequired: boolean;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) throw new InvalidCredentialsError();

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    logger.warn({ email }, "auth.login_failed");
    throw new InvalidCredentialsError();
  }

  // Backfill a referral code for accounts created before this feature
  // existed, so every user is shareable without a separate migration script.
  if (!user.referralCode) {
    const referralCode = await generateUniqueReferralCode();
    await prisma.user.update({ where: { id: user.id }, data: { referralCode } });
  }

  return { user: { id: user.id, email: user.email, role: user.role }, mfaRequired: user.mfaEnabled };
}

export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecret) throw new InvalidMfaCodeError();
  const secret = decryptField(user.mfaSecret);
  return authenticator.verify({ token: code, secret });
}

/** Begin MFA enrollment: generate a TOTP secret, return the otpauth URL for the user to scan. */
export async function enrollMfa(userId: string, email: string) {
  const secret = authenticator.generateSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { mfaSecret: encryptField(secret) }, // not enabled until confirmed via confirmMfaEnrollment
  });
  const otpauthUrl = authenticator.keyuri(email, "MoyoSend", secret);
  return { otpauthUrl };
}

export async function confirmMfaEnrollment(userId: string, code: string): Promise<boolean> {
  const valid = await verifyMfaCode(userId, code);
  if (!valid) return false;
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
  return true;
}

/**
 * Record which device a login/signup is coming from (roadmap section 7.1:
 * device fingerprinting + new-device alerts). `fingerprint` is a random ID
 * the frontend generates once and persists in localStorage — not invasive
 * browser fingerprinting, just "have we seen this browser before."
 */
export async function recordDeviceLogin(
  userId: string,
  fingerprint: string,
  userAgent: string | undefined,
  ip: string | undefined
): Promise<{ isNewDevice: boolean }> {
  const existing = await prisma.device.findUnique({
    where: { userId_fingerprint: { userId, fingerprint } },
  });

  if (existing) {
    await prisma.device.update({
      where: { id: existing.id },
      data: { userAgent, lastSeenIp: ip },
    });
    return { isNewDevice: false };
  }

  await prisma.device.create({
    data: { userId, fingerprint, userAgent, lastSeenIp: ip },
  });
  return { isNewDevice: true };
}

// How long a password reset link stays valid before the user has to request a new one.
const PASSWORD_RESET_TTL_MINUTES = 30;

export class InvalidResetTokenError extends Error {
  constructor() {
    super("This password reset link is invalid or has expired");
    this.name = "InvalidResetTokenError";
  }
}

/**
 * Kick off a password reset. Deliberately behaves identically whether or
 * not the email belongs to a real account — the route handler always
 * returns the same generic response, so this can't be used to enumerate
 * registered users.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    logger.info({ email }, "auth.password_reset_requested_unknown_email");
    return;
  }

  // Store only a hash of the token — same reasoning as password hashing:
  // if the DB ever leaks, the leaked value shouldn't be directly usable.
  const token = randomBytes(32).toString("hex");
  const passwordResetTokenHash = createHash("sha256").update(token).digest("hex");
  const passwordResetExpiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetTokenHash, passwordResetExpiresAt },
  });

  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  await sendPasswordResetEmail(user.email, resetUrl);
  logger.info({ userId: user.id }, "auth.password_reset_requested");
}

/** Complete a password reset: verify the token, then set the new password. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const passwordResetTokenHash = createHash("sha256").update(token).digest("hex");
  const user = await prisma.user.findUnique({ where: { passwordResetTokenHash } });

  if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
    throw new InvalidResetTokenError();
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null },
  });

  await sendPasswordChangedEmail(user.email);
  logger.info({ userId: user.id }, "auth.password_reset_completed");
}
