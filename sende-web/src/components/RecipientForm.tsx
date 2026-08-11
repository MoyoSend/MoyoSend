import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, type Bank } from "../api/client";

const RECEIVE_COUNTRIES = [
  { code: "NG", label: "Nigeria" },
  { code: "GH", label: "Ghana" },
  { code: "GM", label: "Gambia" },
  { code: "SN", label: "Senegal" },
  { code: "KE", label: "Kenya" },
  { code: "UG", label: "Uganda" },
  { code: "TZ", label: "Tanzania" },
  { code: "ZM", label: "Zambia" },
  { code: "CM", label: "Cameroon" },
  { code: "CI", label: "Côte d'Ivoire" },
  { code: "SL", label: "Sierra Leone" },
  { code: "ZA", label: "South Africa" },
  { code: "IN", label: "India" },
  { code: "PK", label: "Pakistan" },
];

// Only Nigeria has automatic account-name verification wired up right now
// (via Flutterwave). Other countries fall back to manual entry until that
// coverage is added and tested.
const VERIFICATION_SUPPORTED = new Set(["NG"]);

export interface EditableRecipient {
  id: string;
  fullName: string;
  country: string;
  payoutMethod: "BANK_TRANSFER" | "MOBILE_MONEY";
  bankCode?: string | null;
  mobileNetwork?: string | null;
}

