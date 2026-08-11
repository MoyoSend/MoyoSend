import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  newIdempotencyKey,
  type Corridor,
  type Quote,
  type Recipient,
  type SavedCard,
} from "../api/client";
import CardPaymentForm from "./CardPaymentForm";
import { stripePromise } from "../lib/stripeClient";

interface RepeatTransferPrefill {
  recipientId: string;
  sendCurrency: string;
  receiveCountry: string;
  amount: string;
}

interface Props {
  recipients: Recipient[];
  onNeedRecipient: () => void;
  onSent: () => void;
  prefill?: RepeatTransferPrefill | null;
  onPrefillConsumed?: () => void;
}

const SEND_ORIGIN_LABELS: Record<string, string> = {
  GBP: "United Kingdom",
  EUR: "Eurozone",
  USD: "United States",
  MYR: "Malaysia",
};

const RECEIVE_COUNTRY_LABELS: Record<string, string> = {
  NG: "Nigeria",
  GH: "Ghana",
  SN: "Senegal",
  KE: "Kenya",
  UG: "Uganda",
  TZ: "Tanzania",
  ZM: "Zambia",
  CM: "Cameroon",
  CI: "Côte d'Ivoire",
  SL: "Sierra Leone",
  ZA: "South Africa",
};

export default function SendMoneyPanel({ recipients, onNeedRecipient, onSent, prefill, onPrefillConsumed }: Props) {
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [sendCurrency, setSendCurrency] = useState<string>(prefill?.sendCurrency ?? "");
  const [receiveCountry, setReceiveCountry] = useState<string>(prefill?.receiveCountry ?? "");
  const [recipientId, setRecipientId] = useState<string>(prefill?.recipientId ?? "");
  const [amount, setAmount] = useState<string>(prefill?.amount ?? "100");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [transactionRef, setTransactionRef] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"success" | "hold" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>("new");
  const [savePaymentMethod, setSavePaymentMethod] = useState(false);
  const [confirmingSavedCard, setConfirmingSavedCard] = useState(false);

  useEffect(() => {
    if (prefill) onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.listCorridors().then(({ corridors }) => {
      setCorridors(corridors);
      if (!prefill && corridors.length > 0 && corridors[0]) {
        setSendCurrency(corridors[0].sendCurrency);
        setReceiveCountry(corridors[0].receiveCountry);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api
      .listPaymentMethods()
      .then(({ cards }) => setSavedCards(cards))
      .catch(() => {});
  }, []);

  const sendOrigins = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const c of corridors) {
      if (!seen.has(c.sendCurrency)) {
        seen.add(c.sendCurrency);
        list.push(c.sendCurrency);
      }
    }
    return list;
  }, [corridors]);

  const receiveOptions = useMemo(
    () => corridors.filter((c) => c.sendCurrency === sendCurrency),
    [corridors, sendCurrency]
  );

  useEffect(() => {
    if (receiveOptions.length === 0) return;
    if (!receiveOptions.some((c) => c.receiveCountry === receiveCountry)) {
      const first = receiveOptions[0];
      if (first) setReceiveCountry(first.receiveCountry);
    }
  }, [receiveOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCorridor = corridors.find(
    (c) => c.sendCurrency === sendCurrency && c.receiveCountry === receiveCountry
  );

  useEffect(() => {
    setQuote(null);
    if (!selectedCorridor) return;
    setQuoteLoading(true);
    api
      .getQuote(selectedCorridor.sendCurrency, selectedCorridor.receiveCurrency, selectedCorridor.id)
      .then(setQuote)
      .catch(() => setError("Couldn't fetch a live rate right now."))
      .finally(() => setQuoteLoading(false));
  }, [selectedCorridor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startPayment() {
    if (!selectedCorridor || !recipientId) return;
    setError(null);
    setCreatingIntent(true);
    try {
      const sendAmountMinor = String(Math.round(Number(amount) * 100));
      const ref = newIdempotencyKey();

      if (selectedCardId !== "new") {
        // Charging a saved card — the backend confirms it immediately, so
        // there's no card entry UI to show. We only need to step in if the
        // issuing bank demands 3D Secure authentication.
        const res = await api.createPaymentIntent(sendAmountMinor, sendCurrency, ref, {
          paymentMethodId: selectedCardId,
        });
        setTransactionRef(ref);

        if (res.status === "succeeded") {
          await sendTransaction(res.paymentIntentId);
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
          await sendTransaction(paymentIntent.id);
          return;
        }

        setError("This card was declined. Please try a different card.");
        return;
      }

      const res = await api.createPaymentIntent(sendAmountMinor, sendCurrency, ref, { savePaymentMethod });
      setTransactionRef(ref);
      setClientSecret(res.clientSecret);
    } catch (err) {
      console.error("startPayment failed:", err);
      setError("Couldn't start the payment. Please try again.");
    } finally {
      setCreatingIntent(false);
      setConfirmingSavedCard(false);
    }
  }

  async function sendTransaction(paymentIntentId: string, mfaCode?: string) {
    if (!selectedCorridor || !recipientId || !transactionRef) return;
    setError(null);
    setSending(true);
    try {
      const sendAmountMinor = String(Math.round(Number(amount) * 100));
      const res = await api.createTransaction(
        { recipientId, corridorId: selectedCorridor.id, sendAmountMinor, paymentIntentId },
        transactionRef,
        mfaCode
      );
      setResult(res.transaction ? "success" : "hold");
      onSent();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 401 &&
        (err.body as { error?: string } | undefined)?.error === "step_up_required"
      ) {
        setSending(false);
        const code = window.prompt("Enter your 6-digit authenticator code to confirm this transfer:");
        if (code) {
          await sendTransaction(paymentIntentId, code);
        } else {
          setError("Sending this amount requires a verification code.");
        }
        return;
      }
      setError("We couldn't complete this transfer. Please check the amount and try again.");
    } finally {
      setSending(false);
    }
  }

  function resetForm() {
    setResult(null);
    setError(null);
    setRecipientId("");
    setAmount("100");
    setClientSecret(null);
    setTransactionRef(null);
    setSelectedCardId("new");
    setSavePaymentMethod(false);
  }

  const hasNoFee = selectedCorridor
    ? Number(selectedCorridor.feeFlatMinor) === 0 && selectedCorridor.feeBps === 0
    : false;

  if (recipients.length === 0) {
    return (
      <section className="empty-state">
        <h2>Send money</h2>
        <p className="muted">Add a recipient first so we know where the money should land.</p>
        <button onClick={onNeedRecipient}>Add a recipient</button>
      </section>
    );
  }

  if (result) {
    return (
      <section>
        <h2>Send money</h2>
        <div className="empty-state">
          {result === "success" && (
            <p className="success">Transfer submitted — tracking it in Transaction history.</p>
          )}
          {result === "hold" && (
            <p className="warn">
              This transfer needs a quick manual review before it can proceed. We'll notify you once it clears.
            </p>
          )}
          <button onClick={resetForm}>Send another transfer</button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2>Send money</h2>

      <div className="send-hero">
        <div className="send-hero-row">
          <div className="send-hero-field">
            <span className="send-hero-label">You send</span>
            <div className="send-hero-amount-row">
              <input
                type="number"
                min="1"
                step="0.01"
                className="send-hero-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <select
                className="send-hero-currency"
                value={sendCurrency}
                onChange={(e) => setSendCurrency(e.target.value)}
              >
                {sendOrigins.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
            <span className="hint">{SEND_ORIGIN_LABELS[sendCurrency] ?? sendCurrency}</span>
          </div>

          <div className="send-hero-arrow">→</div>

          <div className="send-hero-field">
            <span className="send-hero-label">Recipient gets</span>
            <div className="send-hero-amount-row">
              <span className="send-hero-result">
                {quote ? (Number(amount) * quote.appliedRate).toFixed(2) : "—"}
              </span>
              <select
                className="send-hero-currency"
                value={receiveCountry}
                onChange={(e) => setReceiveCountry(e.target.value)}
              >
                {receiveOptions.map((c) => (
                  <option key={c.receiveCountry} value={c.receiveCountry}>
                    {c.receiveCurrency}
                  </option>
                ))}
              </select>
            </div>
            <span className="hint">{RECEIVE_COUNTRY_LABELS[receiveCountry] ?? receiveCountry}</span>
          </div>
        </div>

        <div className="send-hero-meta">
          <span className="muted">
            {quoteLoading
              ? "Fetching live rate…"
              : quote
              ? `1 ${quote.baseCurrency} = ${quote.appliedRate.toFixed(4)} ${quote.quoteCurrency} · rate locked for 3 min`
              : "Select a corridor to see the rate"}
          </span>
          {selectedCorridor &&
            (hasNoFee ? (
              <span className="badge badge-ok">No transfer fees</span>
            ) : (
              <span className="badge">
                Fee: {(Number(selectedCorridor.feeFlatMinor) / 100).toFixed(2)} {selectedCorridor.sendCurrency}
                {selectedCorridor.feeBps > 0 && ` + ${(selectedCorridor.feeBps / 100).toFixed(2)}%`}
              </span>
            ))}
        </div>
      </div>

      <div className="send-form">
        <label>
          Recipient
          <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
            <option value="">Select a recipient…</option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName} ({r.country})
              </option>
            ))}
          </select>
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
              sendTransaction(paymentIntentId);
            }}
            onCancel={() => setClientSecret(null)}
          />
        ) : confirmingSavedCard ? (
          <button className="send-cta" disabled>
            Verifying your card…
          </button>
        ) : sending ? (
          <button className="send-cta" disabled>
            Finalizing transfer…
          </button>
        ) : (
          <button
            className="send-cta"
            disabled={!recipientId || !quote || creatingIntent}
            onClick={startPayment}
          >
            {creatingIntent ? "Preparing payment…" : "Send money"}
          </button>
        )}
      </div>
    </section>
  );
}