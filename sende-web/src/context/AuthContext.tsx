import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { api, setAccessToken, type AuthResponse } from "../api/client";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — auto sign-out after this long with no activity
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;

interface AuthState {
  user: AuthResponse["user"] | null;
  newDeviceAlert: boolean;
  dismissNewDeviceAlert: () => void;
  signUp: (email: string, password: string, homeCountry: string, referralOrPromoCode?: string) => Promise<void>;
  completePhoneSignUp: (userId: string, code: string) => Promise<void>;
  login: (identifier: { email?: string; phone?: string }, password: string, mfaCode?: string) => Promise<void>;
  logout: () => void;
  updateUser: (patch: Partial<NonNullable<AuthResponse["user"]>>) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthResponse["user"] | null>(null);
  const [newDeviceAlert, setNewDeviceAlert] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyAuth = useCallback((res: AuthResponse) => {
    setAccessToken(res.accessToken);
    setUser(res.user);
    if (res.newDevice) setNewDeviceAlert(true);
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, homeCountry: string, referralOrPromoCode?: string) => {
      const res = await api.signUp(email, password, homeCountry, referralOrPromoCode);
      applyAuth(res);
    },
    [applyAuth]
  );

  const completePhoneSignUp = useCallback(
    async (userId: string, code: string) => {
      const res = await api.verifyPhoneSignUp(userId, code);
      applyAuth(res);
    },
    [applyAuth]
  );
  const login = useCallback(
    async (identifier: { email?: string; phone?: string }, password: string, mfaCode?: string) => {
      const res = await api.login(identifier, password, mfaCode);
      applyAuth(res);
    },
    [applyAuth]
  );

  const dismissNewDeviceAlert = useCallback(() => setNewDeviceAlert(false), []);
  const updateUser = useCallback((patch: Partial<NonNullable<AuthResponse["user"]>>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const logout = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    setAccessToken(null);
    setUser(null);
    setNewDeviceAlert(false);
  }, []);

  // Auto sign-out after a period of inactivity — a standard security
  // measure for a financial app, so a signed-in session left unattended
  // (e.g. a shared or unlocked device) doesn't stay open indefinitely.
  useEffect(() => {
    if (!user) return;

    function resetIdleTimer() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(logout, IDLE_TIMEOUT_MS);
    }

    resetIdleTimer();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetIdleTimer));

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetIdleTimer));
    };
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{ user, newDeviceAlert, dismissNewDeviceAlert, signUp, completePhoneSignUp, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
