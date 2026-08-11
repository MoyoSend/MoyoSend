import { useEffect, useState } from "react";
import { api, type SavedCard } from "../api/client";
import SetupCardForm from "./SetupCardForm";

const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
};

export default function ManageCardsPanel() {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function loadCards() {
    setLoading(true);
    api
      .listPaymentMethods()
      .then(({ cards }) => setCards(cards))
      .catch(() => setError("Couldn't load your saved cards."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadCards();
  }, []);

  async function startAddCard() {
    setError(null);
    setAdding(true);
    try {
      const { clientSecret } = await api.createSetupIntent();
      setClientSecret(clientSecret);
    } catch {
      setError("Couldn't start adding a card. Please try again.");
      setAdding(false);
    }
  }

  async function removeCard(id: string) {
    setError(null);
    setRemovingId(id);
    try {
      await api.deletePaymentMethod(id);
      setCards((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setError("Couldn't remove this card. Please try again.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section>
      <h2>Manage cards</h2>
      <p className="muted">
        Save a card once and reuse it for transfers and bill payments — you'll still confirm each transaction with
        your 6-digit authenticator code.
      </p>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading your cards…</p>
      ) : cards.length === 0 ? (
        <p className="muted">You don't have any saved cards yet.</p>
      ) : (
        <div className="bundle-list">
          {cards.map((c) => (
            <div key={c.id} className="bundle-card">
              <div className="bundle-card-name">
                {BRAND_LABELS[c.brand] ?? c.brand} •••• {c.last4}
              </div>
              <div className="bundle-card-meta">
                Expires {String(c.expMonth).padStart(2, "0")}/{c.expYear}
              </div>
              <button
                type="button"
                className="link-button"
                onClick={() => removeCard(c.id)}
                disabled={removingId === c.id}
              >
                {removingId === c.id ? "Removing…" : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}

      {clientSecret ? (
        <SetupCardForm
          clientSecret={clientSecret}
          onSuccess={() => {
            setClientSecret(null);
            setAdding(false);
            loadCards();
          }}
          onCancel={() => {
            setClientSecret(null);
            setAdding(false);
          }}
        />
      ) : (
        <button className="btn-primary" onClick={startAddCard} disabled={adding}>
          {adding ? "Preparing…" : "Add a card"}
        </button>
      )}
    </section>
  );
}