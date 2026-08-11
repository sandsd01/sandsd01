import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, setOnUnauthorized } from "../api/client";

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  loginWithCode: (code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("chat_token"));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  function logout() {
    localStorage.removeItem("chat_token");
    setToken(null);
    setUser(null);
  }

  useEffect(() => {
    setOnUnauthorized(() => logout());
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .me()
      .then((u) => setUser(u as AuthUser))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [token]);

  async function loginWithCode(code: string) {
    const { token: newToken, user: newUser } = await api.googleCallback(code);
    localStorage.setItem("chat_token", newToken);
    setToken(newToken);
    setUser(newUser);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, loginWithCode, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