export default function RecipientForm({
  onCreated,
  recipient,
  onCancel,
}: {
  onCreated: () => void;
  recipient?: EditableRecipient | null;
  onCancel?: () => void;
}) {
  const isEditing = Boolean(recipient);

  const [fullName, setFullName] = useState(recipient?.fullName ?? "");
  const [country, setCountry] = useState(recipient?.country ?? "NG");
  const [payoutMethod, setPayoutMethod] = useState<"BANK_TRANSFER" | "MOBILE_MONEY">(
    recipient?.payoutMethod ?? "BANK_TRANSFER"
  );
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState(recipient?.bankCode ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [networks, setNetworks] = useState<Bank[]>([]);
  const [mobileNetwork, setMobileNetwork] = useState(recipient?.mobileNetwork ?? "");
  const [mobileNumber, setMobileNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [verifying, setVerifying] = useState(false);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const canAutoVerify = payoutMethod === "BANK_TRANSFER" && VERIFICATION_SUPPORTED.has(country);

  useEffect(() => {
    setBankCode(recipient?.bankCode ?? "");
    setBanks([]);
    setVerifiedName(null);
    setVerifyError(null);
    setMobileNetwork(recipient?.mobileNetwork ?? "");
    setNetworks([]);

    if (payoutMethod === "BANK_TRANSFER") {
      api
        .listBanks(country)
        .then((res) => setBanks(res.banks))
        .catch(() => setBanks([]));
    }
    if (payoutMethod === "MOBILE_MONEY") {
      api
        .listMobileNetworks(country)
        .then((res) => setNetworks(res.networks))
        .catch(() => setNetworks([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, payoutMethod]);

  // Re-check whenever the bank or account number changes, with a short
  // debounce so we don't call the API on every keystroke.
  useEffect(() => {
    setVerifiedName(null);
    setVerifyError(null);
    if (!canAutoVerify || !bankCode || accountNumber.length < 10) return;

    const timeout = setTimeout(async () => {
      setVerifying(true);
      try {
        const res = await api.resolveAccount(country, bankCode, accountNumber);
        setVerifiedName(res.accountName);
      } catch {
        setVerifyError("Couldn't verify this account — check the bank and account number.");
      } finally {
        setVerifying(false);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [bankCode, accountNumber, canAutoVerify, country]);

  useEffect(() => {
    if (canAutoVerify && verifiedName) {
      setFullName(verifiedName);
    }
  }, [verifiedName, canAutoVerify]);

  async function submitRecipient(mfaCode?: string) {
    setError(null);
    setSaving(true);
    try {
      if (isEditing && recipient) {
        await api.updateRecipient(
          recipient.id,
          {
            fullName,
            bankCode: payoutMethod === "BANK_TRANSFER" ? bankCode || undefined : undefined,
            accountNumber: payoutMethod === "BANK_TRANSFER" && accountNumber ? accountNumber : undefined,
            mobileNetwork: payoutMethod === "MOBILE_MONEY" ? mobileNetwork || undefined : undefined,
            mobileNumber: payoutMethod === "MOBILE_MONEY" && mobileNumber ? mobileNumber : undefined,
          },
          mfaCode
        );
      } else {
        await api.createRecipient(
          {
            fullName,
            country,
            payoutMethod,
            bankCode: payoutMethod === "BANK_TRANSFER" ? bankCode || undefined : undefined,
            accountNumber: payoutMethod === "BANK_TRANSFER" ? accountNumber : undefined,
            mobileNetwork: payoutMethod === "MOBILE_MONEY" ? mobileNetwork : undefined,
            mobileNumber: payoutMethod === "MOBILE_MONEY" ? mobileNumber : undefined,
          },
          mfaCode
        );
      }
      onCreated();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 401 &&
        (err.body as { error?: string } | undefined)?.error === "step_up_required"
      ) {
        setSaving(false);
        const code = window.prompt(
          `Enter your 6-digit authenticator code to confirm ${isEditing ? "these changes" : "adding this recipient"}:`
        );
        if (code) {
          await submitRecipient(code);
        } else {
          setError(`${isEditing ? "Saving changes" : "Adding a recipient"} requires a verification code.`);
        }
        return;
      }
      setError(`Couldn't save this recipient. Please check the details and try again.`);
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await submitRecipient();
  }

  const mobileMoneyUnavailable = payoutMethod === "MOBILE_MONEY" && networks.length === 0;
  const mobileMoneyBlocked = payoutMethod === "MOBILE_MONEY" && (mobileMoneyUnavailable || !mobileNetwork);
  const bankTransferUnavailable = payoutMethod === "BANK_TRANSFER" && banks.length === 0;
  const bankTransferBlocked =
    payoutMethod === "BANK_TRANSFER" &&
    (bankTransferUnavailable ||
      !bankCode ||
      (canAutoVerify && (isEditing ? accountNumber.length > 0 && !verifiedName : !verifiedName)));
  const blockedByVerification = bankTransferBlocked || mobileMoneyBlocked;

  return (
    <form className="card-form" onSubmit={onSubmit}>
      {isEditing && <p className="hint">Editing {payoutMethod === "BANK_TRANSFER" ? "bank transfer" : "mobile money"} details for this recipient.</p>}
      <label>
        Recipient full name
        <input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label>
        Country
        <select value={country} disabled={isEditing} onChange={(e) => setCountry(e.target.value)}>
          {RECEIVE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Payout method
        <select
          value={payoutMethod}
          disabled={isEditing}
          onChange={(e) => setPayoutMethod(e.target.value as "BANK_TRANSFER" | "MOBILE_MONEY")}
        >
          <option value="BANK_TRANSFER">Bank transfer</option>
          <option value="MOBILE_MONEY">Mobile money</option>
        </select>
      </label>

      {payoutMethod === "BANK_TRANSFER" ? (
        bankTransferUnavailable ? (
          <p className="error">
            We couldn't load a bank list for this country — try again shortly or use a different payout method.
          </p>
        ) : (
          <>
            <label>
              Bank
              <select required value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                <option value="">Select a bank…</option>
                {banks.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Account number
              <input
                required={!isEditing}
                placeholder={isEditing ? "Leave blank to keep the current account number" : ""}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
            </label>
            {canAutoVerify && (
              <p className={verifiedName ? "success" : verifyError ? "error" : "hint"}>
                {verifying
                  ? "Checking account…"
                  : verifiedName
                  ? `✓ This account belongs to: ${verifiedName}`
                  : verifyError
                  ? verifyError
                  : isEditing
                  ? "Enter a new account number to verify and update it, or leave blank to keep the current one."
                  : "Enter the bank and account number to verify the account holder before saving."}
              </p>
            )}
            {!canAutoVerify && (
              <p className="hint">
                Automatic account verification isn't available for this country yet — double-check the details
                carefully before saving.
              </p>
            )}
          </>
        )
      ) : mobileMoneyUnavailable ? (
        <p className="error">Mobile money payouts aren't available for this country yet — try bank transfer instead.</p>
      ) : (
        <>
          <label>
            Mobile money network
            <select required value={mobileNetwork} onChange={(e) => setMobileNetwork(e.target.value)}>
              <option value="">Select a network…</option>
              {networks.map((n) => (
                <option key={n.code} value={n.code}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mobile money number
            <input
              required={!isEditing}
              placeholder={
                isEditing
                  ? "Leave blank to keep the current number"
                  : "Include the country code, e.g. 233551234567 (no + or leading 0)"
              }
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
            />
          </label>
          <p className="hint">
            There's no automatic name verification for mobile money accounts yet — double-check the number
            carefully before saving.
          </p>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <div className="recipient-form-actions">
        {isEditing && onCancel && (
          <button type="button" className="link-button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={saving || blockedByVerification}>
          {saving ? "Saving…" : isEditing ? "Save changes" : "Save recipient"}
        </button>
      </div>
    </form>
  );
}