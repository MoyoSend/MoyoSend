import { FormEvent, useEffect, useState } from "react";
import { api, type AdminPromoCode } from "../api/client";

export default function PromoCodesPanel() {
  const [promoCodes, setPromoCodes] = useState<AdminPromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [bonusAmount, setBonusAmount] = useState("5.00");
  const [bonusCurrency, setBonusCurrency] = useState("GBP");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.adminListPromoCodes();
      setPromoCodes(res.promoCodes);
    } catch {
      setError("Couldn't load promo codes. Your account may not have admin access.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const bonusAmountMinor = String(Math.round(Number(bonusAmount) * 100));
      await api.adminCreatePromoCode({
        code,
        label,
        bonusAmountMinor,
        bonusCurrency: bonusCurrency.toUpperCase(),
        maxUses: maxUses ? Number(maxUses) : undefined,
        expiresAt: expiresAt || undefined,
      });
      setCode("");
      setLabel("");
      setMaxUses("");
      setExpiresAt("");
      await refresh();
    } catch {
      setError("Couldn't create that promo code — check the code isn't already taken.");
    } finally {
      setCreating(false);
    }
  }

  async function onToggle(id: string) {
    setError(null);
    try {
      await api.adminTogglePromoCode(id);
      await refresh();
    } catch {
      setError("Couldn't update that promo code.");
    }
  }

  return (
    <div>
      <p>
        Create codes for influencer/marketing campaigns — redeemable at signup just like a personal
        referral code, and paying out the same way once the new user completes their first transfer.
      </p>

      <form className="card-form" onSubmit={onCreate}>
        <label>
          Code
          <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. JANE10" />
        </label>
        <label>
          Label
          <input
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. influencer:jane_doe"
          />
        </label>
        <label>
          Bonus amount
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={bonusAmount}
            onChange={(e) => setBonusAmount(e.target.value)}
          />
        </label>
        <label>
          Bonus currency
          <input
            required
            value={bonusCurrency}
            onChange={(e) => setBonusCurrency(e.target.value.toUpperCase())}
            maxLength={3}
          />
        </label>
        <label>
          Max uses <span className="hint">(optional — blank means unlimited)</span>
          <input type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </label>
        <label>
          Expires <span className="hint">(optional)</span>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={creating}>
          {creating ? "Creating…" : "Create promo code"}
        </button>
      </form>

      {loading ? (
        <p className="muted">Loading promo codes…</p>
      ) : promoCodes.length === 0 ? (
        <p className="muted">No promo codes yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Bonus</th>
              <th>Uses</th>
              <th>Status</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {promoCodes.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.code}</td>
                <td>{p.label}</td>
                <td>
                  {(Number(p.bonusAmountMinor) / 100).toFixed(2)} {p.bonusCurrency}
                </td>
                <td>
                  {p.usedCount}
                  {p.maxUses !== null ? ` / ${p.maxUses}` : ""}
                </td>
                <td>
                  <span className={p.active ? "badge badge-ok" : "badge"}>{p.active ? "Active" : "Inactive"}</span>
                </td>
                <td>{p.expiresAt ? new Date(p.expiresAt).toLocaleDateString() : "—"}</td>
                <td>
                  <button onClick={() => onToggle(p.id)}>{p.active ? "Deactivate" : "Activate"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}