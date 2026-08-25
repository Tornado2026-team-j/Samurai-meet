import { API_BASE_URL } from './api-config';
import { isSession, type PreAuth, type Session } from './auth-contract';

type PasskeySession = Pick<Session, 'user_id' | 'session_id' | 'access_token'>;
type PasskeyOptionsResponse = {
  data?: {
    ceremony_token?: string;
    options?: { publicKey?: Record<string, unknown> };
  };
};
type SessionResponse = { data?: unknown };
type HandoffResponse = { data?: { handoff_code?: string; app_redirect_uri?: string } };

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

export function encodeArrayBuffer(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeBase64URL(value: string): ArrayBuffer {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function normalizeCreationOptions(options: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const user = options.user as Record<string, unknown>;
  const excluded = (options.excludeCredentials as Record<string, unknown>[] | undefined) ?? [];
  return {
    ...options,
    challenge: decodeBase64URL(String(options.challenge)),
    user: { ...user, id: decodeBase64URL(String(user.id)) },
    excludeCredentials: excluded.map((item) => ({ ...item, id: decodeBase64URL(String(item.id)) })),
  } as PublicKeyCredentialCreationOptions;
}

function normalizeRequestOptions(options: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const allowed = (options.allowCredentials as Record<string, unknown>[] | undefined) ?? [];
  return {
    ...options,
    challenge: decodeBase64URL(String(options.challenge)),
    allowCredentials: allowed.map((item) => ({ ...item, id: decodeBase64URL(String(item.id)) })),
  } as PublicKeyCredentialRequestOptions;
}

function credentialJSON(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response;
  const body: Record<string, unknown> = {
    id: credential.id,
    type: credential.type,
    rawId: encodeArrayBuffer(credential.rawId),
    response: {
      clientDataJSON: encodeArrayBuffer(response.clientDataJSON),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
  const responseBody = body.response as Record<string, unknown>;
  if (response instanceof AuthenticatorAttestationResponse) {
    responseBody.attestationObject = encodeArrayBuffer(response.attestationObject);
    if (typeof response.getTransports === 'function') responseBody.transports = response.getTransports();
  } else if (response instanceof AuthenticatorAssertionResponse) {
    responseBody.authenticatorData = encodeArrayBuffer(response.authenticatorData);
    responseBody.signature = encodeArrayBuffer(response.signature);
    responseBody.userHandle = response.userHandle ? encodeArrayBuffer(response.userHandle) : null;
  } else {
    throw new Error('Passkey response is unsupported');
  }
  if (credential.authenticatorAttachment) body.authenticatorAttachment = credential.authenticatorAttachment;
  return body;
}

function assertWebAuthn(): void {
  if (!globalThis.isSecureContext) throw new Error('PasskeyにはHTTPS接続が必要です');
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) {
    throw new Error('このブラウザはPasskeyに対応していません');
  }
}

function passkeyOptions(response: PasskeyOptionsResponse): {
  ceremonyToken: string;
  publicKey: Record<string, unknown>;
} {
  const ceremonyToken = response.data?.ceremony_token;
  const publicKey = response.data?.options?.publicKey;
  if (!ceremonyToken || !publicKey) throw new Error('Passkey options response is invalid');
  return { ceremonyToken, publicKey };
}

function sessionFrom(response: SessionResponse): Session {
  if (!isSession(response.data)) throw new Error('Passkey session response is invalid');
  return response.data;
}

async function registerPasskey(preAuth: PreAuth): Promise<Session> {
  const options = passkeyOptions(await request<PasskeyOptionsResponse>(
    '/auth/passkey/register/options',
    { method: 'POST' },
    preAuth.pre_auth_token,
  ));
  const credential = await navigator.credentials.create({ publicKey: normalizeCreationOptions(options.publicKey) });
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey登録がキャンセルされました');
  const response = await request<SessionResponse>('/auth/passkey/register/verify', {
    method: 'POST',
    headers: { 'X-Passkey-Ceremony-Token': options.ceremonyToken },
    body: JSON.stringify(credentialJSON(credential)),
  }, preAuth.pre_auth_token);
  return sessionFrom(response);
}

async function loginPasskey(preAuth: PreAuth): Promise<Session> {
  const options = passkeyOptions(await request<PasskeyOptionsResponse>('/auth/passkey/login/options', {
    method: 'POST',
    body: JSON.stringify({ user_id: preAuth.user_id }),
  }, preAuth.pre_auth_token));
  const credential = await navigator.credentials.get({ publicKey: normalizeRequestOptions(options.publicKey) });
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey認証がキャンセルされました');
  const response = await request<SessionResponse>('/auth/passkey/login/verify', {
    method: 'POST',
    headers: { 'X-Passkey-Ceremony-Token': options.ceremonyToken },
    body: JSON.stringify(credentialJSON(credential)),
  }, preAuth.pre_auth_token);
  return sessionFrom(response);
}

export async function completeWebPasskey(preAuth: PreAuth): Promise<Session> {
  assertWebAuthn();
  return preAuth.passkey_registered ? loginPasskey(preAuth) : registerPasskey(preAuth);
}

export async function reauthWebPasskey(session: PasskeySession): Promise<void> {
  assertWebAuthn();
  const options = passkeyOptions(await request<PasskeyOptionsResponse>(
    '/auth/passkey/reauth/options',
    { method: 'POST' },
    session.access_token,
  ));
  const credential = await navigator.credentials.get({ publicKey: normalizeRequestOptions(options.publicKey) });
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey再認証がキャンセルされました');
  await request('/auth/passkey/reauth/verify', {
    method: 'POST',
    headers: { 'X-Passkey-Ceremony-Token': options.ceremonyToken },
    body: JSON.stringify(credentialJSON(credential)),
  }, session.access_token);
}

export async function startNativeSessionHandoff(
  session: PasskeySession,
  appReturnURI: string,
  handoffChallenge: string,
): Promise<string> {
  const response = await request<HandoffResponse>('/auth/session-handoff/start', {
    method: 'POST',
    body: JSON.stringify({
      app_redirect_uri: appReturnURI,
      handoff_challenge: handoffChallenge,
    }),
  }, session.access_token);
  const code = response.data?.handoff_code;
  if (!code || response.data?.app_redirect_uri !== appReturnURI) {
    throw new Error('Session handoff response is invalid');
  }
  return code;
}
