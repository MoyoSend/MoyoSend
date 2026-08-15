import type { ReactNode } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StripeProvider } from "@stripe/stripe-react-native";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import ErrorBoundary from "./src/components/ErrorBoundary";
import LoginScreen from "./src/screens/LoginScreen";
import SignupScreen from "./src/screens/SignupScreen";
import SendMoneyScreen from "./src/screens/SendMoneyScreen";
import RecipientsScreen from "./src/screens/RecipientsScreen";
import AddRecipientScreen from "./src/screens/AddRecipientScreen";
import TransactionHistoryScreen from "./src/screens/TransactionHistoryScreen";
import TransactionDetailScreen from "./src/screens/TransactionDetailScreen";
import ManageCardsScreen from "./src/screens/ManageCardsScreen";
import { ActivityIndicator, View, TouchableOpacity, Text } from "react-native";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const RecipientsStack = createNativeStackNavigator();
const HistoryStack = createNativeStackNavigator();

function RecipientsStackNavigator() {
  return (
    <RecipientsStack.Navigator>
      <RecipientsStack.Screen name="RecipientsList" component={RecipientsScreen} options={{ title: "Recipients" }} />
      <RecipientsStack.Screen
        name="AddRecipient"
        component={AddRecipientScreen}
        options={{ title: "Add recipient" }}
      />
    </RecipientsStack.Navigator>
  );
}

function HistoryStackNavigator() {
  return (
    <HistoryStack.Navigator>
      <HistoryStack.Screen name="HistoryList" component={TransactionHistoryScreen} options={{ title: "History" }} />
      <HistoryStack.Screen
        name="TransactionDetail"
        component={TransactionDetailScreen}
        options={{ title: "Transaction" }}
      />
    </HistoryStack.Navigator>
  );
}

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <TouchableOpacity onPress={logout} style={{ marginRight: 16 }}>
      <Text style={{ color: "#0e9488", fontWeight: "600" }}>Log out</Text>
    </TouchableOpacity>
  );
}

function IdleActivityWrapper({ children }: { children: ReactNode }) {
  const { registerActivity } = useAuth();
  return (
    <View style={{ flex: 1 }} onTouchStart={registerActivity}>
      {children}
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerRight: () => <LogoutButton />,
        tabBarActiveTintColor: "#0e9488",
      }}
    >
      <Tab.Screen name="Send" component={SendMoneyScreen} options={{ title: "Send money" }} />
      <Tab.Screen name="Recipients" component={RecipientsStackNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="History" component={HistoryStackNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Cards" component={ManageCardsScreen} options={{ title: "Manage cards" }} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#0e9488" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <Stack.Screen name="Main" component={MainTabs} />
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY as string}>
        <AuthProvider>
          <IdleActivityWrapper>
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          </IdleActivityWrapper>
        </AuthProvider>
      </StripeProvider>
    </ErrorBoundary>
  );
}