import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import {
  buildPasskeyURL,
  encodeBase64URL,
  isPasskeyBootstrap,
  isPreAuth,
  isSession,
  isStoredSession,
  parseAuthRedirect as parseAuthRedirectContract,
  storedSession,
  type AuthRedirect,
  type PasskeyBootstrap,
  type PreAuth,
  type Session,
  type StoredSession,
} from './auth-contract';
import { API_BASE_URL, WEB_APP_ORIGIN, WEB_PASSKEY_URL } from './api-config';
import { completeWebPasskey, reauthWebPasskey } from './passkey-web';
import type { AppLanguage } from './onboarding-contract';

export { buildPasskeyURL, encodeBase64URL, isPasskeyBootstrap, isPreAuth, isStoredSession, storedSession } from './auth-contract';
export { API_BASE_URL, WEB_APP_ORIGIN, WEB_PASSKEY_URL } from './api-config';
export type { AuthRedirect, PasskeyBootstrap, PreAuth, Session, StoredSession } from './auth-contract';

WebBrowser.maybeCompleteAuthSession();

const SESSION_KEY = 'samurai_meet_session_v1';
const PRE_AUTH_KEY = 'samurai_meet_pre_auth_v1';
const OAUTH_VERIFIER_KEY = 'samurai_meet_oauth_verifier_v1';
const SESSION_HANDOFF_VERIFIER_KEY = 'samurai_meet_session_handoff_verifier_v1';
const SESSION_HANDOFF_REQUEST_KEY = 'samurai_meet_session_handoff_request_v1';
const REFRESH_REQUEST_KEY = 'samurai_meet_refresh_request_v1';
const RECOVERY_VERIFIED_USER_KEY = 'samurai_meet_recovery_verified_user_v1';
const AUTH_REQUEST_TIMEOUT_MS = 15_000;

const sessionRefreshes = new Map<string, Promise<Session>>();
const sessionListeners = new Set<(session: Session | null) => void>();

type SessionResponse = { data?: Session };
type OAuthResponse = { data?: Session | PreAuth };

export type AuthSnapshot = {
  session: Session | null;
  preAuth: PreAuth | null;
  /** Presentation-only state: the Recovery Key was verified for this pre-auth user. */
  recoveryVerified?: boolean;
};

/**
 * Lets API consumers keep their in-memory session aligned when a request
 * refreshes the rotating refresh token outside AuthProvider.
 */
export function subscribeSessionChanges(listener: (session: Session | null) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function notifySessionChanges(session: Session | null): void {
  for (const listener of sessionListeners) listener(session);
}

async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStoredItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timeoutID = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  const externalSignal = init.signal;
  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let body: T | { error?: string } | null = null;
    try {
      body = text ? (JSON.parse(text) as T | { error?: string }) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
      throw new Error(`${response.status}: ${error ?? 'request failed'}`);
    }
    return body as T;
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'AbortError' && !externalSignal?.aborted) {
      throw new Error('通信がタイムアウトしました。接続を確認して再試行してください。');
    }
    throw reason;
  } finally {
    clearTimeout(timeoutID);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

async function persistSession(value: Session): Promise<void> {
  await setStoredItem(SESSION_KEY, JSON.stringify(storedSession(value)));
  await deleteStoredItem(PRE_AUTH_KEY);
  await deleteStoredItem(RECOVERY_VERIFIED_USER_KEY);
  notifySessionChanges(value);
}

/**
 * Persists the current one-time pre-auth capability before the UI advances.
 * Recovery replaces the consumed Google pre-auth with a new registration
 * pre-auth, so this must also be callable by the Recovery service before a
 * Fast Refresh or process death can discard the only copy.
 */
export async function persistPreAuth(value: PreAuth): Promise<void> {
  await setStoredItem(PRE_AUTH_KEY, JSON.stringify(value));
  await deleteStoredItem(SESSION_KEY);
  await deleteStoredItem(RECOVERY_VERIFIED_USER_KEY);
}

async function isStoredSessionCurrent(value: StoredSession): Promise<boolean> {
  const stored = await getStoredItem(SESSION_KEY);
  if (!stored) return false;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isStoredSession(parsed)
      && parsed.user_id === value.user_id
      && parsed.session_id === value.session_id
      && parsed.refresh_token === value.refresh_token;
  } catch {
    return false;
  }
}

