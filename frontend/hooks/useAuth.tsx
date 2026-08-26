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
  parseAuthRedirect,
  refreshSession,
  restoreAuth,
  type AuthSnapshot,
  type PreAuth,
  type Session,
} from '../services/auth';
import type { AppLanguage } from '../services/onboarding-contract';
import { deleteAccount as deleteAccountRemote, recoverWithPreAuth } from '../services/key-management';

type AuthStatus = 'loading' | 'signed_out' | 'pre_auth' | 'signed_in';

type AuthContextValue = AuthSnapshot & {
  status: AuthStatus;
  busy: boolean;
  error: string | null;
  getCurrentSession: () => Session | null;
  login: () => Promise<void>;
  continuePasskey: (language?: AppLanguage) => Promise<boolean>;
  recoverWithRecoveryKey: (recoveryKey: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  deleteAccount: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function message(error: unknown): string {
  if (!(error instanceof Error)) return '認証処理に失敗しました';
  if (error.message === '401: missing_or_invalid_access_token' || error.message === '401: invalid_pre_auth_token') {
    return '認証情報の有効期限が切れました。Google認証からやり直してください。';
  }
  if (error.message === '429: recovery_rate_limited') {
    return 'Recovery Keyの試行回数が多すぎます。しばらく待ってから再試行してください。';
  }
  if (error.message === '401: recovery_verification_failed' || error.message.includes('aes-gcm: invalid tag')) {
    return 'Recovery Keyが正しくありません。保存したRecovery Keyを確認してください。';
  }
  return error.message;
}

function isHttpAuthFailure(error: unknown): boolean {
  return /^4\d\d:/.test(message(error));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({ session: null, preAuth: null });
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const statusRef = useRef(status);
  const mountedRef = useRef(false);
  const handledRedirects = useRef(new Set<string>());
  const authInFlight = useRef<Promise<AuthSnapshot | null> | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  snapshotRef.current = snapshot;
  statusRef.current = status;

  const apply = useCallback((next: AuthSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setStatus(next.session ? 'signed_in' : next.preAuth ? 'pre_auth' : 'signed_out');
  }, []);

  const handleRedirect = useCallback((url: string) => {
    const redirect = parseAuthRedirect(url);
    if (!redirect.handoffCode && !redirect.sessionHandoffCode) return;
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

  const runAuth = useCallback((operation: () => Promise<AuthSnapshot | null>, rethrow = false): Promise<AuthSnapshot | null> => {
    if (authInFlight.current) return authInFlight.current;
    setError(null);
    setBusy(true);
    const pending = operation().then((next) => {
      if (next) apply(next);
      else apply(snapshotRef.current);
      return next;
    }).catch(async (reason) => {
      const current = snapshotRef.current;
      if (!current.session && isHttpAuthFailure(reason)) {
        await clearAuthStorage();
        setError(message(reason));
        apply({ session: null, preAuth: null });
      } else {
        setError(message(reason));
        apply(current);
      }
      if (rethrow) throw reason;
      return null;
    }).finally(() => {
      if (authInFlight.current === pending) authInFlight.current = null;
      setBusy(false);
    });
    authInFlight.current = pending;
    return pending;
  }, [apply]);

  const login = useCallback(async () => {
    await runAuth(beginGoogleLogin);
  }, [runAuth]);

  const continuePasskey = useCallback(async (language?: AppLanguage): Promise<boolean> => {
    const next = await runAuth(() => {
      const current = snapshotRef.current;
      return beginPasskey(current.preAuth, current.session, language);
    }, true);
    return next?.session !== null && next?.session !== undefined;
  }, [runAuth]);

  const getCurrentSession = useCallback(() => snapshotRef.current.session, []);

  const recoverWithRecoveryKey = useCallback(async (recoveryKey: string) => {
    if (authInFlight.current) {
      await authInFlight.current;
      return;
    }
    const current = snapshotRef.current;
    if (!current.preAuth) {
      setError('RecoveryにはGoogle認証が必要です');
      return;
    }
    setError(null);
    setBusy(true);
    const pending = recoverWithPreAuth(current.preAuth, recoveryKey).then((preAuth) => {
      const next = { session: null, preAuth };
      if (mountedRef.current) apply(next);
      return next;
    }).catch((reason) => {
      if (mountedRef.current) {
        setError(message(reason));
        apply(current);
      }
      return null;
    }).finally(() => {
      if (authInFlight.current === pending) authInFlight.current = null;
      setBusy(false);
    });
    authInFlight.current = pending;
    await pending;
  }, [apply]);

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

  const deleteAccount = useCallback(async (): Promise<boolean> => {
    const current = snapshotRef.current.session;
    if (!current) return false;
    setError(null);
    try {
      await deleteAccountRemote(current);
      await clearAuthStorage();
      apply({ session: null, preAuth: null });
      return true;
    } catch (reason) {
      setError(message(reason));
      return false;
    }
  }, [apply]);

  const value = useMemo<AuthContextValue>(() => ({
    ...snapshot,
    status,
    busy,
    error,
    getCurrentSession,
    login,
    continuePasskey,
    recoverWithRecoveryKey,
    refresh,
    logout,
    logoutAll,
    deleteAccount,
  }), [busy, continuePasskey, deleteAccount, error, getCurrentSession, login, logout, logoutAll, recoverWithRecoveryKey, refresh, snapshot, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export type { AuthStatus, PreAuth, Session };
