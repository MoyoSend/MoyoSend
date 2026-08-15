import { useEffect, useState } from "react";
import {
  api,
  newIdempotencyKey,
  type SavedCard,
  type WalletBalance,
} from "../api/client";
import CardPaymentForm from "./CardPaymentForm";
import { stripePromise } from "../lib/stripeClient";

const CURRENCIES = ["GBP", "USD", "EUR", "MYR"];

export default function WalletPanel() {
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [currency, setCurrency] = useState("GBP");
  const [amount, setAmount] = useState("50");
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>("new");
  const [savePaymentMethod, setSavePaymentMethod] = useState(false);
  const [confirmingSavedCard, setConfirmingSavedCard] = useState(false);
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [sending, setSending] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState<{ ref: string; amountMinor: string; currency: string } | null>(
    null
  );
  const [result, setResult] = useState<"success" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refreshBalances() {
    api.getWalletBalances().then(({ balances }) => setBalances(balances));
  }

  useEffect(() => {
    refreshBalances();
    api
      .listPaymentMethods()
      .then(({ cards }) => setSavedCards(cards))
      .catch(() => {});
  }, []);

  async function confirmTopUp(paymentIntentId: string, amountMinor: string, currency: string, ref: string) {
    setError(null);
    setSending(true);
    try {
      await api.confirmWalletTopUp({ amountMinor, currency, paymentIntentId }, ref);
      setResult("success");
      refreshBalances();
    } catch (err) {
      console.error("confirmTopUp failed:", err);
      setError("Couldn't complete the top-up. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function startTopUp() {
    if (!(Number(amount) > 0)) return;
    setError(null);
    setCreatingIntent(true);
    try {
      const amountMinor = String(Math.round(Number(amount) * 100));
      const ref = newIdempotencyKey();

      if (selectedCardId !== "new") {
        const res = await api.createWalletTopUpIntent(amountMinor, currency, { paymentMethodId: selectedCardId });

        if (res.status === "succeeded") {
          await confirmTopUp(res.paymentIntentId, amountMinor, currency, ref);
          return;
        }

        if (res.status === "requires_action") {
          setConfirmingSavedCard(true);
          const stripe = await stripePromise;
          if (!stripe) {
            setError("Payment couldn't be verified. Please try again.");
            setConfirmingSavedCard(false);
            return;
          }
          const { error: actionError, paymentIntent } = await stripe.confirmCardPayment(res.clientSecret);
          setConfirmingSavedCard(false);
          if (actionError || !paymentIntent || paymentIntent.status !== "succeeded") {
            setError(actionError?.message ?? "This card couldn't be verified. Please try a different card.");
            return;
          }
          await confirmTopUp(paymentIntent.id, amountMinor, currency, ref);
          return;
        }

        setError("This card was declined. Please try a different card.");
        return;
      }

      const res = await api.createWalletTopUpIntent(amountMinor, currency, { savePaymentMethod });
      setPendingSubmit({ ref, amountMinor, currency });
      setClientSecret(res.clientSecret);
    } catch (err) {
      console.error("startTopUp failed:", err);
      setError("Couldn't start the top-up. Please try again.");
    } finally {
      setCreatingIntent(false);
      setConfirmingSavedCard(false);
    }
  }

  function resetForm() {
    setResult(null);
    setError(null);
    setAmount("50");
    setSelectedCardId("new");
    setSavePaymentMethod(false);
    setClientSecret(null);
    setPendingSubmit(null);
  }

  if (result) {
    return (
      <section>
        <h2>Wallet</h2>
        <div className="empty-state">
          <p className="success">Wallet topped up — your new balance is shown below.</p>
          <button className="btn-primary" onClick={resetForm}>
            Top up again
          </button>
        </div>
        <BalancesList balances={balances} />
      </section>
    );
  }

  return (
    <section>
      <h2>Wallet</h2>
      <BalancesList balances={balances} />

      <h3>Top up</h3>
      <div className="send-form">
        <label>
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>

        {savedCards.length > 0 && !clientSecret && (
          <label>
            Pay with
            <select value={selectedCardId} onChange={(e) => setSelectedCardId(e.target.value)}>
              {savedCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.brand} •••• {c.last4} (exp {String(c.expMonth).padStart(2, "0")}/{c.expYear})
                </option>
              ))}
              <option value="new">Use a new card</option>
            </select>
          </label>
        )}

        {selectedCardId === "new" && !clientSecret && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={savePaymentMethod}
              onChange={(e) => setSavePaymentMethod(e.target.checked)}
            />
            Save this card for future use
          </label>
        )}

        {error && <p className="error">{error}</p>}

        {clientSecret ? (
          <CardPaymentForm
            clientSecret={clientSecret}
            onSuccess={(paymentIntentId) => {
              setClientSecret(null);
              if (pendingSubmit) confirmTopUp(paymentIntentId, pendingSubmit.amountMinor, pendingSubmit.currency, pendingSubmit.ref);
            }}
            onCancel={() => setClientSecret(null)}
          />
        ) : confirmingSavedCard ? (
          <button className="btn-primary" disabled>
            Verifying your card…
          </button>
        ) : sending ? (
          <button className="btn-primary" disabled>
            Topping up…
          </button>
        ) : (
          <button className="btn-primary" disabled={!(Number(amount) > 0) || creatingIntent} onClick={startTopUp}>
            {creatingIntent ? "Preparing…" : "Top up"}
          </button>
        )}
      </div>
    </section>
  );
}

function BalancesList({ balances }: { balances: WalletBalance[] }) {
  if (balances.length === 0) {
    return (
      <div className="empty-state">
        <p>No wallet balance yet.</p>
        <p className="muted">Top up below to get started.</p>
      </div>
    );
  }
  return (
    <ul className="recipient-list">
      {balances.map((b) => (
        <li key={b.currency} className="recipient-card">
          <div className="recipient-info">
            <strong>
              {(Number(b.balanceMinor) / 100).toFixed(2)} {b.currency}
            </strong>
          </div>
        </li>
      ))}
    </ul>
  );
}