import { useEffect, useState } from "react";
import { api, type TransferLimit, type LimitIncreaseDocumentType } from "../api/client";

function formatMinor(amountMinor: string, currency: string): string {
  return `${(Number(amountMinor) / 100).toFixed(2)} ${currency}`;
}

const DOCUMENT_OPTIONS: { type: LimitIncreaseDocumentType; label: string; hint: string }[] = [
  { type: "PAY_SLIP", label: "Pay slip", hint: "1 full month's salary, dated within the last 3 months." },
  { type: "BANK_STATEMENT", label: "Bank statement", hint: "Must be dated within the last 30 days and cover at least 3 months." },
  { type: "TAX_RETURN", label: "Tax return", hint: "Must be from the most recent tax year." },
  { type: "INVESTMENT_PENSION", label: "Proof of investment/pension", hint: "Statement issued within the last 3 months." },
];

export default function TransferLimitsPanel() {
  const [limits, setLimits] = useState<TransferLimit[] | null>(null);
  const [increaseStatus, setIncreaseStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<LimitIncreaseDocumentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getTransferLimits().then(({ limits }) => setLimits(limits));
    api.getLimitIncreaseStatus().then(({ status }) => setIncreaseStatus(status));
  }, []);

  async function requestIncrease(documentType: LimitIncreaseDocumentType) {
    setError(null);
    setSubmitting(documentType);
    try {
      const res = await api.requestLimitIncrease(documentType);
      setIncreaseStatus(res.status);
      if (res.verificationUrl) {
        window.open(res.verificationUrl, "_blank", "noopener,noreferrer");
      }
    } catch {
      setError("Couldn't start that right now. Please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  if (!limits) return <p className="muted">Loading your limits…</p>;

  return (
    <section>
      <h2>Transfer limits</h2>
      <p className="muted">
        To keep transfers safe and compliant, there's a rolling 24-hour sending limit per currency.
      </p>
      {limits.length === 0 && (
        <p className="muted">You haven't sent anything in the last 24 hours — no active limits right now.</p>
      )}
      {limits.map((limit) => {
        const used = Number(limit.usedMinor);
        const cap = Number(limit.limitMinor);
        const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
        return (
          <div key={limit.currency} className="card-form limit-card">
            <p className="limit-card-title">
              <strong>{limit.currency}</strong> — last 24 hours
            </p>
            <div className="progress-track">
              <div
                className={`progress-fill ${pct >= 100 ? "progress-fill-full" : ""}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="hint limit-card-usage">
              {formatMinor(limit.usedMinor, limit.currency)} of {formatMinor(limit.limitMinor, limit.currency)} used
            </p>
          </div>
        );
      })}

      <div className="card-form">
        <h3 className="limits-increase-heading">Increase your limits</h3>
        {increaseStatus === "PENDING" || increaseStatus === "MANUAL_REVIEW" ? (
          <p className="muted">
            Your document is being reviewed — we'll update your limit automatically once it's verified.
          </p>
        ) : increaseStatus === "APPROVED" ? (
          <p className="success">Your limit increase was approved.</p>
        ) : (
          <>
            <p className="muted">Select a proof of funds document to upload.</p>
            {DOCUMENT_OPTIONS.map((doc) => (
              <button
                key={doc.type}
                className="doc-option"
                onClick={() => requestIncrease(doc.type)}
                disabled={submitting !== null}
              >
                <div className="doc-option-title">{submitting === doc.type ? "Starting…" : doc.label}</div>
                <div className="doc-option-hint">{doc.hint}</div>
              </button>
            ))}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}