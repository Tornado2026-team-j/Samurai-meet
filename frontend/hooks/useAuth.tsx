import { AppState, type AppStateStatus } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import {
  beginGoogleLogin,
  beginPasskey,
  clearAuthStorage,
  completeAuthRedirect,
  logout as logoutSession,
  logoutAll as logoutEverywhere,
  refreshSession,
  restoreAuth,
  type AuthSnapshot,
  type PreAuth,
  type Session,
} from '../services/auth';

type AuthStatus = 'loading' | 'signed_out' | 'pre_auth' | 'signed_in';

type AuthContextValue = AuthSnapshot & {
  status: AuthStatus;
  error: string | null;
  login: () => Promise<void>;
  continuePasskey: () => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function message(error: unknown): string {
  return error instanceof Error ? error.message : '認証処理に失敗しました';
}

function isHttpAuthFailure(error: unknown): boolean {
  return /^4\d\d:/.test(message(error));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({ session: null, preAuth: null });
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const statusRef = useRef(status);
  const mountedRef = useRef(false);
  const handledRedirects = useRef(new Set<string>());
  const authInFlight = useRef<Promise<void> | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  snapshotRef.current = snapshot;
  statusRef.current = status;

  const apply = useCallback((next: AuthSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setStatus(next.session ? 'signed_in' : next.preAuth ? 'pre_auth' : 'signed_out');
  }, []);

  const handleRedirect = useCallback((url: string) => {
    if (handledRedirects.current.has(url)) return;
    handledRedirects.current.add(url);
    void completeAuthRedirect(url).then((next) => {
      if (mountedRef.current) {
        setError(null);
        apply(next);
      }
    }).catch((reason) => {
      handledRedirects.current.delete(url);
      if (mountedRef.current) setError(message(reason));
    });
  }, [apply]);

  useEffect(() => {
    mountedRef.current = true;
    void restoreAuth().then((next) => {
      if (mountedRef.current) apply(next);
    }).catch((reason) => {
      if (mountedRef.current) {
        setError(message(reason));
        apply({ session: null, preAuth: null });
      }
    });
    const subscription = Linking.addEventListener('url', ({ url }) => handleRedirect(url));
    void Linking.getInitialURL().then((url) => {
      if (url) handleRedirect(url);
    });
    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [apply, handleRedirect]);

  const runAuth = useCallback((operation: () => Promise<AuthSnapshot | null>): Promise<void> => {
    if (authInFlight.current) return authInFlight.current;
    setError(null);
    setStatus('loading');
    const pending = operation().then((next) => {
      if (next) apply(next);
      else apply(snapshotRef.current);
    }).catch(async (reason) => {
      const current = snapshotRef.current;
      if (!current.session && isHttpAuthFailure(reason)) {
        await clearAuthStorage();
        apply({ session: null, preAuth: null });
      } else {
        setError(message(reason));
        apply(current);
      }
    }).finally(() => {
      if (authInFlight.current === pending) authInFlight.current = null;
    });
    authInFlight.current = pending;
    return pending;
  }, [apply]);

  const login = useCallback(() => runAuth(beginGoogleLogin), [runAuth]);

  const continuePasskey = useCallback(() => runAuth(() => {
    const current = snapshotRef.current;
    return beginPasskey(current.preAuth, current.session);
  }), [runAuth]);

  const refresh = useCallback((): Promise<void> => {
    const current = snapshotRef.current.session;
    if (!current) return Promise.resolve();
    if (refreshInFlight.current) return refreshInFlight.current;
    setError(null);
    const pending = refreshSession(current).then((next) => {
      if (mountedRef.current) apply({ session: next, preAuth: null });
    }).catch(async (reason) => {
      if (!mountedRef.current) return;
      if (isHttpAuthFailure(reason)) {
        await clearAuthStorage();
        apply({ session: null, preAuth: null });
      } else {
        setError(message(reason));
      }
    }).finally(() => {
      if (refreshInFlight.current === pending) refreshInFlight.current = null;
    });
    refreshInFlight.current = pending;
    return pending;
  }, [apply]);

  useEffect(() => {
    const onStateChange = (next: AppStateStatus) => {
      if (next === 'active' && statusRef.current === 'signed_in') void refresh();
    };
    const subscription = AppState.addEventListener('change', onStateChange);
    return () => subscription.remove();
  }, [refresh]);

  const logout = useCallback(async () => {
    const current = snapshotRef.current.session;
    if (!current) return;
    setError(null);
    try {
      await logoutSession(current);
    } catch (reason) {
      setError(message(reason));
    } finally {
      apply({ session: null, preAuth: null });
    }
  }, [apply]);

  const logoutAll = useCallback(async () => {
    const current = snapshotRef.current.session;
    if (!current) return;
    setError(null);
    try {
      await logoutEverywhere(current);
    } catch (reason) {
      setError(message(reason));
    } finally {
      apply({ session: null, preAuth: null });
    }
  }, [apply]);

  const value = useMemo<AuthContextValue>(() => ({
    ...snapshot,
    status,
    error,
    login,
    continuePasskey,
    refresh,
    logout,
    logoutAll,
  }), [continuePasskey, error, login, logout, logoutAll, refresh, snapshot, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export type { AuthStatus, PreAuth, Session };
