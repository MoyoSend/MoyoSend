import crypto from "node:crypto";
import argon2 from "argon2";

/**
 * Password hashing — Argon2id, tuned per OWASP guidance. Never store or log
 * plaintext passwords anywhere, including in error messages.
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 19456, // ~19 MB
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Field-level encryption for sensitive-but-needed-in-app fields (e.g. MFA
 * secrets, tokenized account numbers). In production the data key below
 * must come from a real KMS (AWS KMS / GCP KMS / Vault transit engine) and
 * be rotated on a schedule — this local derivation is a placeholder so the
 * scaffold runs without external dependencies.
 *
 * Never use this pattern for full card numbers — those must never touch
 * this codebase at all; use your PCI-DSS-compliant processor's tokenization.
 */
const ALGO = "aes-256-gcm";

function getDataKey(): Buffer {
  const keyMaterial = process.env.KMS_KEY_ID ?? "local-dev-key-do-not-use-in-prod";
  return crypto.createHash("sha256").update(keyMaterial).digest();
}

export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const key = getDataKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptField(ciphertext: string): string {
  const [ivB64, tagB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed ciphertext");
  const key = getDataKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Constant-time comparison for webhook signature verification. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 signature verification for inbound webhooks (KYC/payout vendors). */
export function verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return timingSafeEqual(expected, signature);
}
