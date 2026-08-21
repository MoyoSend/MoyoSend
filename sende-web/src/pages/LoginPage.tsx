import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/client";
import PasswordInput from "../components/PasswordInput";
export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const identifier = method === "email" ? { email } : { phone };
      await login(identifier, password, mfaCode || undefined);
      navigate("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.message === "mfa_required") {
        setMfaRequired(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
      }
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
            <h1>Log in to MoyoSend</h1>
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <button
                type="button"
                onClick={() => setMethod("email")}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: method === "email" ? "1px solid #0e9488" : "1px solid #d7dbe0",
                  background: method === "email" ? "#0e9488" : "#ffffff",
                  color: method === "email" ? "#ffffff" : "#3a4150",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Email
              </button>
              <button
                type="button"
                onClick={() => setMethod("phone")}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: method === "phone" ? "1px solid #0e9488" : "1px solid #d7dbe0",
                  background: method === "phone" ? "#0e9488" : "#ffffff",
                  color: method === "phone" ? "#ffffff" : "#3a4150",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Phone number
              </button>
            </div>
            <form onSubmit={onSubmit}>
              {method === "email" ? (
                <label>
                  Email
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
              ) : (
                <label>
                  Phone number
                  <input
                    type="tel"
                    required
                    placeholder="e.g. +447700900000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
              )}
              <label>
                Password
                <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              {method === "email" && (
                <p className="muted" style={{ textAlign: "right", marginTop: "-8px" }}>
                  <Link to="/forgot-password">Forgot password?</Link>
                </p>
              )}
              {mfaRequired && (
                <label>
                  6-digit authentication code
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    required
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                  />
                </label>
              )}
              {error && <p className="error">{error}</p>}
              <button type="submit" disabled={loading}>
                {loading ? "Logging in…" : "Log in"}
              </button>
            </form>
            <p className="muted">
              New to MoyoSend? <Link to="/signup">Create an account</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
