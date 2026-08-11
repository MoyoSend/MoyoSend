import { loadStripe } from "@stripe/stripe-js";

// Loaded once and shared across the app — Stripe.js recommends a single
// instance, and SendMoneyPanel needs direct access to it (outside of an
// <Elements> tree) to call stripe.handleCardAction() when a saved card
// requires 3D Secure.
export const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);