import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Alert } from "react-native";
import { useStripe } from "@stripe/stripe-react-native";
import { api, type SavedCard } from "../api/client";

export default function ManageCardsScreen() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCards = useCallback(() => {
    setLoading(true);
    api
      .listPaymentMethods()
      .then(({ cards }) => setCards(cards))
      .catch(() => setError("Couldn't load your saved cards."))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCards();
    }, [loadCards])
  );

  async function onAddCard() {
    setError(null);
    setAdding(true);
    try {
      const { clientSecret } = await api.createSetupIntent();
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: "MoyoSend",
        setupIntentClientSecret: clientSecret,
      });
      if (initError) {
        setError(initError.message);
        return;
      }
      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== "Canceled") setError(presentError.message);
        return;
      }
      loadCards();
    } catch {
      setError("Couldn't save this card. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  function onRemoveCard(id: string) {
    Alert.alert("Remove card", "Remove this card from your account?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setRemovingId(id);
          try {
            await api.deletePaymentMethod(id);
            setCards((prev) => prev.filter((c) => c.id !== id));
          } catch {
            setError("Couldn't remove this card. Please try again.");
          } finally {
            setRemovingId(null);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0e9488" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={cards}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.emptyText}>No saved cards yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.cardRow}>
            <View>
              <Text style={styles.cardBrand}>
                {item.brand.toUpperCase()} •••• {item.last4}
              </Text>
              <Text style={styles.cardExpiry}>
                Expires {String(item.expMonth).padStart(2, "0")}/{item.expYear}
              </Text>
            </View>
            <TouchableOpacity onPress={() => onRemoveCard(item.id)} disabled={removingId === item.id}>
              {removingId === item.id ? (
                <ActivityIndicator color="#b3261e" />
              ) : (
                <Text style={styles.removeText}>Remove</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
        ListFooterComponent={
          <>
            {error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity style={styles.addButton} onPress={onAddCard} disabled={adding}>
              {adding ? <ActivityIndicator color="#fff" /> : <Text style={styles.addButtonText}>+ Add a card</Text>}
            </TouchableOpacity>
          </>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f5ef" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  cardRow: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardBrand: { fontSize: 15, fontWeight: "600", color: "#101b3d" },
  cardExpiry: { fontSize: 13, color: "#667", marginTop: 2 },
  removeText: { color: "#b3261e", fontWeight: "600" },
  addButton: { backgroundColor: "#0e9488", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 16 },
  addButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  emptyText: { color: "#667", fontSize: 14, textAlign: "center", marginTop: 40 },
  error: { color: "#b3261e", fontSize: 13, marginTop: 12, textAlign: "center" },
});