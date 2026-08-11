import { useEffect, useMemo, useState } from "react";
import {
  api,
  newIdempotencyKey,
  ApiError,
  type BillNetwork,
  type BillDataBundle,
  type BillPayment,
  type Corridor,
  type SavedCard,
} from "../api/client";
import CardPaymentForm from "./CardPaymentForm";
import { stripePromise } from "../lib/stripeClient";

const SEND_ORIGIN_LABELS: Record<string, string> = {
  GBP: "United Kingdom",
  EUR: "Eurozone",
  USD: "United States",
  MYR: "Malaysia",
};

function billStatusBadgeClass(status: string) {
  if (["COMPLETED", "SUCCESS", "SUCCESSFUL", "PAID"].includes(status)) return "status-badge-success";
  if (["FAILED", "REJECTED", "REFUNDED"].includes(status)) return "status-badge-fail";
  if (status === "COMPLIANCE_HOLD") return "status-badge-hold";
  return "status-badge-pending";
}

export default function BillPaymentPanel() {
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [corridorsLoaded, setCorridorsLoaded] = useState(false);
  const [sendCurrency, setSendCurrency] = useState("");
  const [type, setType] = useState<"AIRTIME" | "DATA">("AIRTIME");
  const [networks, setNetworks] = useState<BillNetwork[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<BillNetwork | null>(null);
  const [bundles, setBundles] = useState<BillDataBundle[]>([]);
  const [loadingBundles, setLoadingBundles] = useState(false);
  const [selectedBundle, setSelectedBundle] = useState<BillDataBundle | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [ngnAmount, setNgnAmount] = useState("1000");
  const [estimatedSendAmount, setEstimatedSendAmount] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"success" | "hold" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<BillPayment[]>([]);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>("new");
  const [savePaymentMethod, setSavePaymentMethod] = useState(false);
  const [confirmingSavedCard, setConfirmingSavedCard] = useState(false);
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState<{ ref: string; sendAmountMinor: string } | null>(null);

  useEffect(() => {
    api.listCorridors().then(({ corridors }) => {
      const ngCorridors = corridors.filter((c) => c.receiveCountry === "NG");
      setCorridors(ngCorridors);
      if (ngCorridors.length > 0 && ngCorridors[0]) {
        setSendCurrency(ngCorridors[0].sendCurrency);
      }
      setCorridorsLoaded(true);
    });
  }, []);

  useEffect(() => {
    api
      .listPaymentMethods()
      .then(({ cards }) => setSavedCards(cards))
      .catch(() => {});
  }, []);

  const sendCurrencyOptions = useMemo(() => {
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

  useEffect(() => {
    api.listBillNetworks(type).then(({ networks }) => {
      setNetworks(networks);
      setSelectedNetwork(networks[0] ?? null);
    });
  }, [type]);

  useEffect(() => {
    if (type !== "DATA" || !selectedNetwork) {
      setBundles([]);
      setSelectedBundle(null);
      return;
    }
    setLoadingBundles(true);
    setSelectedBundle(null);
    api
      .listDataBundles(selectedNetwork.billerCode)
      .then(({ bundles }) => setBundles(bundles))
      .catch(() => setBundles([]))
      .finally(() => setLoadingBundles(false));
  }, [type, selectedNetwork]);

  useEffect(() => {
    api.listBillPayments().then(({ billPayments }) => setHistory(billPayments));
  }, [result]);

  const selectedCorridor = useMemo(
    () => corridors.find((c) => c.sendCurrency === sendCurrency) ?? null,
    [corridors, sendCurrency]
  );

  // Live preview of what this payment will actually cost — mirrors the
  // exact base+fee math bill.service.ts uses server-side, so the number
  // shown here matches what's actually charged.
  useEffect(() => {
    const targetNgnAmountMinor =
      type === "DATA" ? (selectedBundle ? Number(selectedBundle.amountNgnMinor) : null) : Number(ngnAmount) * 100;

    if (!selectedCorridor || !targetNgnAmountMinor || targetNgnAmountMinor <= 0) {
      setEstimatedSendAmount(null);
      return;
    }

    let cancelled = false;
    setEstimating(true);
    api
      .getQuote(sendCurrency, "NGN", selectedCorridor.id)
      .then((quote) => {
        if (cancelled) return;
        const baseSendAmountMinor = Math.ceil(targetNgnAmountMinor / quote.appliedRate);
        const feeAmountMinor =
          Number(selectedCorridor.feeFlatMinor) + Math.floor((baseSendAmountMinor * selectedCorridor.feeBps) / 10_000);
        setEstimatedSendAmount((baseSendAmountMinor + feeAmountMinor) / 100);
      })
      .catch(() => {
        if (!cancelled) setEstimatedSendAmount(null);
      })
      .finally(() => {
        if (!cancelled) setEstimating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [type, ngnAmount, selectedBundle, selectedCorridor, sendCurrency]);

  // Figures out exactly what will be charged right now, using a fresh
  // quote — called at the moment the user taps Pay so the PaymentIntent is
  // created for a precise amount. bill.service.ts trusts this amount (it
  // only re-derives its own fresh quote server-side to enforce a floor,
  // not to overwrite what was actually charged).
  async function computeChargeAmount(): Promise<string | null> {
    if (!selectedCorridor) return null;
    const targetNgnAmountMinor =
      type === "DATA" ? (selectedBundle ? Number(selectedBundle.amountNgnMinor) : null) : Number(ngnAmount) * 100;
    if (!targetNgnAmountMinor || targetNgnAmountMinor <= 0) return null;

    const quote = await api.getQuote(sendCurrency, "NGN", selectedCorridor.id);
    const baseSendAmountMinor = Math.ceil(targetNgnAmountMinor / quote.appliedRate);
    const feeAmountMinor =
      Number(selectedCorridor.feeFlatMinor) + Math.floor((baseSendAmountMinor * selectedCorridor.feeBps) / 10_000);
    return String(baseSendAmountMinor + feeAmountMinor);
  }

  async function startPayment() {
    if (!selectedNetwork || !phoneNumber || !sendCurrency || !selectedCorridor) return;
    if (type === "DATA" && !selectedBundle) return;
    if (type === "AIRTIME" && !(Number(ngnAmount) > 0)) return;
    setError(null);
    setCreatingIntent(true);
    try {
      const sendAmountMinor = await computeChargeAmount();
      if (!sendAmountMinor) {
        setError("Couldn't calculate the amount to charge. Please try again.");
        return;
      }
      const ref = newIdempotencyKey();

      if (selectedCardId !== "new") {
        const res = await api.createPaymentIntent(sendAmountMinor, sendCurrency, ref, {
          paymentMethodId: selectedCardId,
        });

        if (res.status === "succeeded") {
          await submitBillPayment(res.paymentIntentId, sendAmountMinor, ref);
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
          await submitBillPayment(paymentIntent.id, sendAmountMinor, ref);
          return;
        }

        setError("This card was declined. Please try a different card.");
        return;
      }

      const res = await api.createPaymentIntent(sendAmountMinor, sendCurrency, ref, { savePaymentMethod });
      setPendingSubmit({ ref, sendAmountMinor });
      setClientSecret(res.clientSecret);
    } catch (err) {
      console.error("startPayment failed:", err);
      setError("Couldn't start the payment. Please try again.");
    } finally {
      setCreatingIntent(false);
      setConfirmingSavedCard(false);
    }
  }

  async function submitBillPayment(paymentIntentId: string, sendAmountMinor: string, ref: string) {
    if (!selectedNetwork || !phoneNumber || !sendCurrency) return;
    setError(null);
    setSending(true);
    try {
      const itemCode = type === "DATA" ? selectedBundle!.itemCode : selectedNetwork.itemCode;
      const ngnAmountMinor = type === "DATA" ? undefined : String(Math.round(Number(ngnAmount) * 100));
      const res = await api.createBillPayment(
        {
          type,
          network: selectedNetwork.network,
          billerCode: selectedNetwork.billerCode,
          itemCode,
          phoneNumber,
          ngnAmountMinor,
          sendCurrency,
          paymentIntentId,
          sendAmountMinor,
        },
        ref
      );
      setResult(res.billPayment ? "success" : "hold");
    } catch (err) {
      if (err instanceof ApiError && err.status === 202) {
        setResult("hold");
      } else {
        setError("Couldn't complete this payment. Please check the details and try again.");
      }
    } finally {
      setSending(false);
    }
  }

  function resetForm() {
    setResult(null);
    setError(null);
    setPhoneNumber("");
    setNgnAmount("1000");
    setSelectedBundle(null);
    setEstimatedSendAmount(null);
    setSelectedCardId("new");
    setSavePaymentMethod(false);
    setClientSecret(null);
    setPendingSubmit(null);
  }

  if (corridorsLoaded && sendCurrencyOptions.length === 0) {
    return (
      <section className="empty-state">
        <h2>Pay bills in Nigeria</h2>
        <p className="muted">No send corridors to Nigeria are currently configured.</p>
      </section>
    );
  }

  if (result) {
    return (
      <section>
        <h2>Pay bills in Nigeria</h2>
        <div className="empty-state">
          {result === "success" && <p className="success">Payment submitted — check history below for status.</p>}
          {result === "hold" && <p className="warn">This payment needs a quick manual review before it can proceed.</p>}
          <button className="btn-primary" onClick={resetForm}>
            Make another payment
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2>Pay bills in Nigeria</h2>
      <div className="send-form">
        <label>
          You send from
          <select value={sendCurrency} onChange={(e) => setSendCurrency(e.target.value)}>
            {sendCurrencyOptions.map((currency) => (
              <option key={currency} value={currency}>
                {SEND_ORIGIN_LABELS[currency] ?? currency} ({currency})
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as "AIRTIME" | "DATA")}>
            <option value="AIRTIME">Airtime</option>
            <option value="DATA">Data bundle</option>
          </select>
        </label>
        <label>
          Network
          <select
            value={selectedNetwork?.billerCode ?? ""}
            onChange={(e) => setSelectedNetwork(networks.find((n) => n.billerCode === e.target.value) ?? null)}
          >
            {networks.length === 0 && <option value="">No networks available</option>}
            {networks.map((n) => (
              <option key={n.billerCode} value={n.billerCode}>
                {n.network}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phone number
          <input
            type="tel"
            placeholder="e.g. 08012345678"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
        </label>

        {type === "DATA" ? (
          <div className="bundle-picker">
            <span className="hint">Choose a data bundle</span>
            {loadingBundles && <p className="muted">Loading bundles…</p>}
            {!loadingBundles && selectedNetwork && bundles.length === 0 && (
              <p className="muted">No bundles found for this network right now.</p>
            )}
            <div className="bundle-list">
              {bundles.map((b) => (
                <button
                  type="button"
                  key={b.itemCode}
                  className={`bundle-card ${selectedBundle?.itemCode === b.itemCode ? "bundle-card-selected" : ""}`}
                  onClick={() => setSelectedBundle(b)}
                >
                  <div className="bundle-card-name">{b.name}</div>
                  <div className="bundle-card-meta">
                    {b.validityDays ? `${b.validityDays} day${b.validityDays === 1 ? "" : "s"}` : "—"}
                  </div>
                  <div className="bundle-card-price">NGN {(Number(b.amountNgnMinor) / 100).toFixed(2)}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label>
            How much airtime? (NGN)
            <input type="number" min="50" step="50" value={ngnAmount} onChange={(e) => setNgnAmount(e.target.value)} />
          </label>
        )}

        {(type === "AIRTIME" ? Number(ngnAmount) > 0 : !!selectedBundle) && (
          <p className="hint">
            {estimating
              ? "Calculating cost…"
              : estimatedSendAmount !== null
              ? `≈ You'll pay ${estimatedSendAmount.toFixed(2)} ${sendCurrency}`
              : null}
          </p>
        )}

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
              if (pendingSubmit) submitBillPayment(paymentIntentId, pendingSubmit.sendAmountMinor, pendingSubmit.ref);
            }}
            onCancel={() => setClientSecret(null)}
          />
        ) : confirmingSavedCard ? (
          <button className="btn-primary" disabled>
            Verifying your card…
          </button>
        ) : sending ? (
          <button className="btn-primary" disabled>
            Sending…
          </button>
        ) : (
          <button
            className="btn-primary"
            disabled={
              !selectedNetwork ||
              !phoneNumber ||
              !sendCurrency ||
              creatingIntent ||
              (type === "DATA" ? !selectedBundle : !(Number(ngnAmount) > 0))
            }
            onClick={startPayment}
          >
            {creatingIntent ? "Preparing payment…" : "Pay"}
          </button>
        )}
      </div>

      {history.length > 0 && (
        <>
          <h3>Recent bill payments</h3>
          <table className="txn-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Network</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.createdAt).toLocaleString()}</td>
                  <td>{b.type === "AIRTIME" ? "Airtime" : "Data"}</td>
                  <td>{b.network}</td>
                  <td>
                    {(Number(b.sendAmount) / 100).toFixed(2)} {b.sendCurrency}
                  </td>
                  <td>
                    <span className={`status-badge ${billStatusBadgeClass(b.status)}`}>
                      {b.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}