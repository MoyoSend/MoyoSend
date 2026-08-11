import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { Picker } from "@react-native-picker/picker";
import { api, ApiError, type Bank } from "../api/client";

// Only Nigeria has automatic account-name verification wired up right now
// (via Flutterwave) — mirrors sende-web's RecipientForm.tsx exactly.
const VERIFICATION_SUPPORTED = new Set(["NG"]);

export default function AddRecipientScreen({ navigation }: any) {
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("NG");
  const [payoutMethod, setPayoutMethod] = useState<"BANK_TRANSFER" | "MOBILE_MONEY">("BANK_TRANSFER");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [networks, setNetworks] = useState<Bank[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [mobileNetwork, setMobileNetwork] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [stepUpRequired, setStepUpRequired] = useState(false);

  const [verifying, setVerifying] = useState(false);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const canAutoVerify = payoutMethod === "BANK_TRANSFER" && VERIFICATION_SUPPORTED.has(country.toUpperCase());

  // Refetch whenever the country or payout method changes, so the dropdown
  // always reflects what's actually supported for that specific combination
  // rather than showing stale options from a previous selection.
  useEffect(() => {
    if (country.length !== 2) return;
    let cancelled = false;
    setLoadingOptions(true);
    setBankCode("");
    setMobileNetwork("");
    setVerifiedName(null);
    setVerifyError(null);

    const request =
      payoutMethod === "BANK_TRANSFER"
        ? api.listBanks(country.toUpperCase())
        : api.listMobileNetworks(country.toUpperCase());

    request
      .then((res) => {
        if (cancelled) return;
        if (payoutMethod === "BANK_TRANSFER") {
          setBanks((res as { banks: Bank[] }).banks);
        } else {
          setNetworks((res as { networks: Bank[] }).networks);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBanks([]);
          setNetworks([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [country, payoutMethod]);

  // Mirrors sende-web's RecipientForm.tsx: re-check the account holder's
  // name whenever the bank or account number changes, debounced so we
  // don't hammer the API on every keystroke. NG only, since that's the
  // only country Flutterwave gives us real-time name verification for.
  useEffect(() => {
    setVerifiedName(null);
    setVerifyError(null);
    if (!canAutoVerify || !bankCode || accountNumber.length < 10) return;

    const timeout = setTimeout(async () => {
      setVerifying(true);
      try {
        const res = await api.resolveAccount(country.toUpperCase(), bankCode, accountNumber);
        setVerifiedName(res.accountName);
      } catch {
        setVerifyError("Couldn't verify this account — check the bank and account number.");
      } finally {
        setVerifying(false);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [bankCode, accountNumber, canAutoVerify, country]);

  // Nigerian banks confirm the real account holder's name for us — once
  // verified, trust it instead of making the sender retype it.
  useEffect(() => {
    if (canAutoVerify && verifiedName) {
      setFullName(verifiedName);
    }
  }, [verifiedName, canAutoVerify]);

  async function onSave() {
    setError(null);
    setSaving(true);
    try {
      await api.createRecipient({
        fullName,
        country: country.toUpperCase(),
        payoutMethod,
        bankCode: payoutMethod === "BANK_TRANSFER" ? bankCode : undefined,
        accountNumber: payoutMethod === "BANK_TRANSFER" ? accountNumber : undefined,
        mobileNetwork: payoutMethod === "MOBILE_MONEY" ? mobileNetwork : undefined,
        mobileNumber: payoutMethod === "MOBILE_MONEY" ? mobileNumber : undefined,
        mfaCode: mfaCode || undefined,
      });
      navigation.goBack();
    } catch (err) {
      if (err instanceof ApiError && err.message === "step_up_required") {
        setStepUpRequired(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't save this recipient — please check the details");
      }
    } finally {
      setSaving(false);
    }
  }

  const currentOptions = payoutMethod === "BANK_TRANSFER" ? banks : networks;
  const bankTransferBlocked =
    payoutMethod === "BANK_TRANSFER" && (!bankCode || (canAutoVerify && !verifiedName));
  const mobileMoneyBlocked = payoutMethod === "MOBILE_MONEY" && !mobileNetwork;
  const blockedByVerification = bankTransferBlocked || mobileMoneyBlocked;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.label}>Full name</Text>
      <TextInput
        style={[styles.input, canAutoVerify && verifiedName ? styles.inputLocked : null]}
        value={fullName}
        onChangeText={setFullName}
        placeholder="Jane Doe"
        editable={!(canAutoVerify && verifiedName)}
      />
      {canAutoVerify && verifiedName && (
        <Text style={styles.hint}>Filled in automatically from the verified bank account.</Text>
      )}

      <Text style={styles.label}>Country (2-letter code)</Text>
      <TextInput
        style={styles.input}
        value={country}
        onChangeText={setCountry}
        placeholder="NG"
        autoCapitalize="characters"
        maxLength={2}
      />

      <Text style={styles.label}>Payout method</Text>
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleButton, payoutMethod === "BANK_TRANSFER" && styles.toggleButtonActive]}
          onPress={() => setPayoutMethod("BANK_TRANSFER")}
        >
          <Text style={[styles.toggleText, payoutMethod === "BANK_TRANSFER" && styles.toggleTextActive]}>
            Bank transfer
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, payoutMethod === "MOBILE_MONEY" && styles.toggleButtonActive]}
          onPress={() => setPayoutMethod("MOBILE_MONEY")}
        >
          <Text style={[styles.toggleText, payoutMethod === "MOBILE_MONEY" && styles.toggleTextActive]}>
            Mobile money
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>{payoutMethod === "BANK_TRANSFER" ? "Bank" : "Mobile network"}</Text>
      {loadingOptions ? (
        <ActivityIndicator color="#0e9488" />
      ) : currentOptions.length === 0 ? (
        <Text style={styles.emptyText}>
          No {payoutMethod === "BANK_TRANSFER" ? "banks" : "mobile networks"} found for "{country}" — check the
          country code.
        </Text>
      ) : (
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={payoutMethod === "BANK_TRANSFER" ? bankCode : mobileNetwork}
            onValueChange={(value) =>
              payoutMethod === "BANK_TRANSFER" ? setBankCode(value) : setMobileNetwork(value)
            }
          >
            <Picker.Item label="Select..." value="" />
            {currentOptions.map((opt) => (
              <Picker.Item key={opt.code} label={opt.name} value={opt.code} />
            ))}
          </Picker>
        </View>
      )}

      {payoutMethod === "BANK_TRANSFER" ? (
        <>
          <Text style={styles.label}>Account number</Text>
          <TextInput
            style={styles.input}
            value={accountNumber}
            onChangeText={setAccountNumber}
            placeholder="0123456789"
            keyboardType="number-pad"
          />
          {canAutoVerify ? (
            <Text style={verifiedName ? styles.success : verifyError ? styles.error : styles.hint}>
              {verifying
                ? "Checking account…"
                : verifiedName
                ? `✓ This account belongs to: ${verifiedName}`
                : verifyError
                ? verifyError
                : "Enter the bank and account number to verify the account holder before saving."}
            </Text>
          ) : (
            <Text style={styles.hint}>
              Automatic account verification isn't available for this country yet — double-check the details
              carefully before saving.
            </Text>
          )}
        </>
      ) : (
        <>
          <Text style={styles.label}>Mobile number</Text>
          <TextInput
            style={styles.input}
            value={mobileNumber}
            onChangeText={setMobileNumber}
            placeholder="0241234567"
            keyboardType="phone-pad"
          />
          <Text style={styles.hint}>
            There's no automatic name verification for mobile money accounts yet — double-check the number
            carefully before saving.
          </Text>
        </>
      )}

      {stepUpRequired && (
        <>
          <Text style={styles.label}>6-digit authentication code</Text>
          <TextInput
            style={styles.input}
            value={mfaCode}
            onChangeText={setMfaCode}
            keyboardType="number-pad"
            maxLength={6}
          />
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.saveButton, blockedByVerification && styles.saveButtonDisabled]}
        onPress={onSave}
        disabled={saving || blockedByVerification}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save recipient</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f5ef" },
  label: { fontSize: 14, fontWeight: "600", color: "#101b3d", marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  pickerWrapper: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
  },
  toggleRow: { flexDirection: "row", gap: 8 },
  toggleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  toggleButtonActive: { backgroundColor: "#0e9488", borderColor: "#0e9488" },
  toggleText: { color: "#556", fontWeight: "600" },
  toggleTextActive: { color: "#fff" },
  saveButton: { backgroundColor: "#0e9488", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 24 },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  emptyText: { color: "#667", fontSize: 13 },
  inputLocked: { backgroundColor: "#f1efe7", color: "#556" },
  hint: { color: "#889", fontSize: 12, marginTop: 6 },
  success: { color: "#0e9488", fontSize: 13, marginTop: 6, fontWeight: "600" },
  error: { color: "#b3261e", fontSize: 13, marginTop: 12 },
});