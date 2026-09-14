"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { CurrentUser } from "@top/types";
import { api } from "./api-client";

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { organizationName: string; fullName: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .restoreSession()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await api.login({ email, password });
    setUser(u);
  }, []);

  const register = useCallback(
    async (input: { organizationName: string; fullName: string; email: string; password: string }) => {
      const u = await api.register(input);
      setUser(u);
    },
    []
  );

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await api.me();
    setUser(u);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used within <AuthProvider>");
  return ctx;
}
