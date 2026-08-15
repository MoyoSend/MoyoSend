import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { useStripe } from "@stripe/stripe-react-native";
import { api, newIdempotencyKey, ApiError, type Recipient, type Corridor, type Quote, type SavedCard } from "../api/client";

export default function SendMoneyScreen() {
  const { initPaymentSheet, presentPaymentSheet, handleNextAction } = useStripe();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [selectedCorridorId, setSelectedCorridorId] = useState<string | null>(null);
  const [amount, setAmount] = useState("50");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"success" | "hold" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [stepUpRequired, setStepUpRequired] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<{ paymentIntentId: string; idempotencyKey: string } | null>(
    null
  );
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>("new");
  const [savePaymentMethod, setSavePaymentMethod] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([api.listRecipients(), api.listCorridors()])
        .then(([r, c]) => {
          if (cancelled) return;
          setRecipients(r.recipients);
          setCorridors(c.corridors);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      api
        .listPaymentMethods()
        .then(({ cards }) => {
          if (!cancelled) setSavedCards(cards);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const selectedRecipient = recipients.find((r) => r.id === selectedRecipientId) ?? null;

  const matchingCorridors = useMemo(() => {
    if (!selectedRecipient) return [];
    return corridors.filter(
      (c) => c.receiveCountry === selectedRecipient.country && c.payoutMethods.includes(selectedRecipient.payoutMethod)
    );
  }, [corridors, selectedRecipient]);

  const selectedCorridor = matchingCorridors.find((c) => c.id === selectedCorridorId) ?? matchingCorridors[0] ?? null;

  function selectRecipient(id: string) {
    setSelectedRecipientId(id);
    setSelectedCorridorId(null);
    setQuote(null);
    setResult(null);
    setError(null);
    setStepUpRequired(false);
    setMfaCode("");
    setPendingPayment(null);
  }

  async function onGetQuote() {
    if (!selectedCorridor) return;
    setError(null);
    setQuoting(true);
    setQuote(null);
    try {
      const q = await api.getQuote(selectedCorridor.sendCurrency, selectedCorridor.receiveCurrency, selectedCorridor.id);
      setQuote(q);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't fetch a live rate — please try again");
    } finally {
      setQuoting(false);
    }
  }

  async function onSend() {
    if (!selectedRecipient || !selectedCorridor) return;
    setError(null);
    setSending(true);
    try {
      const sendAmountMinor = String(Math.round(Number(amount) * 100));

      let paymentIntentId: string;
      let idempotencyKey: string;

      if (pendingPayment) {
        // The card was already charged on a previous attempt (step-up was
        // required) — reuse that same payment instead of charging again.
        paymentIntentId = pendingPayment.paymentIntentId;
        idempotencyKey = pendingPayment.idempotencyKey;
      } else {
        idempotencyKey = newIdempotencyKey();

        if (selectedCardId !== "new") {
          // Charging a saved card — the backend confirms it immediately, so
          // there's no card entry UI to show. We only need to step in if the
          // issuing bank demands 3D Secure authentication.
          const created = await api.createPaymentIntent(
            sendAmountMinor,
            selectedCorridor.sendCurrency,
            idempotencyKey,
            { paymentMethodId: selectedCardId }
          );

          if (created.status === "requires_action") {
            const { error: actionError } = await handleNextAction(created.clientSecret);
            if (actionError) {
              setError(actionError.message ?? "This card couldn't be verified. Please try a different card.");
              return;
            }
          } else if (created.status !== "succeeded") {
            setError("This card was declined. Please try a different card.");
            return;
          }

          paymentIntentId = created.paymentIntentId;
        } else {
          // Collect a new card via Stripe's own native UI (Payment Sheet),
          // matching the web flow's Stripe Elements step.
          const created = await api.createPaymentIntent(
            sendAmountMinor,
            selectedCorridor.sendCurrency,
            idempotencyKey,
            { savePaymentMethod }
          );

          const { error: initError } = await initPaymentSheet({
            merchantDisplayName: "MoyoSend",
            paymentIntentClientSecret: created.clientSecret,
          });
          if (initError) {
            setError(initError.message);
            return;
          }

          const { error: presentError } = await presentPaymentSheet();
          if (presentError) {
            // A user-cancelled sheet isn't a real error — don't show a scary message for it.
            if (presentError.code !== "Canceled") {
              setError(presentError.message);
            }
            return;
          }

          paymentIntentId = created.paymentIntentId;
        }

        setPendingPayment({ paymentIntentId, idempotencyKey });
      }

      await api.createTransaction(
        { recipientId: selectedRecipient.id, corridorId: selectedCorridor.id, sendAmountMinor, paymentIntentId },
        idempotencyKey,
        mfaCode || undefined
      );
      setResult("success");
      setPendingPayment(null);
    } catch (err) {
      if (err instanceof ApiError && err.message === "step_up_required") {
        setStepUpRequired(true);
      } else if (err instanceof ApiError && err.status === 202) {
        setResult("hold");
        setPendingPayment(null);
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't send this transfer — please try again");
      }
    } finally {
      setSending(false);
    }
  }

  function resetForm() {
    setResult(null);
    setSelectedRecipientId(null);
    setSelectedCorridorId(null);
    setQuote(null);
    setAmount("50");
    setStepUpRequired(false);
    setMfaCode("");
    setPendingPayment(null);
    setSelectedCardId("new");
    setSavePaymentMethod(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0e9488" />
      </View>
    );
  }

  if (recipients.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Add a recipient first before sending money.</Text>
      </View>
    );
  }

  if (result) {
    return (
      <View style={styles.center}>
        {result === "success" && <Text style={styles.success}>Transfer sent! Check History for status updates.</Text>}
        {result === "hold" && (
          <Text style={styles.warn}>This transfer needs a quick manual review before it can proceed.</Text>
        )}
        <TouchableOpacity style={styles.sendButton} onPress={resetForm}>
          <Text style={styles.sendButtonText}>Send another transfer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.label}>Send to</Text>
      {recipients.map((r) => (
        <TouchableOpacity
          key={r.id}
          style={[styles.recipientRow, selectedRecipientId === r.id && styles.recipientRowActive]}
          onPress={() => selectRecipient(r.id)}
        >
          <Text style={styles.recipientName}>{r.fullName}</Text>
          <Text style={styles.recipientDetail}>{r.country}</Text>
        </TouchableOpacity>
      ))}

      {selectedRecipient && (
        <>
          <Text style={styles.label}>Send from</Text>
          {matchingCorridors.length === 0 ? (
            <Text style={styles.emptyText}>No send currency is configured for {selectedRecipient.country} yet.</Text>
          ) : (
            matchingCorridors.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.recipientRow, selectedCorridor?.id === c.id && styles.recipientRowActive]}
                onPress={() => {
                  setSelectedCorridorId(c.id);
                  setQuote(null);
                }}
              >
                <Text style={styles.recipientName}>{c.sendCurrency}</Text>
                <Text style={styles.recipientDetail}>→ {c.receiveCurrency}</Text>
              </TouchableOpacity>
            ))
          )}
        </>
      )}

      {selectedCorridor && (
        <>
          <Text style={styles.label}>You send ({selectedCorridor.sendCurrency})</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={(v) => {
              setAmount(v);
              setQuote(null);
            }}
            keyboardType="decimal-pad"
          />

          <TouchableOpacity style={styles.quoteButton} onPress={onGetQuote} disabled={quoting}>
            {quoting ? <ActivityIndicator color="#0e9488" /> : <Text style={styles.quoteButtonText}>Get live rate</Text>}
          </TouchableOpacity>

          {quote && (
            <View style={styles.quoteBox}>
              <Text style={styles.quoteText}>
                Rate: 1 {selectedCorridor.sendCurrency} = {quote.appliedRate.toFixed(4)} {selectedCorridor.receiveCurrency}
              </Text>
              <Text style={styles.quoteText}>
                Recipient gets ≈ {(Number(amount) * quote.appliedRate).toFixed(2)} {selectedCorridor.receiveCurrency}
              </Text>
            </View>
          )}

          {quote && !pendingPayment && (
            <>
              <Text style={styles.label}>Pay with</Text>
              {savedCards.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.recipientRow, selectedCardId === c.id && styles.recipientRowActive]}
                  onPress={() => setSelectedCardId(c.id)}
                >
                  <Text style={styles.recipientName}>
                    {c.brand.toUpperCase()} •••• {c.last4}
                  </Text>
                  <Text style={styles.recipientDetail}>
                    exp {String(c.expMonth).padStart(2, "0")}/{c.expYear}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.recipientRow, selectedCardId === "new" && styles.recipientRowActive]}
                onPress={() => setSelectedCardId("new")}
              >
                <Text style={styles.recipientName}>Use a new card</Text>
              </TouchableOpacity>

              {selectedCardId === "new" && (
                <TouchableOpacity style={styles.saveCardRow} onPress={() => setSavePaymentMethod((v) => !v)}>
                  <View style={[styles.checkbox, savePaymentMethod && styles.checkboxChecked]} />
                  <Text style={styles.recipientDetail}>Save this card for future use</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {stepUpRequired && (
            <>
              <Text style={styles.label}>6-digit authentication code</Text>
              {pendingPayment && (
                <Text style={styles.quoteText}>
                  Payment received — enter your current authenticator code to finish.
                </Text>
              )}
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

          <TouchableOpacity style={styles.sendButton} onPress={onSend} disabled={!quote || sending}>
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.sendButtonText}>{pendingPayment ? "Verify & send" : "Confirm & send"}</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f5ef" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  label: { fontSize: 14, fontWeight: "600", color: "#101b3d", marginBottom: 8, marginTop: 16 },
  recipientRow: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  recipientRowActive: { borderColor: "#0e9488", borderWidth: 2 },
  recipientName: { fontSize: 15, fontWeight: "600", color: "#101b3d" },
  recipientDetail: { fontSize: 13, color: "#667" },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  quoteButton: {
    borderWidth: 1,
    borderColor: "#0e9488",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginTop: 12,
  },
  quoteButtonText: { color: "#0e9488", fontWeight: "600" },
  quoteBox: {
    backgroundColor: "#f8f5ef",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderStyle: "dashed",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  quoteText: { fontSize: 14, color: "#101b3d", marginBottom: 4 },
  sendButton: { backgroundColor: "#0e9488", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 16 },
  sendButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  emptyText: { color: "#667", fontSize: 14, textAlign: "center" },
  saveCardRow: { flexDirection: "row", alignItems: "center", marginTop: 8, marginBottom: 4 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#0e9488",
    marginRight: 8,
  },
  checkboxChecked: { backgroundColor: "#0e9488" },
  error: { color: "#b3261e", fontSize: 13, marginTop: 12 },
  success: { color: "#0e9488", fontSize: 16, textAlign: "center", marginBottom: 16 },
  warn: { color: "#b45309", fontSize: 16, textAlign: "center", marginBottom: 16 },
});