export async function markRecoveryVerified(userID: string): Promise<void> {
  await setStoredItem(RECOVERY_VERIFIED_USER_KEY, userID);
}

export async function clearAuthStorage(): Promise<void> {
  await Promise.all([
    deleteStoredItem(SESSION_KEY),
    deleteStoredItem(PRE_AUTH_KEY),
    deleteStoredItem(OAUTH_VERIFIER_KEY),
    deleteStoredItem(SESSION_HANDOFF_VERIFIER_KEY),
    deleteStoredItem(SESSION_HANDOFF_REQUEST_KEY),
    deleteStoredItem(REFRESH_REQUEST_KEY),
    deleteStoredItem(RECOVERY_VERIFIED_USER_KEY),
  ]);
  notifySessionChanges(null);
}

async function refreshStoredSession(value: StoredSession): Promise<Session> {
  const requestID = (await getStoredItem(REFRESH_REQUEST_KEY)) ?? Crypto.randomUUID();
  await setStoredItem(REFRESH_REQUEST_KEY, requestID);
  const response = await request<SessionResponse>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: value.refresh_token, request_id: requestID }),
  });
  if (!response.data || !isSession(response.data)) throw new Error('refresh response is invalid');
  if (!(await isStoredSessionCurrent(value))) {
    throw new Error('session storage is no longer current');
  }
  // 新Refresh Tokenを先に保存し、保存失敗時は同じrequest_idで再送できるようにする。
  await persistSession(response.data);
  await deleteStoredItem(REFRESH_REQUEST_KEY);
  return response.data;
}

function shouldClearStoredSession(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  if (!(error instanceof Error)) return false;
  return /^4\d\d:/.test(error.message)
    || error.message === 'refresh response is empty'
    || error.message === 'refresh response is invalid';
}

export async function restoreAuth(): Promise<AuthSnapshot> {
  const [stored, preAuthValue, recoveryVerifiedUserID] = await Promise.all([
    getStoredItem(SESSION_KEY),
    getStoredItem(PRE_AUTH_KEY),
    getStoredItem(RECOVERY_VERIFIED_USER_KEY),
  ]);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (!isStoredSession(parsed)) throw new SyntaxError('stored session shape is invalid');
      const session = await refreshStoredSession(parsed);
      return { session, preAuth: null };
    } catch (reason) {
      // HTTPの認証失敗や破損値だけを消去し、通信結果不明時はrequest_idを残して再試行できるようにする。
      if (shouldClearStoredSession(reason)) await clearAuthStorage();
      else throw reason;
    }
  }
  if (preAuthValue && !stored) {
    try {
      const parsed: unknown = JSON.parse(preAuthValue);
      if (!isPreAuth(parsed)) throw new SyntaxError('pre-auth shape is invalid');
      return {
        session: null,
        preAuth: parsed,
        recoveryVerified: recoveryVerifiedUserID === parsed.user_id,
      };
    } catch {
      await clearAuthStorage();
    }
  }
  return { session: null, preAuth: null };
}

export async function refreshSession(session: Session): Promise<Session> {
  const refreshKey = `${session.user_id}:${session.session_id}`;
  const existing = sessionRefreshes.get(refreshKey);
  if (existing) {
    const next = await existing;
    Object.assign(session, next);
    return next;
  }

  let source: StoredSession | null = null;
  const pending = (async () => {
    try {
      // A passkey handoff or another API request may have persisted a newer
      // rotating refresh token while this caller still holds the old object.
      // Prefer the latest same-account value from Secure Storage.
      const storedValue = await getStoredItem(SESSION_KEY);
      if (!storedValue) throw new Error('session storage is missing');
      const parsed: unknown = JSON.parse(storedValue);
      if (!isStoredSession(parsed) || parsed.user_id !== session.user_id) {
        throw new Error('session storage is no longer current');
      }
      source = parsed;
      const next = await refreshStoredSession(parsed);
      Object.assign(session, next);
      return next;
    } catch (reason) {
      if (reason instanceof Error
        && (/^401:|^409:/u).test(reason.message)
        && source
        && await isStoredSessionCurrent(source)) {
        await clearAuthStorage();
      }
      throw reason;
    }
  })();
  sessionRefreshes.set(refreshKey, pending);
  void pending.then(
    () => {
      if (sessionRefreshes.get(refreshKey) === pending) sessionRefreshes.delete(refreshKey);
    },
    () => {
      if (sessionRefreshes.get(refreshKey) === pending) sessionRefreshes.delete(refreshKey);
    },
  );
  return pending;
}

