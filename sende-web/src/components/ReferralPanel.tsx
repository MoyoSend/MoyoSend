import { useEffect, useState } from "react";
import { api, type ReferralInfo } from "../api/client";

export default function ReferralPanel() {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getReferralInfo().then(setInfo);
  }, []);

  if (!info) return <p className="muted">Loading your referral details…</p>;

  const referralLink = info.referralCode ? `${window.location.origin}/signup?ref=${info.referralCode}` : null;

  async function copyLink() {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section>
      <h2>Refer & earn</h2>

      <div className="referral-hero">
        <h3>Give $10, get $10</h3>
        <p>
          Share your code — when someone you refer completes their first transfer, you both get a bonus
          credited to your wallet.
        </p>
      </div>

      <div className="card-form">
        {info.referralCode ? (
          <>
            <label>Your referral link</label>
            <div className="referral-link-row">
              <input readOnly value={referralLink ?? ""} onFocus={(e) => e.target.select()} />
              <button className="btn-primary" onClick={copyLink}>
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>
            <p className="hint">
              Your code: <strong>{info.referralCode}</strong>
            </p>
          </>
        ) : (
          <p className="muted">Your referral code is being set up — check back shortly.</p>
        )}
      </div>

      <div className="referral-stats">
        <div className="stat-card">
          <span className="stat-value">{info.referralCount}</span>
          <span className="stat-label">{info.referralCount === 1 ? "person referred" : "people referred"}</span>
        </div>
        {Object.keys(info.totalEarnedByCurrency).length > 0 && (
          <div className="stat-card stat-card-earn">
            <span className="stat-value">
              {Object.entries(info.totalEarnedByCurrency)
                .map(([currency, amountMinor]) => `${(Number(amountMinor) / 100).toFixed(2)} ${currency}`)
                .join(", ")}
            </span>
            <span className="stat-label">total earned</span>
          </div>
        )}
      </div>
    </section>
  );
}