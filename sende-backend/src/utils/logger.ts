import pino from "pino";
import { env } from "../config/env";

// Structured logging is required for both incident response and, in a
// regulated money-movement business, for compliance evidence. Never log
// secrets, full card/account numbers, or raw KYC document contents.
export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  redact: {
    paths: [
      "req.headers.authorization",
      "*.password",
      "*.passwordHash",
      "*.accountNumber",
      "*.mfaSecret",
      "*.mobileNumber",
    ],
    censor: "[REDACTED]",
  },
});