export function createVerifier(): string {
  return `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
}

function authRedirectURI(): string {
  if (Platform.OS === 'web') {
    const origin = typeof globalThis.location === 'undefined' ? WEB_APP_ORIGIN : globalThis.location.origin;
    return `${origin}/auth/complete`;
  }
  return Linking.createURL('auth');
}

export function parseAuthRedirect(value: string): AuthRedirect {
  const webOrigin = Platform.OS === 'web' && typeof globalThis.location !== 'undefined'
    ? globalThis.location.origin
    : undefined;
  return parseAuthRedirectContract(value, webOrigin);
}

export async function beginGoogleLogin(): Promise<AuthSnapshot | null> {
  const verifier = createVerifier();
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const challenge = encodeBase64URL(digest);
  const redirectURI = authRedirectURI();
  await setStoredItem(OAUTH_VERIFIER_KEY, verifier);
  const startURL = `${API_BASE_URL}/auth/google/start?app_redirect_uri=${encodeURIComponent(redirectURI)}&handoff_challenge=${encodeURIComponent(challenge)}`;
  if (Platform.OS === 'web' && typeof globalThis.location !== 'undefined') {
    globalThis.location.assign(startURL);
    return null;
  }
  const result = await WebBrowser.openAuthSessionAsync(startURL, redirectURI);
  if (result.type !== 'success') return null;
  return completeAuthRedirect(result.url);
}

async function completeAuthRedirectInternal(redirect: AuthRedirect): Promise<AuthSnapshot> {
  const oauthVerifier = await getStoredItem(OAUTH_VERIFIER_KEY);
  const sessionHandoffVerifier = await getStoredItem(SESSION_HANDOFF_VERIFIER_KEY);

  if (redirect.sessionHandoffCode) {
    if (!sessionHandoffVerifier) throw new Error('session handoff verifier is missing');
    const sessionHandoffRequestID = (await getStoredItem(SESSION_HANDOFF_REQUEST_KEY)) ?? Crypto.randomUUID();
    await setStoredItem(SESSION_HANDOFF_REQUEST_KEY, sessionHandoffRequestID);
    const response = await request<SessionResponse>('/auth/session-handoff/exchange', {
      method: 'POST',
      body: JSON.stringify({
        handoff_code: redirect.sessionHandoffCode,
        handoff_verifier: sessionHandoffVerifier,
        request_id: sessionHandoffRequestID,
      }),
    });
    if (!response.data) throw new Error('session handoff response is empty');
    await deleteStoredItem(SESSION_HANDOFF_VERIFIER_KEY);
    await deleteStoredItem(SESSION_HANDOFF_REQUEST_KEY);
    await deleteStoredItem(OAUTH_VERIFIER_KEY);
    await persistSession(response.data);
    return { session: response.data, preAuth: null };
  }

  if (!oauthVerifier || !redirect.handoffCode) throw new Error('OAuth verifier is missing');
  const response = await request<OAuthResponse>('/auth/google/exchange', {
    method: 'POST',
    body: JSON.stringify({ handoff_code: redirect.handoffCode, handoff_verifier: oauthVerifier }),
  });
  if (!response.data) throw new Error('OAuth response is empty');
  await deleteStoredItem(OAUTH_VERIFIER_KEY);
  await deleteStoredItem(SESSION_HANDOFF_VERIFIER_KEY);
  if (isSession(response.data)) {
    await persistSession(response.data);
    return { session: response.data, preAuth: null };
  }
  if (isPreAuth(response.data)) {
    await persistPreAuth(response.data);
    return { session: null, preAuth: response.data };
  }
  throw new Error('OAuth response is invalid');
}

const redirectPromises = new Map<string, Promise<AuthSnapshot>>();

export function completeAuthRedirect(value: string): Promise<AuthSnapshot> {
  const redirect = parseAuthRedirect(value);
  const code = redirect.sessionHandoffCode
    ? `session:${redirect.sessionHandoffCode}`
    : redirect.handoffCode
      ? `oauth:${redirect.handoffCode}`
      : null;
  if (!code) return Promise.reject(new Error('auth redirect code is missing'));
  const existing = redirectPromises.get(code);
  if (existing) return existing;
  const pending = completeAuthRedirectInternal(redirect);
  redirectPromises.set(code, pending);
  void pending.catch(() => {
    if (redirectPromises.get(code) === pending) redirectPromises.delete(code);
  });
  return pending;
}

export async function beginPasskey(
  preAuth: PreAuth | null,
  session: Session | null,
  language: AppLanguage = 'ja',
): Promise<AuthSnapshot | null> {
  if (!preAuth && !session) throw new Error('authentication is required');
  if (Platform.OS === 'web') {
    if (preAuth) {
      const nextSession = await completeWebPasskey(preAuth);
      await persistSession(nextSession);
      return { session: nextSession, preAuth: null };
    }
    if (session) {
      const currentSession = await refreshSession(session);
      await reauthWebPasskey(currentSession);
      return { session: currentSession, preAuth: null };
    }
  }

  const currentSession = session ? await refreshSession(session) : null;

  const verifier = createVerifier();
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const challenge = encodeBase64URL(digest);
  const redirectURI = authRedirectURI();
  const scope = preAuth
    ? (preAuth.passkey_registered ? 'passkey_login' : 'passkey_register')
    : 'passkey_reauth';
  const sourceToken = preAuth?.pre_auth_token ?? currentSession?.access_token;
  if (!sourceToken) throw new Error('authentication token is missing');
  const bootstrapResponse = await request<{ data?: PasskeyBootstrap }>('/auth/passkey/bootstrap', {
    method: 'POST',
    body: JSON.stringify({
      scope,
      app_redirect_uri: redirectURI,
      app_handoff_challenge: challenge,
    }),
  }, sourceToken);
  if (!bootstrapResponse.data || !isPasskeyBootstrap(bootstrapResponse.data)) {
    throw new Error('passkey bootstrap response is invalid');
  }
  await setStoredItem(SESSION_HANDOFF_VERIFIER_KEY, verifier);
  await deleteStoredItem(SESSION_HANDOFF_REQUEST_KEY);
  const result = await WebBrowser.openAuthSessionAsync(
    buildPasskeyURL(redirectURI, challenge, bootstrapResponse.data.bootstrap_token, WEB_PASSKEY_URL, language),
    redirectURI,
  );
  if (result.type !== 'success') {
    throw new Error(language === 'ja'
      ? 'Passkey認証の結果をアプリで受け取れませんでした。もう一度お試しください。'
      : 'The app did not receive the Passkey result. Please try again.');
  }
  return completeAuthRedirect(result.url);
}

export async function logout(session: Session): Promise<void> {
	try {
		let current = session;
		try {
			current = await refreshSession(session);
		} catch {
			// A dead/expired session must not prevent local logout. The server
			// rejects the stale token and the provider still clears all local
			// credentials below.
		}
		try {
			await request('/auth/logout', { method: 'POST' }, current.access_token);
		} catch {
			// Logout is intentionally best effort once local credentials are
			// removed. This avoids trapping a user on a signed-in screen when
			// the API is temporarily unavailable.
		}
	} finally {
		await clearAuthStorage();
	}
}

export async function logoutAll(session: Session): Promise<void> {
	try {
		let current = session;
		try {
			current = await refreshSession(session);
		} catch {
			// Keep local logout usable even when the rotating refresh token is no
			// longer accepted. The active session is already invalid server-side
			// in that case, or will expire independently.
		}
		try {
			await request('/auth/logout-all', { method: 'POST' }, current.access_token);
		} catch {
			// See logout: local credentials are always cleared.
		}
	} finally {
		await clearAuthStorage();
	}
}
