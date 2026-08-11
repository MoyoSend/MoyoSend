import { randomBytes } from "crypto";

// No 0/O/1/I/L — avoids codes that are ambiguous to read aloud or type from
// a screenshot, since these get shared informally (text, social, etc).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReferralCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}