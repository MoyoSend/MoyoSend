import { FormEvent, useState } from "react";
import { api, type AdminTransaction } from "../api/client";
import PromoCodesPanel from "../components/PromoCodesPanel";

const STATUS_OPTIONS = [
  "CREATED",
  "QUOTED",
  "FUNDS_COLLECTED",
  "COMPLIANCE_SCREENED",
  "COMPLIANCE_HOLD",
  "SENT_TO_PAYOUT",
  "PAID_OUT",
  "FAILED",
  "REFUND_INITIATED",
  "REFUNDED",
  "REJECTED",
];

// Statuses where a refund actually makes sense — no point offering it on a
// transaction that's already PAID_OUT or already REFUNDED.
const REFUNDABLE_STATUSES = new Set([
  "CREATED",
  "FUNDS_COLLECTED",
  "COMPLIANCE_SCREENED",
  "COMPLIANCE_HOLD",
  "SENT_TO_PAYOUT",
  "FAILED",
]);

export default function AdminPage() {
  const [section, setSection] = useState<"transactions" | "promoCodes">("transactions");
  const [status, setStatus] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function runSearch(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.adminSearchTransactions({
        status: status || undefined,
        senderEmail: senderEmail || undefined,
      });
      setTransactions(res.transactions);
      setSearched(true);
    } catch {
      setError("Couldn't load transactions. Your account may not have admin access.");
    } finally {
      setLoading(false);
    }
  }

  async function onRefund(id: string) {
    const reason = window.prompt("Reason for this refund? (shown in the audit log)");
    if (!reason) return;
    setRefundingId(id);
    setError(null);
    try {
      await api.adminRefundTransaction(id, reason);
      await runSearch();
    } catch {
      setError("Refund failed. Check the backend terminal for details.");
    } finally {
      setRefundingId(null);
    }
  }

  return (
    <div>
      <h1>Admin console</h1>
      <p>Staff-only — requires ADMIN or COMPLIANCE_OFFICER role.</p>

      <div className="tabs" style={{ padding: "0 0 16px" }}>
        <button
          className={section === "transactions" ? "tab active" : "tab"}
          onClick={() => setSection("transactions")}
        >
          Transactions
        </button>
        <button
          className={section === "promoCodes" ? "tab active" : "tab"}
          onClick={() => setSection("promoCodes")}
        >
          Promo codes
        </button>
      </div>

      {section === "promoCodes" && <PromoCodesPanel />}

      {section === "transactions" && (
        <>
      <form className="card-form" onSubmit={runSearch}>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sender email
          <input
            type="email"
            placeholder="user@example.com"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search transactions"}
        </button>
      </form>

      {searched && transactions.length === 0 && <p>No transactions match that search.</p>}

      {transactions.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Sender</th>
              <th>Recipient</th>
              <th>Sent</th>
              <th>Received</th>
              <th>Status</th>
              <th>Transaction ID</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
                <td>{t.sender.email}</td>
                <td>
                  {t.recipient.fullName} ({t.recipient.country})
                </td>
                <td>
                  {(Number(t.sendAmount) / 100).toFixed(2)} {t.sendCurrency}
                </td>
                <td>
                  {(Number(t.receiveAmount) / 100).toFixed(2)} {t.receiveCurrency}
                </td>
                <td>{t.status}</td>
                <td>{t.id.slice(0, 8)}…</td>
                <td>
                  {REFUNDABLE_STATUSES.has(t.status) && (
                    <button onClick={() => onRefund(t.id)} disabled={refundingId === t.id}>
                      {refundingId === t.id ? "Refunding…" : "Refund"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
        </>
      )}
    </div>
  );
}
