import { Component, type ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Catches render-time crashes anywhere below it in the tree and shows a
// recoverable screen instead of a blank white page. Without this, a single
// bad component (like the Picker crash we hit during development) takes
// down the entire app with no way back except a full reload.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <TouchableOpacity style={styles.button} onPress={() => this.setState({ error: null })}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#f8f5ef" },
  title: { fontSize: 18, fontWeight: "700", color: "#101b3d", marginBottom: 8 },
  message: { fontSize: 14, color: "#667", textAlign: "center", marginBottom: 20 },
  button: { backgroundColor: "#0e9488", borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12 },
  buttonText: { color: "#fff", fontWeight: "600" },
});