import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getAccessToken, setAccessToken, type AuthResponse } from "../api/client";

interface AuthContextValue {
  user: AuthResponse["user"] | null;
  loading: boolean;
  login: (email: string, password: string, mfaCode?: string) => Promise<void>;
  signUp: (email: string, password: string, homeCountry: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthResponse["user"] | null>(null);
  const [loading, setLoading] = useState(true);

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
    await setAccessToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signUp, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}