import { AppState, type AppStateStatus } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  restoreAuth,
  refreshSession,
  logout as logoutSession,
  clearAuthStorage,
  subscribeSessionChanges,
  type Session,
} from "../services/auth";

type AuthStatus = "loading" | "signed_out" | "signed_in";

type AuthContextValue = {
  session: Session | null;
  status: AuthStatus;
  busy: boolean;
  error: string | null;
  getCurrentSession: () => Session | null;
  login: () => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  const statusRef = useRef(status);
  const mountedRef = useRef(false);

  sessionRef.current = session;
  statusRef.current = status;

  const apply = useCallback((next: { session: Session | null }) => {
    setSession(next.session);
    setStatus(next.session ? "signed_in" : "signed_out");
  }, []);

  useEffect(() => {
    return subscribeSessionChanges((next) => {
      if (mountedRef.current) {
        setSession(next);
        setStatus(next ? "signed_in" : "signed_out");
      }
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void restoreAuth().then((result) => {
      if (mountedRef.current) apply(result);
    });
    return () => {
      mountedRef.current = false;
    };
  }, [apply]);

  const getCurrentSession = useCallback(() => sessionRef.current ?? session, [session]);

  const login = useCallback(async () => {
    // TODO: Google OAuth login flow
  }, []);

  const refresh = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      const next = await refreshSession(current);
      if (mountedRef.current) setSession(next);
    } catch {
      if (mountedRef.current) {
        await clearAuthStorage();
        setSession(null);
        setStatus("signed_out");
      }
    }
  }, []);

  const logout = useCallback(async () => {
    const current = sessionRef.current;
    if (current) {
      try {
        await logoutSession();
      } catch {
        // best effort
      }
    }
    await clearAuthStorage();
    setSession(null);
    setStatus("signed_out");
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    status,
    busy,
    error,
    getCurrentSession,
    login,
    refresh,
    logout,
  }), [busy, error, getCurrentSession, login, logout, refresh, session, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export type { AuthStatus, Session };
