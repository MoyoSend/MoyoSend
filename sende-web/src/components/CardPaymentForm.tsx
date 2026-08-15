import { useState, type FormEvent } from "react";
import { Elements, PaymentElement, ExpressCheckoutElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise } from "../lib/stripeClient";

function InnerForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  async function confirmPayment() {
    if (!stripe || !elements) return;
    setError(null);
    setPaying(true);

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed. Please check your card details and try again.");
      setPaying(false);
      return;
    }

    if (paymentIntent && paymentIntent.status === "succeeded") {
      onSuccess(paymentIntent.id);
    } else {
      setError("Payment could not be confirmed. Please try again.");
      setPaying(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await confirmPayment();
  }

  // Fires when the user taps a wallet button (Google Pay / Apple Pay / Link) —
  // bypasses the regular form submit, so it needs its own handler that
  // reuses the same confirmPayment logic.
  async function handleExpressCheckout() {
    await confirmPayment();
  }

  return (
    <form className="card-payment-form" onSubmit={handleSubmit}>
      <ExpressCheckoutElement onConfirm={handleExpressCheckout} />
      <PaymentElement />
      {error && <p className="error">{error}</p>}
      <div className="card-payment-actions">
        <button type="button" className="link-button" onClick={onCancel} disabled={paying}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!stripe || paying}>
          {paying ? "Processing…" : "Pay & send"}
        </button>
      </div>
    </form>
  );
}

export default function CardPaymentForm({
  clientSecret,
  onSuccess,
  onCancel,
}: {
  clientSecret: string;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <InnerForm onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}