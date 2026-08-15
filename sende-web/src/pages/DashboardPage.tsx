import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, type Recipient, type Transaction } from "../api/client";
import SendMoneyPanel from "../components/SendMoneyPanel";
import RecipientForm from "../components/RecipientForm";
import TransactionDetail from "../components/TransactionDetail";
import MfaSettings from "../components/MfaSettings";
import ReferralPanel from "../components/ReferralPanel";
import TransferLimitsPanel from "../components/TransferLimitsPanel";
import BillPaymentPanel from "../components/BillPaymentPanel";
import GetAppPanel from "../components/GetAppPanel";
import ManageCardsPanel from "../components/ManageCardsPanel";
import WalletPanel from "../components/WalletPanel";

type Tab = "send" | "recipients" | "history" | "security" | "referrals" | "limits" | "bills" | "cards" | "wallet" | "app";

function statusBadgeClass(status: string) {
  if (["PAID_OUT", "FUNDS_COLLECTED", "COMPLIANCE_SCREENED", "SENT_TO_PAYOUT"].includes(status)) return "status-badge-success";
  if (["FAILED", "REJECTED", "REFUNDED"].includes(status)) return "status-badge-fail";
  if (status === "COMPLIANCE_HOLD") return "status-badge-hold";
  return "status-badge-pending";
}
export default function DashboardPage() {
  const { user, logout, newDeviceAlert, dismissNewDeviceAlert } = useAuth();
  const [tab, setTab] = useState<Tab>("send");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showAddRecipient, setShowAddRecipient] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState<Recipient | null>(null);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [repeatPrefill, setRepeatPrefill] = useState<{
    recipientId: string;
    sendCurrency: string;
    receiveCountry: string;
    amount: string;
  } | null>(null);

  function handleRepeatTransfer(prefill: {
    recipientId: string;
    sendCurrency: string;
    receiveCountry: string;
    amount: string;
  }) {
    setRepeatPrefill(prefill);
    setSelectedTransactionId(null);
    setTab("send");
  }

  async function refreshRecipients() {
    const { recipients } = await api.listRecipients();
    setRecipients(recipients);
  }

  async function handleDeleteRecipient(id: string, name: string) {
    if (!window.confirm(`Remove ${name} from your recipients? You can add them again later if needed.`)) return;
    await api.deleteRecipient(id);
    refreshRecipients();
  }
  async function refreshTransactions() {
    const { transactions } = await api.listTransactions();
    setTransactions(transactions);
  }

  useEffect(() => {
    refreshRecipients();
    refreshTransactions();
  }, []);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <img src="/moyosend-wordmark.svg" alt="MoyoSend" className="brand-logo" />
        <div className="header-right">
          {user?.kycStatus && user.kycStatus !== "APPROVED" && (
            <span className="badge badge-warn">Identity verification: {user.kycStatus}</span>
          )}
          {(user?.role === "ADMIN" || user?.role === "COMPLIANCE_OFFICER") && (
            <Link to="/admin" className="link-button">
              Admin
            </Link>
          )}
          <span className="muted">{user?.email}</span>
          <button className="link-button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {newDeviceAlert && (
        <div className="new-device-banner">
          <span>
            We noticed a login from a new device or browser. If this wasn't you,{" "}
            <button
              className="link-button"
              onClick={() => {
                setTab("security");
                dismissNewDeviceAlert();
              }}
            >
              review your account security
            </button>
            .
          </span>
          <button className="link-button" onClick={dismissNewDeviceAlert}>
            Dismiss
          </button>
        </div>
      )}

      <nav className="tabs">
        <button className={tab === "send" ? "tab active" : "tab"} onClick={() => setTab("send")}>
          Send money
        </button>
        <button className={tab === "recipients" ? "tab active" : "tab"} onClick={() => setTab("recipients")}>
          Recipients
        </button>
        <button className={tab === "history" ? "tab active" : "tab"} onClick={() => setTab("history")}>
          Transaction history
        </button>
        <button className={tab === "security" ? "tab active" : "tab"} onClick={() => setTab("security")}>
          Security
        </button>
        <button className={tab === "referrals" ? "tab active" : "tab"} onClick={() => setTab("referrals")}>
          Refer & earn
        </button>
        <button className={tab === "limits" ? "tab active" : "tab"} onClick={() => setTab("limits")}>
          Limits
        </button>
        <button className={tab === "bills" ? "tab active" : "tab"} onClick={() => setTab("bills")}>
          Pay bills
        </button>
        <button className={tab === "cards" ? "tab active" : "tab"} onClick={() => setTab("cards")}>
          Manage cards
        </button>
        <button className={tab === "wallet" ? "tab active" : "tab"} onClick={() => setTab("wallet")}>
          Wallet
        </button>
        <button className={tab === "app" ? "tab active" : "tab"} onClick={() => setTab("app")}>
          Get the app
        </button>
      </nav>

      <div className="dashboard-layout">
      <main className="dashboard-content">
        {tab === "send" && (
          <SendMoneyPanel
            recipients={recipients}
            onNeedRecipient={() => {
              setTab("recipients");
              setShowAddRecipient(true);
            }}
            onSent={refreshTransactions}
            prefill={repeatPrefill}
            onPrefillConsumed={() => setRepeatPrefill(null)}
          />
        )}

        {tab === "recipients" && (
          <section>
            <div className="section-header">
              <h2>Recipients</h2>
              <button
                className="btn-primary"
                onClick={() => {
                  setEditingRecipient(null);
                  setShowAddRecipient((v) => !v);
                }}
              >
                {showAddRecipient ? "Cancel" : "+ Add recipient"}
              </button>
            </div>
            {showAddRecipient && (
              <RecipientForm
                onCreated={() => {
                  setShowAddRecipient(false);
                  refreshRecipients();
                }}
              />
            )}
            {editingRecipient && (
              <RecipientForm
                recipient={editingRecipient}
                onCreated={() => {
                  setEditingRecipient(null);
                  refreshRecipients();
                }}
                onCancel={() => setEditingRecipient(null)}
              />
            )}
            {recipients.length === 0 ? (
              <div className="empty-state">
                <p>You haven't added any recipients yet.</p>
                <p className="muted">Add someone to start sending money to them.</p>
              </div>
            ) : (
              <ul className="recipient-list">
                {recipients.map((r) => (
                  <li key={r.id} className="recipient-card">
                    <div className="recipient-avatar">{r.fullName.charAt(0).toUpperCase()}</div>
                    <div className="recipient-info">
                      <strong>{r.fullName}</strong>
                      <span className="recipient-meta">
                        {r.country} · {r.payoutMethod === "BANK_TRANSFER" ? "Bank transfer" : "Mobile money"}
                      </span>
                    </div>
                    {r.verified ? (
                      <span className="badge badge-ok">
                        Verified{r.verifiedAccountName ? ` — ${r.verifiedAccountName}` : ""}
                      </span>
                    ) : (
                      <span className="badge">Unverified</span>
                    )}
                    <div className="recipient-actions">
                      <button
                        className="recipient-action-btn"
                        onClick={() => {
                          setShowAddRecipient(false);
                          setEditingRecipient(r);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="recipient-action-btn recipient-action-btn-danger"
                        onClick={() => handleDeleteRecipient(r.id, r.fullName)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "security" && <MfaSettings />}

        {tab === "referrals" && <ReferralPanel />}

        {tab === "limits" && <TransferLimitsPanel />}

        {tab === "bills" && <BillPaymentPanel />}

        {tab === "cards" && <ManageCardsPanel />}

        {tab === "wallet" && <WalletPanel />}

        {tab === "app" && <GetAppPanel />}

        {tab === "history" && (
          selectedTransactionId ? (
            <TransactionDetail
              transactionId={selectedTransactionId}
              onBack={() => setSelectedTransactionId(null)}
              onRepeat={handleRepeatTransfer}
            />
          ) : (
            <section>
              <h2>Transaction history</h2>
              {transactions.length === 0 ? (
                <div className="empty-state">
                  <p>No transactions yet.</p>
                  <p className="muted">Your transfers will show up here once you send money.</p>
                </div>
              ) : (
                <table className="txn-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sent</th>
                      <th>Received</th>
                      <th>Status</th>
                      <th>Transfer ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id} className="txn-row" onClick={() => setSelectedTransactionId(t.id)}>
                        <td>{new Date(t.createdAt).toLocaleString()}</td>
                        <td>{(Number(t.sendAmount) / 100).toFixed(2)} {t.sendCurrency}</td>
                        <td>{(Number(t.receiveAmount) / 100).toFixed(2)} {t.receiveCurrency}</td>
                        <td>
                          <span className={`status-badge ${statusBadgeClass(t.status)}`}>
                            {t.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="mono">{t.id.slice(0, 8)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )
        )}
      </main>

      <aside className="dashboard-side">
        <div className="side-card side-card-trust">
          <h3>Bank-level security</h3>
          <p className="muted">
            Your transfers are protected by encryption, fraud monitoring, and step-up
            verification on large or unusual transactions.
          </p>
        </div>

        <div className="side-card side-card-referral">
          <h3>Give $10, get $10</h3>
          <p className="muted">
            Invite friends and family to MoyoSend. You both get a bonus on their first transfer.
          </p>
          <button className="side-cta" onClick={() => setTab("referrals")}>
            Invite now
          </button>
        </div>

        <div className="side-card side-card-app">
          <h3>Take MoyoSend with you</h3>
          <p className="muted">
            Send money on the go with our mobile app. Available for iOS and Android.
          </p>
          <button className="side-cta side-cta-outline" onClick={() => setTab("app")}>
            Get the app
          </button>
        </div>
      </aside>
      </div>
    </div>
  );
}