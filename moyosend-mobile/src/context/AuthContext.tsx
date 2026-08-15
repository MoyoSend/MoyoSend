import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { api, getAccessToken, setAccessToken, type AuthResponse } from "../api/client";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — auto sign-out after this long with no activity

interface AuthContextValue {
  user: AuthResponse["user"] | null;
  loading: boolean;
  login: (email: string, password: string, mfaCode?: string) => Promise<void>;
  signUp: (email: string, password: string, homeCountry: string) => Promise<void>;
  logout: () => Promise<void>;
  registerActivity: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthResponse["user"] | null>(null);
  const [loading, setLoading] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    // MVP note: we only check whether a token exists, not whether it's
    // still valid — there's no /auth/me endpoint call or refresh flow yet.
    // An expired token will surface as 401s on the first real request; for
    // now that just means the user has to log in again. Fine for a first
    // testable version, worth revisiting before this goes further.
    getAccessToken().then(() => setLoading(false));
  }, []);

  async function login(email: string, password: string, mfaCode?: string) {
    const res = await api.login(email, password, mfaCode);
    await setAccessToken(res.accessToken);
    setUser(res.user);
  }

  async function signUp(email: string, password: string, homeCountry: string) {
    const res = await api.signUp(email, password, homeCountry);
    await setAccessToken(res.accessToken);
    setUser(res.user);
  }

  async function logout() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    await setAccessToken(null);
    setUser(null);
  }

  function registerActivity() {
    if (!user) return;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      logout();
    }, IDLE_TIMEOUT_MS);
  }

  // Auto sign-out after a period of inactivity — a standard security
  // measure for a financial app. Two signals feed this: any touch
  // anywhere in the app (see App.tsx's touch wrapper, which calls
  // registerActivity) resets the timer while the app is open, and
  // backgrounding the app (switching away / locking the phone) for
  // longer than the timeout also forces a sign-out on return.
  useEffect(() => {
    if (!user) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }
    registerActivity();

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "background" || nextState === "inactive") {
        backgroundedAtRef.current = Date.now();
      } else if (nextState === "active") {
        const backgroundedAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (backgroundedAt && Date.now() - backgroundedAt >= IDLE_TIMEOUT_MS) {
          logout();
        } else {
          registerActivity();
        }
      }
    });

    return () => {
      subscription.remove();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, signUp, logout, registerActivity }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}