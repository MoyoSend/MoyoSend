import "dotenv/config";
import { z } from "zod";

// Fail fast: the app should refuse to boot with a missing/malformed secret
// rather than silently running with an insecure default in production.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ACCESS_TOKEN_TTL: z.string().default("15m"),
  JWT_REFRESH_TOKEN_TTL: z.string().default("30d"),

  REDIS_URL: z.string().optional(),

  KYC_PROVIDER: z.string().default("mock"),
  KYC_API_KEY: z.string().optional(),
  KYC_API_SECRET: z.string().optional(),
  KYC_WORKFLOW_ID: z.string().optional(),
  LIMIT_INCREASE_WORKFLOW_ID: z.string().optional(),
  KYC_WEBHOOK_SIGNING_SECRET: z.string().optional(),

  FX_PROVIDER: z.string().default("mock"),
  FX_API_KEY: z.string().optional(),

  PAYOUT_PROVIDER_AFRICA: z.string().default("mock"),
  PAYOUT_AFRICA_API_KEY: z.string().optional(),
  PAYOUT_PROVIDER_SOUTH_ASIA: z.string().default("mock"),
  PAYOUT_SOUTH_ASIA_API_KEY: z.string().optional(),
  FLW_WEBHOOK_SECRET_HASH: z.string().optional(),

  // Stripe — collects real payment from the sender's card before we move
  // any money. Optional so the app still boots without it (falls back to
  // the old mock ledger-only debit) until this is fully wired in.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Resend — sends transactional emails (password reset for now, more
  // later). Optional so the app still boots without it; requests just get
  // logged instead of emailed.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("MoyoSend <onboarding@resend.dev>"),

  // Base URL of the web app, used to build links inside emails (e.g. the
  // password reset link).
  FRONTEND_URL: z.string().default("http://localhost:5173"),

  KMS_KEY_ID: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
