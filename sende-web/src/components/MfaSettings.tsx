import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

export default function MfaSettings() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(Boolean(user?.mfaEnabled));
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.enrollMfa();
      setOtpauthUrl(res.otpauthUrl);
    } catch {
      setError("Couldn't start MFA setup. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.confirmMfa(code);
      if (res.mfaEnabled) {
        setEnabled(true);
        setOtpauthUrl(null);
        setCode("");
      }
    } catch {
      setError("That code didn't match — check your authenticator app and try again.");
    } finally {
      setBusy(false);
    }
  }

  const qrImageUrl = otpauthUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`
    : null;

  return (
    <section>
      <h2>Security</h2>
      <div className="card-form">
        <div className="security-status-row">
          <div className={`security-status-icon ${enabled ? "security-status-icon-ok" : "security-status-icon-warn"}`}>
            {enabled ? "✓" : "!"}
          </div>
          <div>
            <strong>Two-factor authentication</strong>
            <div className="hint">
              {enabled ? (
                <span className="badge badge-ok">Enabled</span>
              ) : (
                <span className="badge badge-warn">Not enabled</span>
              )}
            </div>
          </div>
        </div>
        <p className="hint">
          When enabled, you'll be asked for a code from your authenticator app whenever you add a new recipient or
          send an unusually large transfer — on top of your regular login.
        </p>

        {enabled ? (
          <p className="muted">MFA is protecting your account. Contact support if you need to reset it.</p>
        ) : otpauthUrl ? (
          <>
            <p>Scan this with an authenticator app (Google Authenticator, Authy, etc.):</p>
            {qrImageUrl && (
              <div className="qr-box">
                <img src={qrImageUrl} alt="MFA QR code" width={200} height={200} />
              </div>
            )}
            <p className="hint">Or enter this manually if you can't scan: {otpauthUrl}</p>
            <label>
              Enter the 6-digit code from your app
              <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn-primary" disabled={busy || code.length < 6} onClick={confirm}>
              {busy ? "Confirming…" : "Confirm and enable"}
            </button>
          </>
        ) : (
          <>
            {error && <p className="error">{error}</p>}
            <button className="btn-primary" disabled={busy} onClick={startEnroll}>
              {busy ? "Starting…" : "Set up MFA"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}