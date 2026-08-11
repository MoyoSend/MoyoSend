import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { api, setAccessToken, type AuthResponse } from "../api/client";

interface AuthState {
  user: AuthResponse["user"] | null;
  newDeviceAlert: boolean;
  dismissNewDeviceAlert: () => void;
  signUp: (email: string, password: string, homeCountry: string, referralOrPromoCode?: string) => Promise<void>;
  login: (email: string, password: string, mfaCode?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthResponse["user"] | null>(null);
  const [newDeviceAlert, setNewDeviceAlert] = useState(false);

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

  const login = useCallback(
    async (email: string, password: string, mfaCode?: string) => {
      const res = await api.login(email, password, mfaCode);
      applyAuth(res);
    },
    [applyAuth]
  );

  const dismissNewDeviceAlert = useCallback(() => setNewDeviceAlert(false), []);

  const logout = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setNewDeviceAlert(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, newDeviceAlert, dismissNewDeviceAlert, signUp, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
