import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { api, type TransactionDetail } from "../api/client";

function money(minor: string, currency: string) {
  return `${(Number(minor) / 100).toFixed(2)} ${currency}`;
}

function buildReceiptHtml(tx: TransactionDetail) {
  const rows = tx.statusEvents
    .map(
      (e) =>
        `<tr><td>${new Date(e.createdAt).toLocaleString()}</td><td>${e.toStatus}</td><td>${e.reason ?? ""}</td></tr>`
    )
    .join("");

  return `
    <html>
      <body style="font-family: -apple-system, sans-serif; padding: 24px; color: #101b3d;">
        <h1 style="color: #0e9488;">MoyoSend receipt</h1>
        <p>Reference: ${tx.id}</p>
        <p>Date: ${new Date(tx.createdAt).toLocaleString()}</p>
        <p>Status: ${tx.status}</p>
        <hr />
        <h3>Recipient</h3>
        <p>${tx.recipient.fullName} — ${tx.recipient.country} (${tx.recipient.payoutMethod.replace("_", " ")})</p>
        <hr />
        <h3>Amount</h3>
        <p>Sent: ${money(tx.sendAmount, tx.sendCurrency)}</p>
        <p>Fee: ${money(tx.feeAmount, tx.sendCurrency)}</p>
        <p>Exchange rate: 1 ${tx.sendCurrency} = ${tx.fxRateLocked} ${tx.receiveCurrency}</p>
        <p>Recipient gets: ${money(tx.receiveAmount, tx.receiveCurrency)}</p>
        <hr />
        <h3>Status history</h3>
        <table style="width: 100%; border-collapse: collapse;">
          ${rows}
        </table>
      </body>
    </html>
  `;
}

export default function TransactionDetailScreen({ route }: any) {
  const { id } = route.params;
  const [transaction, setTransaction] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      api
        .getTransaction(id)
        .then((res) => {
          if (!cancelled) setTransaction(res.transaction);
        })
        .catch(() => {
          if (!cancelled) setError("Couldn't load this transaction.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [id])
  );

  async function onDownloadReceipt() {
    if (!transaction) return;
    setDownloading(true);
    try {
      const html = buildReceiptHtml(transaction);
      if (Platform.OS === "web") {
        await Print.printAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "MoyoSend receipt" });
      }
    } catch {
      setError("Couldn't generate the receipt — please try again.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0e9488" />
      </View>
    );
  }

  if (!transaction) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{error ?? "Transaction not found"}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.status}>{transaction.status}</Text>
        <Text style={styles.amount}>{money(transaction.sendAmount, transaction.sendCurrency)}</Text>
        <Text style={styles.detail}>
          → {money(transaction.receiveAmount, transaction.receiveCurrency)} to {transaction.recipient.fullName}
        </Text>
        <Text style={styles.date}>{new Date(transaction.createdAt).toLocaleString()}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recipient</Text>
        <Text style={styles.line}>{transaction.recipient.fullName}</Text>
        <Text style={styles.line}>
          {transaction.recipient.country} · {transaction.recipient.payoutMethod.replace("_", " ")}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Amount breakdown</Text>
        <Text style={styles.line}>Sent: {money(transaction.sendAmount, transaction.sendCurrency)}</Text>
        <Text style={styles.line}>Fee: {money(transaction.feeAmount, transaction.sendCurrency)}</Text>
        <Text style={styles.line}>
          Rate: 1 {transaction.sendCurrency} = {transaction.fxRateLocked} {transaction.receiveCurrency}
        </Text>
        <Text style={styles.line}>Recipient gets: {money(transaction.receiveAmount, transaction.receiveCurrency)}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reference</Text>
        <Text style={styles.line}>{transaction.id}</Text>
        {transaction.payoutReference && <Text style={styles.line}>Payout ref: {transaction.payoutReference}</Text>}
      </View>

      {transaction.failureReason && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Failure reason</Text>
          <Text style={styles.error}>{transaction.failureReason}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Status history</Text>
        {transaction.statusEvents.map((event) => (
          <View key={event.id} style={{ marginBottom: 8 }}>
            <Text style={styles.line}>
              {event.fromStatus ? `${event.fromStatus} → ` : ""}
              {event.toStatus}
            </Text>
            <Text style={styles.date}>{new Date(event.createdAt).toLocaleString()}</Text>
          </View>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.downloadButton} onPress={onDownloadReceipt} disabled={downloading}>
        {downloading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.downloadButtonText}>Download receipt</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f5ef" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#667", fontSize: 14 },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  status: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "600",
    color: "#0e9488",
    backgroundColor: "#e1f3ef",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 8,
  },
  amount: { fontSize: 22, fontWeight: "700", color: "#101b3d" },
  detail: { fontSize: 14, color: "#556", marginTop: 4 },
  date: { fontSize: 12, color: "#889", marginTop: 4 },
  section: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#101b3d", marginBottom: 8 },
  line: { fontSize: 14, color: "#334", marginBottom: 2 },
  error: { color: "#b3261e", fontSize: 13, marginTop: 8 },
  downloadButton: {
    backgroundColor: "#0e9488",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 32,
  },
  downloadButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});