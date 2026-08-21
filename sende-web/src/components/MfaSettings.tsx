import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
function IdentityVerification() {
  const [status, setStatus] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .getKycStatus()
      .then((res) => {
        setStatus(res.status);
        setVerificationUrl(res.verificationUrl);
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return null;
  const isApproved = status === "APPROVED";
  const isRejected = status === "REJECTED";
  const isManualReview = status === "MANUAL_REVIEW";
  return (
    <div className="card-form" style={{ marginBottom: "20px" }}>
      <div className="security-status-row">
        <div className={`security-status-icon ${isApproved ? "security-status-icon-ok" : "security-status-icon-warn"}`}>
          {isApproved ? "✓" : "!"}
        </div>
        <div>
          <strong>Identity verification</strong>
          <div className="hint">
            {isApproved && <span className="badge badge-ok">Verified</span>}
            {isManualReview && <span className="badge badge-warn">Under review</span>}
            {isRejected && <span className="badge badge-warn">Needs attention</span>}
            {!isApproved && !isManualReview && !isRejected && <span className="badge badge-warn">Pending</span>}
          </div>
        </div>
      </div>
      {isApproved && (
        <p className="muted">Your identity has been verified. You're all set to send money.</p>
      )}
      {isManualReview && (
        <p className="muted">
          Your verification is being manually reviewed. We'll email you once it's decided — no action needed right
          now.
        </p>
      )}
      {isRejected && (
        <p className="muted">
          We couldn't verify your identity from the documents provided. Please contact support for help.
        </p>
      )}
      {!isApproved && !isManualReview && !isRejected && (
        <>
          <p className="hint">
            You'll need to verify your identity before you can send money — it only takes a couple of minutes.
          </p>
          {verificationUrl ? (
            <a className="btn-primary" href={verificationUrl} target="_blank" rel="noopener noreferrer">
              Verify identity
            </a>
          ) : (
            <p className="muted">
              We're preparing your verification session. Refresh this page in a moment, or contact support if this
              persists.
            </p>
          )}
        </>
      )}
    </div>
  );
}
export default function MfaSettings() {
  const { user, updateUser } = useAuth();
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
        updateUser({ mfaEnabled: true });
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
      <IdentityVerification />
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
