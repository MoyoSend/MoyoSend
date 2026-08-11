import { useEffect, useState } from "react";
import { api, type TransactionDetail as TransactionDetailType } from "../api/client";

function formatMoney(amountMinor: string, currency: string) {
  return `${(Number(amountMinor) / 100).toFixed(2)} ${currency}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Transfer created",
  FUNDS_COLLECTED: "Funds collected",
  COMPLIANCE_SCREENED: "Compliance check passed",
  COMPLIANCE_HOLD: "Held for manual review",
  SENT_TO_PAYOUT: "Sent to payout partner",
  PAID_OUT: "Delivered to recipient",
  FAILED: "Transfer failed",
  REFUND_INITIATED: "Refund initiated",
  REFUNDED: "Refunded",
  REJECTED: "Rejected",
};

export interface RepeatTransferPrefill {
  recipientId: string;
  sendCurrency: string;
  receiveCountry: string;
  amount: string;
}

export default function TransactionDetail({
  transactionId,
  onBack,
  onRepeat,
}: {
  transactionId: string;
  onBack: () => void;
  onRepeat: (prefill: RepeatTransferPrefill) => void;
}) {
  const [t, setT] = useState<TransactionDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTransaction(transactionId)
      .then((res) => setT(res.transaction))
      .catch(() => setError("Couldn't load this transfer."));
  }, [transactionId]);

  if (error) {
    return (
      <section className="txn-detail">
        <button className="link-button" onClick={onBack}>← Back</button>
        <p className="error">{error}</p>
      </section>
    );
  }
  if (!t) {
    return (
      <section className="txn-detail">
        <button className="link-button" onClick={onBack}>← Back</button>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="txn-detail">
      <button className="link-button" onClick={onBack}>← Back to history</button>

      <h2 className="detail-heading">Transfer status</h2>
      <div className="card-form">
        <ol className="status-timeline">
          {t.statusEvents.map((event) => (
            <li key={event.id}>
              <div className="status-timeline-dot" />
              <div>
                <strong>{STATUS_LABELS[event.toStatus] ?? event.toStatus}</strong>
                <div className="hint">{formatDateTime(event.createdAt)}</div>
                {event.reason && <div className="hint">{event.reason}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <h3 className="detail-heading">Recipient</h3>
      <div className="card-form">
        <strong>{t.recipient.fullName}</strong>
        <div className="muted">
          {t.recipient.country} · {t.recipient.payoutMethod === "BANK_TRANSFER" ? "Bank transfer" : "Mobile money"}
        </div>
        <button
          className="btn-primary detail-action"
          onClick={() =>
            onRepeat({
              recipientId: t.recipient.id,
              sendCurrency: t.sendCurrency,
              receiveCountry: t.recipient.country,
              amount: (Number(t.sendAmount) / 100).toString(),
            })
          }
        >
          Send again
        </button>
      </div>

      <h3 className="detail-heading">Amount</h3>
      <div className="card-form">
        <div className="amount-row"><span>You sent</span><strong>{formatMoney(t.sendAmount, t.sendCurrency)}</strong></div>
        <div className="amount-row"><span>Fee</span><strong>{formatMoney(t.feeAmount, t.sendCurrency)}</strong></div>
        <div className="amount-row"><span>Exchange rate</span><strong>1 {t.sendCurrency} = {Number(t.fxRateLocked).toFixed(4)} {t.receiveCurrency}</strong></div>
        <hr />
        <div className="amount-row"><span>Recipient gets</span><strong>{formatMoney(t.receiveAmount, t.receiveCurrency)}</strong></div>
      </div>

      <h3 className="detail-heading">Transfer details</h3>
      <div className="card-form">
        <div className="amount-row"><span>Sent</span><span>{formatDateTime(t.createdAt)}</span></div>
        <div className="amount-row"><span>Last updated</span><span>{formatDateTime(t.updatedAt)}</span></div>
        <div className="amount-row"><span>Transfer ID</span><span className="mono">{t.id}</span></div>
        {t.payoutReference && (
          <div className="amount-row"><span>Payout reference</span><span className="mono">{t.payoutReference}</span></div>
        )}
      </div>
    </section>
  );
}