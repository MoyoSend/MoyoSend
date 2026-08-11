import { Resend } from "resend";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Send a password reset email. If Resend isn't configured (no API key),
 * this just logs instead of throwing — same graceful-degradation pattern
 * as Stripe, so the app doesn't hard-fail in environments without email set up.
 */
export async function sendPasswordResetEmail(toEmail: string, resetUrl: string) {
  if (!resend) {
    logger.warn({ toEmail, resetUrl }, "email.resend_not_configured_skipping_send");
    return;
  }

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: toEmail,
    subject: "Reset your MoyoSend password",
    html: `
      <p>We received a request to reset your MoyoSend password.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a>. This link expires in 30 minutes.</p>
      <p>If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
    `,
  });
  logger.info({ toEmail }, "email.password_reset_sent");
}

/**
 * Confirmation sent after a password reset actually completes — a
 * security signal, not just a courtesy: if the user didn't do this
 * themselves, this email is how they'd find out someone else did.
 */
export async function sendPasswordChangedEmail(toEmail: string) {
  if (!resend) {
    logger.warn({ toEmail }, "email.resend_not_configured_skipping_send");
    return;
  }

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: toEmail,
    subject: "Your MoyoSend password was changed",
    html: `
      <p>This confirms your MoyoSend password was just changed.</p>
      <p>If you made this change, no action is needed.</p>
      <p>If you didn't make this change, please contact support immediately — your account may be compromised.</p>
    `,
  });
  logger.info({ toEmail }, "email.password_changed_confirmation_sent");
}

/** Sent once a transfer is accepted by the payout aggregator (in flight). */
export async function sendTransferSentEmail(
  toEmail: string,
  details: { recipientName: string; sendAmount: string; receiveAmount: string }
) {
  if (!resend) {
    logger.warn({ toEmail }, "email.resend_not_configured_skipping_send");
    return;
  }
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: toEmail,
    subject: "Your MoyoSend transfer is on its way",
    html: `
      <p>Your transfer of <strong>${details.sendAmount}</strong> to <strong>${details.recipientName}</strong> has been sent to our payout partner.</p>
      <p>They should receive <strong>${details.receiveAmount}</strong> shortly.</p>
      <p>You can track its status any time in your MoyoSend transaction history.</p>
    `,
  });
  logger.info({ toEmail }, "email.transfer_sent_notification");
}

/** Sent once the payout aggregator confirms the recipient actually received the funds. */
export async function sendTransferCompletedEmail(
  toEmail: string,
  details: { recipientName: string; receiveAmount: string }
) {
  if (!resend) {
    logger.warn({ toEmail }, "email.resend_not_configured_skipping_send");
    return;
  }
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: toEmail,
    subject: "Your transfer has been delivered",
    html: `
      <p>Good news — <strong>${details.recipientName}</strong> has received <strong>${details.receiveAmount}</strong>.</p>
      <p>Thanks for sending with MoyoSend.</p>
    `,
  });
  logger.info({ toEmail }, "email.transfer_completed_notification");
}

/** Sent whenever a transaction is refunded — a failed payout, a compliance reversal, or an admin refund. */
export async function sendTransferRefundedEmail(
  toEmail: string,
  details: { recipientName: string; sendAmount: string; reason: string }
) {
  if (!resend) {
    logger.warn({ toEmail }, "email.resend_not_configured_skipping_send");
    return;
  }
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: toEmail,
    subject: "Your MoyoSend transfer was refunded",
    html: `
      <p>Your transfer of <strong>${details.sendAmount}</strong> to <strong>${details.recipientName}</strong> couldn't be completed and has been refunded.</p>
      <p>Reason: ${details.reason}</p>
      <p>If you paid by card, the refund will appear back on your statement within a few days. If you have questions, contact MoyoSend support.</p>
    `,
  });
  logger.info({ toEmail }, "email.transfer_refunded_notification");
}