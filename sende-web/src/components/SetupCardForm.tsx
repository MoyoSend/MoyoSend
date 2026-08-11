import { useState, type FormEvent } from "react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise } from "../lib/stripeClient";

function InnerForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError(null);
    setSaving(true);

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Couldn't save this card. Please check the details and try again.");
      setSaving(false);
      return;
    }

    if (setupIntent && setupIntent.status === "succeeded") {
      onSuccess();
    } else {
      setError("Couldn't confirm this card. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form className="card-payment-form" onSubmit={handleSubmit}>
      <PaymentElement />
      {error && <p className="error">{error}</p>}
      <div className="card-payment-actions">
        <button type="button" className="link-button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!stripe || saving}>
          {saving ? "Saving…" : "Save card"}
        </button>
      </div>
    </form>
  );
}

export default function SetupCardForm({
  clientSecret,
  onSuccess,
  onCancel,
}: {
  clientSecret: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <InnerForm onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}