import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { api, type Recipient } from "../api/client";

export default function RecipientsScreen({ navigation }: any) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);

  // useFocusEffect (not useEffect) so the list refreshes every time this
  // screen comes back into view — e.g. right after adding a new recipient.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      api
        .listRecipients()
        .then((res) => {
          if (!cancelled) setRecipients(res.recipients);
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

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("AddRecipient")}>
        <Text style={styles.addButtonText}>+ Add recipient</Text>
      </TouchableOpacity>

      {recipients.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No recipients yet</Text>
        </View>
      ) : (
        <FlatList
          data={recipients}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.name}>{item.fullName}</Text>
              <Text style={styles.detail}>
                {item.country} · {item.payoutMethod === "BANK_TRANSFER" ? "Bank transfer" : "Mobile money"}
              </Text>
              {item.verified && item.verifiedAccountName && (
                <Text style={styles.verified}>✓ Verified: {item.verifiedAccountName}</Text>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f5ef" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  addButton: {
    backgroundColor: "#0e9488",
    margin: 16,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  addButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  emptyText: { color: "#667", fontSize: 14 },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
  },
  name: { fontSize: 16, fontWeight: "700", color: "#101b3d" },
  detail: { fontSize: 13, color: "#667", marginTop: 2 },
  verified: { fontSize: 12, color: "#0e9488", marginTop: 6 },
});