import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/client";

const SEND_COUNTRIES = [
  { code: "GB", label: "United Kingdom (GBP)" },
  { code: "IE", label: "Ireland (EUR)" },
  { code: "DE", label: "Germany (EUR)" },
];

export default function SignUpPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [homeCountry, setHomeCountry] = useState("GB");
  const [referralOrPromoCode, setReferralOrPromoCode] = useState(searchParams.get("ref") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signUp(email, password, homeCountry, referralOrPromoCode || undefined);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
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
          <h2 className="auth-brand-tagline">Join thousands sending money smarter.</h2>
          <p className="auth-brand-subtext">
            Real exchange rates, transparent fees, and a referral bonus when you and a friend both send
            your first transfer.
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
            <span className="badge badge-ok">No hidden fees — see your exact rate before you send</span>
            <h1>Create your MoyoSend account</h1>
            <p className="muted">
              We'll ask you to verify your identity next — that's required before you can send money, for
              everyone's protection.
            </p>
            <form onSubmit={onSubmit}>
              <label>
                Email
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                Password
                <input
                  type="password"
                  required
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span className="hint">At least 12 characters.</span>
              </label>
              <label>
                Where do you live?
                <select value={homeCountry} onChange={(e) => setHomeCountry(e.target.value)}>
                  {SEND_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Referral or promo code <span className="hint">(optional)</span>
                <input
                  value={referralOrPromoCode}
                  onChange={(e) => setReferralOrPromoCode(e.target.value.toUpperCase())}
                  placeholder="e.g. AB3XQK9P"
                />
              </label>
              {error && <p className="error">{error}</p>}
              <button type="submit" disabled={loading}>
                {loading ? "Creating account…" : "Create account"}
              </button>
            </form>
            <p className="muted">
              Already have an account? <Link to="/login">Log in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}