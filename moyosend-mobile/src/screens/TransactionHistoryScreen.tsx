import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { api, type Transaction } from "../api/client";

export default function TransactionHistoryScreen({ navigation }: any) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      api
        .listTransactions()
        .then((res) => {
          if (!cancelled) setTransactions(res.transactions);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0e9488" />
      </View>
    );
  }

  if (transactions.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No transfers yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={transactions}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16 }}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate("TransactionDetail", { id: item.id })}
        >
          <View style={styles.row}>
            <Text style={styles.amount}>
              {(Number(item.sendAmount) / 100).toFixed(2)} {item.sendCurrency}
            </Text>
            <Text style={styles.status}>{item.status}</Text>
          </View>
          <Text style={styles.detail}>
            → {(Number(item.receiveAmount) / 100).toFixed(2)} {item.receiveCurrency}
          </Text>
          <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
        </TouchableOpacity>
      )}
    />
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
    marginBottom: 8,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  amount: { fontSize: 16, fontWeight: "700", color: "#101b3d" },
  status: {
    fontSize: 11,
    fontWeight: "600",
    color: "#0e9488",
    backgroundColor: "#e1f3ef",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  detail: { fontSize: 14, color: "#556", marginTop: 4 },
  date: { fontSize: 12, color: "#889", marginTop: 6 },
});