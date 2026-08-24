import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import {
  buildPasskeyURL,
  encodeBase64URL,
  isPreAuth,
  isStoredSession,
  parseAuthRedirect,
  storedSession,
  WEB_PASSKEY_URL,
  type PreAuth,
  type Session,
  type StoredSession,
  type AuthRedirect,
} from './auth-contract';

export { buildPasskeyURL, encodeBase64URL, isPreAuth, isStoredSession, parseAuthRedirect, storedSession, WEB_PASSKEY_URL } from './auth-contract';
export type { PreAuth, Session, StoredSession, AuthRedirect } from './auth-contract';

WebBrowser.maybeCompleteAuthSession();

const DEFAULT_API_BASE_URL = 'https://samurai-meet.disnana.com/api/v1';
const configuredApiBaseURL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
export const API_BASE_URL = (configuredApiBaseURL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');

const SESSION_KEY = 'samurai_meet_session_v1';
const PRE_AUTH_KEY = 'samurai_meet_pre_auth_v1';
const OAUTH_VERIFIER_KEY = 'samurai_meet_oauth_verifier_v1';
const SESSION_HANDOFF_VERIFIER_KEY = 'samurai_meet_session_handoff_verifier_v1';
const REFRESH_REQUEST_KEY = 'samurai_meet_refresh_request_v1';

type SessionResponse = { data?: Session };
type OAuthResponse = { data?: Session | PreAuth };

export type AuthSnapshot = {
  session: Session | null;
  preAuth: PreAuth | null;
};

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
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
}

async function persistSession(value: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(storedSession(value)));
  await SecureStore.deleteItemAsync(PRE_AUTH_KEY);
}

async function persistPreAuth(value: PreAuth): Promise<void> {
  await SecureStore.setItemAsync(PRE_AUTH_KEY, JSON.stringify(value));
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function clearAuthStorage(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_KEY),
    SecureStore.deleteItemAsync(PRE_AUTH_KEY),
    SecureStore.deleteItemAsync(OAUTH_VERIFIER_KEY),
    SecureStore.deleteItemAsync(SESSION_HANDOFF_VERIFIER_KEY),
    SecureStore.deleteItemAsync(REFRESH_REQUEST_KEY),
  ]);
}

async function refreshStoredSession(value: StoredSession): Promise<Session> {
  const requestID = (await SecureStore.getItemAsync(REFRESH_REQUEST_KEY)) ?? Crypto.randomUUID();
  await SecureStore.setItemAsync(REFRESH_REQUEST_KEY, requestID);
  const response = await request<SessionResponse>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: value.refresh_token, request_id: requestID }),
  });
  if (!response.data) throw new Error('refresh response is empty');
  // 新Refresh Tokenを先に保存し、保存失敗時は同じrequest_idで再送できるようにする。
  await persistSession(response.data);
  await SecureStore.deleteItemAsync(REFRESH_REQUEST_KEY);
  return response.data;
}

function shouldClearStoredSession(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  if (!(error instanceof Error)) return false;
  return /^4\d\d:/.test(error.message) || error.message === 'refresh response is empty';
}

export async function restoreAuth(): Promise<AuthSnapshot> {
  const [stored, preAuthValue] = await Promise.all([
    SecureStore.getItemAsync(SESSION_KEY),
    SecureStore.getItemAsync(PRE_AUTH_KEY),
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
    }
  }
  if (preAuthValue && !stored) {
    try {
      const parsed: unknown = JSON.parse(preAuthValue);
      if (!isPreAuth(parsed)) throw new SyntaxError('pre-auth shape is invalid');
      return { session: null, preAuth: parsed };
    } catch {
      await clearAuthStorage();
    }
  }
  return { session: null, preAuth: null };
}

export async function refreshSession(session: Session): Promise<Session> {
  return refreshStoredSession(storedSession(session));
}

export function createVerifier(): string {
  return `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
}

export async function beginGoogleLogin(): Promise<AuthSnapshot | null> {
  const verifier = createVerifier();
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const challenge = encodeBase64URL(digest);
  const redirectURI = Linking.createURL('auth');
  await SecureStore.setItemAsync(OAUTH_VERIFIER_KEY, verifier);
  const startURL = `${API_BASE_URL}/auth/google/start?app_redirect_uri=${encodeURIComponent(redirectURI)}&handoff_challenge=${encodeURIComponent(challenge)}`;
  const result = await WebBrowser.openAuthSessionAsync(startURL, redirectURI);
  if (result.type !== 'success') return null;
  return completeAuthRedirect(result.url);
}

async function completeAuthRedirectInternal(redirect: AuthRedirect): Promise<AuthSnapshot> {
  const oauthVerifier = await SecureStore.getItemAsync(OAUTH_VERIFIER_KEY);
  const sessionHandoffVerifier = await SecureStore.getItemAsync(SESSION_HANDOFF_VERIFIER_KEY);

  if (redirect.sessionHandoffCode) {
    if (!sessionHandoffVerifier) throw new Error('session handoff verifier is missing');
    const response = await request<SessionResponse>('/auth/session-handoff/exchange', {
      method: 'POST',
      body: JSON.stringify({ handoff_code: redirect.sessionHandoffCode, handoff_verifier: sessionHandoffVerifier }),
    });
    if (!response.data) throw new Error('session handoff response is empty');
    await SecureStore.deleteItemAsync(SESSION_HANDOFF_VERIFIER_KEY);
    await SecureStore.deleteItemAsync(OAUTH_VERIFIER_KEY);
    await persistSession(response.data);
    return { session: response.data, preAuth: null };
  }

  if (!oauthVerifier || !redirect.handoffCode) throw new Error('OAuth verifier is missing');
  const response = await request<OAuthResponse>('/auth/google/exchange', {
    method: 'POST',
    body: JSON.stringify({ handoff_code: redirect.handoffCode, handoff_verifier: oauthVerifier }),
  });
  if (!response.data) throw new Error('OAuth response is empty');
  await SecureStore.deleteItemAsync(OAUTH_VERIFIER_KEY);
  await SecureStore.deleteItemAsync(SESSION_HANDOFF_VERIFIER_KEY);
  if ('access_token' in response.data) {
    await persistSession(response.data);
    return { session: response.data, preAuth: null };
  }
  await persistPreAuth(response.data);
  return { session: null, preAuth: response.data };
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

export async function beginPasskey(preAuth: PreAuth | null, session: Session | null): Promise<AuthSnapshot | null> {
  if (!preAuth && !session) throw new Error('authentication is required');
  const verifier = createVerifier();
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const challenge = encodeBase64URL(digest);
  const redirectURI = Linking.createURL('auth');
  await SecureStore.setItemAsync(SESSION_HANDOFF_VERIFIER_KEY, verifier);
  const result = await WebBrowser.openAuthSessionAsync(buildPasskeyURL(redirectURI, challenge, preAuth, session), redirectURI);
  if (result.type !== 'success') return null;
  return completeAuthRedirect(result.url);
}

export async function logout(session: Session): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST' }, session.access_token);
  } finally {
    await clearAuthStorage();
  }
}

export async function logoutAll(session: Session): Promise<void> {
  try {
    await request('/auth/logout-all', { method: 'POST' }, session.access_token);
  } finally {
    await clearAuthStorage();
  }
}
