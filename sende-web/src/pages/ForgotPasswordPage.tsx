import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSubmitted(true);
    } catch {
      // Don't leak whether the email exists even on an unexpected error —
      // just ask the user to try again shortly.
      setError("Something went wrong. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-split">
        <div className="auth-brand-panel">
          <div className="auth-brand-name">
            <span className="auth-brand-mark">M</span>
            MoyoSend
          </div>
          <h2 className="auth-brand-tagline">Send money home in minutes, not days.</h2>
          <p className="auth-brand-subtext">
            Real exchange rates, transparent fees, and fast delivery to bank accounts and mobile money
            across Africa and beyond.
          </p>
          <svg className="auth-brand-illustration" viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="160" cy="110" r="88" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
            <circle cx="160" cy="110" r="58" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
            <path d="M58 140 Q160 50 262 92" stroke="#0e9488" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M68 78 Q160 172 248 140" stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.5" />
            <circle cx="58" cy="140" r="6" fill="#0e9488" />
            <circle cx="262" cy="92" r="6" fill="#ffffff" />
            <circle cx="68" cy="78" r="5" fill="#ffffff" opacity="0.7" />
            <circle cx="248" cy="140" r="5" fill="#0e9488" opacity="0.7" />
          </svg>
        </div>

        <div className="auth-form-panel">
          <div className="auth-card">
            <h1>Reset your password</h1>
            {submitted ? (
              <>
                <p>
                  If an account exists for <strong>{email}</strong>, we've sent a link to reset your
                  password. It expires in 30 minutes.
                </p>
                <p className="muted">
                  <Link to="/login">Back to log in</Link>
                </p>
              </>
            ) : (
              <>
                <p className="muted">Enter your email and we'll send you a link to reset your password.</p>
                <form onSubmit={onSubmit}>
                  <label>
                    Email
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  {error && <p className="error">{error}</p>}
                  <button type="submit" disabled={loading}>
                    {loading ? "Sending…" : "Send reset link"}
                  </button>
                </form>
                <p className="muted">
                  <Link to="/login">Back to log in</Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}