import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import PasswordInput from "../components/PasswordInput";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is missing its token. Please request a new one.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(token, newPassword);
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't reset your password. The link may have expired — request a new one."
      );
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
            <h1>Set a new password</h1>
            {done ? (
              <p>Your password has been reset. Redirecting you to log in…</p>
            ) : (
              <>
                <form onSubmit={onSubmit}>
                  <label>
                    New password
                    <PasswordInput
                      required
                      minLength={12}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </label>
                  <label>
                    Confirm new password
                    <PasswordInput
                      required
                      minLength={12}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </label>
                  {error && <p className="error">{error}</p>}
                  <button type="submit" disabled={loading}>
                    {loading ? "Saving…" : "Reset password"}
                  </button>
                </form>
                <p className="muted">
                  <Link to="/forgot-password">Request a new link</Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}