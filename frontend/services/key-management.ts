import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_BASE_URL } from './api-config';
import {
  createRecoveryKeyMaterial,
  createKeyMaterial,
  deriveDataKey,
  devicePublicKey,
  fromBase64URL,
  hashBytes,
  recoverKeyA,
  randomBytes,
  recoveryPublicKey,
  signDeviceProof,
  signRecoveryProof,
  toBase64URL,
  type KeyEnvelope,
} from './crypto';
import { isPreAuth, type PreAuth, type Session } from './auth-contract';

const KEY_A_STORAGE_PREFIX = 'samurai_meet_key_a_v1_';
const RECOVERY_KEY_STORAGE_PREFIX = 'samurai_meet_recovery_key_v1_';
const DEVICE_ID_STORAGE_PREFIX = 'samurai_meet_device_id_v1_';
const DEVICE_KEY_B_STORAGE_PREFIX = 'samurai_meet_device_key_b_v1_';
const RECOVERY_CLIENT_MAX_ATTEMPTS = 5;
const RECOVERY_CLIENT_WINDOW_MS = 10 * 60 * 1000;
const RECOVERY_CLIENT_MIN_INTERVAL_MS = 1000;
const KEY_MANAGEMENT_REQUEST_TIMEOUT_MS = 15_000;

const recoveryClientAttempts = new Map<string, {
  attempts: number;
  lastAttemptAt: number;
  windowStartedAt: number;
}>();

const INVALID_RECOVERY_KEY_MESSAGE = 'Recovery Keyが正しくありません。保存したRecovery Keyを確認してください。';
const RECOVERY_RATE_LIMITED_MESSAGE = 'Recovery Keyの試行回数が多すぎます。しばらく待ってから再試行してください。';

type KeyEnvelopeResponseItem = Omit<KeyEnvelope, 'recovery_public_key'> & { recovery_public_key?: string };
type EnvelopeResponse = { data?: KeyEnvelopeResponseItem | KeyEnvelopeResponseItem[] };
type DeviceResponse = { data?: { device_id?: string; key_version?: string } };
type RecoveryChallengeResponse = { data?: RecoveryChallenge };
type RecoveryVerifyResponse = { data?: PreAuth };

export type RecoveryChallenge = {
  challenge_id: string;
  challenge: string;
  envelope: KeyEnvelope;
  expires_at: string;
};

export type GeneratedKeyMaterial = Awaited<ReturnType<typeof createKeyMaterial>>;

export type DeviceKeyMaterial = {
  deviceID: string;
  keyVersion: string;
  keyB: Uint8Array;
};

export type RecoveryRotationStage =
  | 'loading_key_a'
  | 'loading_envelope'
  | 'generating'
  | 'saving';

function storageSuffix(userID: string): string {
  return userID.replace(/[^A-Za-z0-9._-]/g, '_');
}

function keyAStorageKey(userID: string): string {
  return `${KEY_A_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function recoveryKeyStorageKey(userID: string): string {
  return `${RECOVERY_KEY_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function deviceIDStorageKey(userID: string): string {
  return `${DEVICE_ID_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function deviceKeyBStorageKey(userID: string): string {
  return `${DEVICE_KEY_B_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStoredItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

async function getDeviceStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.sessionStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setDeviceStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function deleteDeviceStoredItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

async function request<T>(path: string, init: RequestInit = {}, token: string): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timeoutID = setTimeout(() => controller.abort(), KEY_MANAGEMENT_REQUEST_TIMEOUT_MS);
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

function isKeyEnvelope(value: unknown): value is KeyEnvelopeResponseItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<KeyEnvelope>;
  const params = candidate.kdf_params as Partial<KeyEnvelope['kdf_params']> | undefined;
  return typeof candidate.key_version === 'string'
    && typeof candidate.encrypted_key_a === 'string'
    && typeof candidate.nonce === 'string'
    && (candidate.recovery_public_key === undefined || typeof candidate.recovery_public_key === 'string')
    && !!params
    && params.algorithm === 'HKDF-SHA256'
    && typeof params.salt === 'string'
    && typeof params.info === 'string'
    && typeof params.data_salt === 'string';
}

function normalizeKeyEnvelope(value: KeyEnvelopeResponseItem): KeyEnvelope {
  return {
    ...value,
    recovery_public_key: value.recovery_public_key ?? '',
  };
}

export async function loadStoredKeyA(userID: string): Promise<Uint8Array | null> {
  const value = await getStoredItem(keyAStorageKey(userID));
  if (!value) return null;
  try {
    const keyA = fromBase64URL(value);
    return keyA.length === 32 ? keyA : null;
  } catch {
    return null;
  }
}

export async function loadStoredRecoveryKey(userID: string): Promise<string | null> {
  return getStoredItem(recoveryKeyStorageKey(userID));
}

export async function saveKeyMaterial(userID: string, keyA: Uint8Array, recoveryKey: string): Promise<void> {
  if (keyA.length !== 32) throw new Error('Invalid Key-A');
  const normalizedRecoveryKey = normalizeRecoveryKey(recoveryKey);
  if (fromBase64URL(normalizedRecoveryKey).length !== 32) throw new Error('Invalid Recovery Key');
  await Promise.all([
    setStoredItem(keyAStorageKey(userID), toBase64URL(keyA)),
    setStoredItem(recoveryKeyStorageKey(userID), normalizedRecoveryKey),
  ]);
}

export async function clearKeyMaterial(userID: string): Promise<void> {
	await Promise.all([
		deleteStoredItem(keyAStorageKey(userID)),
		deleteStoredItem(recoveryKeyStorageKey(userID)),
		deleteDeviceStoredItem(deviceIDStorageKey(userID)),
		deleteDeviceStoredItem(deviceKeyBStorageKey(userID)),
	]);
}

export async function deleteAccount(session: Session): Promise<void> {
  await request('/me', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE' }),
  }, session.access_token);
  await clearKeyMaterial(session.user_id);
}

export async function listKeyEnvelopes(session: Session): Promise<KeyEnvelope[]> {
  const response = await request<EnvelopeResponse>('/me/key-envelopes', { method: 'GET' }, session.access_token);
  if (!Array.isArray(response.data) || !response.data.every(isKeyEnvelope)) {
    throw new Error('Key-A envelope response is invalid');
  }
  return response.data.map(normalizeKeyEnvelope);
}

export async function saveKeyEnvelope(session: Session, envelope: KeyEnvelope): Promise<KeyEnvelope> {
  const response = await request<EnvelopeResponse>(`/me/key-envelopes/${encodeURIComponent(envelope.key_version)}`, {
    method: 'PUT',
    body: JSON.stringify(envelope),
  }, session.access_token);
  if (!response.data || !isKeyEnvelope(response.data)) throw new Error('Key-A envelope save response is invalid');
  return normalizeKeyEnvelope(response.data);
}

export async function loadStoredDeviceKeyB(userID: string): Promise<DeviceKeyMaterial | null> {
	const [encodedDeviceID, encodedKeyB] = await Promise.all([
		getDeviceStoredItem(deviceIDStorageKey(userID)),
		getDeviceStoredItem(deviceKeyBStorageKey(userID)),
	]);
	if (!encodedDeviceID || !encodedKeyB) return null;
	try {
		const deviceID = fromBase64URL(encodedDeviceID);
		const keyB = fromBase64URL(encodedKeyB);
		if (deviceID.length !== 16 || keyB.length !== 32) return null;
		return { deviceID: encodedDeviceID, keyVersion: 'v1', keyB };
	} catch {
		return null;
	}
}

async function createDeviceKeyMaterial(userID: string): Promise<DeviceKeyMaterial> {
	const deviceID = toBase64URL(await randomBytes(16));
	const keyB = await randomBytes(32);
	await Promise.all([
		setDeviceStoredItem(deviceIDStorageKey(userID), deviceID),
		setDeviceStoredItem(deviceKeyBStorageKey(userID), toBase64URL(keyB)),
	]);
	return { deviceID, keyVersion: 'v1', keyB };
}

export async function ensureDeviceKeyB(session: Session): Promise<DeviceKeyMaterial> {
	let material = await loadStoredDeviceKeyB(session.user_id);
	if (!material) material = await createDeviceKeyMaterial(session.user_id);
	try {
		const response = await request<DeviceResponse>('/me/devices', {
			method: 'POST',
			body: JSON.stringify({
				device_id: material.deviceID,
				key_version: material.keyVersion,
				public_key: devicePublicKey(material.keyB),
			}),
		}, session.access_token);
		if (response.data?.device_id !== material.deviceID || response.data.key_version !== material.keyVersion) {
			throw new Error('Device key registration response is invalid');
		}
		return material;
	} catch (reason) {
		if (!(reason instanceof Error) || reason.message !== '409: device_key_mismatch') throw reason;
		// A Secure Storage restore can leave an old device ID beside a newly
		// generated key. Rotate the device identifier instead of replacing a
		// server registration with a different public key.
		material = await createDeviceKeyMaterial(session.user_id);
		const response = await request<DeviceResponse>('/me/devices', {
			method: 'POST',
			body: JSON.stringify({
				device_id: material.deviceID,
				key_version: material.keyVersion,
				public_key: devicePublicKey(material.keyB),
			}),
		}, session.access_token);
		if (response.data?.device_id !== material.deviceID || response.data.key_version !== material.keyVersion) {
			throw new Error('Device key registration response is invalid');
		}
		return material;
	}
}

export async function createDeviceProofHeaders(
	session: Session,
	material: DeviceKeyMaterial,
	method: string,
	path: string,
	body: Uint8Array = new Uint8Array(),
): Promise<Record<string, string>> {
	const timestamp = new Date().toISOString();
	const nonce = toBase64URL(await randomBytes(16));
	const bodyHash = hashBytes(body);
	return {
		'X-Photo-Device-ID': material.deviceID,
		'X-Device-Timestamp': timestamp,
		'X-Device-Nonce': nonce,
		'X-Device-Body-SHA256': bodyHash,
		'X-Device-Signature': signDeviceProof(material.keyB, session.user_id, material.deviceID, method.toUpperCase(), path, timestamp, nonce, bodyHash),
	};
}

export async function deriveCurrentDataKey(session: Session, envelope: KeyEnvelope): Promise<Uint8Array> {
	const keyA = await loadStoredKeyA(session.user_id);
	if (!keyA) throw new Error('Key-A is not available on this device');
	const keyB = await ensureDeviceKeyB(session);
	return deriveDataKey(keyA, keyB.keyB, envelope.kdf_params.data_salt);
}

export async function createInitialKeyMaterial(): Promise<GeneratedKeyMaterial> {
  return createKeyMaterial();
}

export async function completeInitialKeySetup(session: Session, material: GeneratedKeyMaterial): Promise<void> {
  await saveKeyEnvelope(session, material.envelope);
  await saveKeyMaterial(session.user_id, material.keyA, material.recoveryKey);
}

/**
 * Prepares a Recovery Key rotation without changing Key-A or the data-key
 * salt. The returned material must not be sent to the server until the user
 * has confirmed that the newly displayed key was saved.
 */
export async function prepareRecoveryKeyRotation(
  session: Session,
  onStage?: (stage: Exclude<RecoveryRotationStage, 'saving'>) => void,
): Promise<GeneratedKeyMaterial> {
  onStage?.('loading_key_a');
  const keyA = await loadStoredKeyA(session.user_id);
  if (!keyA) throw new Error('この端末に暗号鍵がありません。先にRecovery Keyで復旧してください。');

  onStage?.('loading_envelope');
  const envelopes = await listKeyEnvelopes(session);
  const envelope = envelopes.find((item) => item.recovery_public_key.length > 0) ?? envelopes[0];
  if (!envelope) throw new Error('このアカウントにはRecovery Keyが登録されていません。');

  onStage?.('generating');
  return createRecoveryKeyMaterial(keyA, envelope);
}

export async function completeRecoveryKeyRotation(
  session: Session,
  material: GeneratedKeyMaterial,
  onStage?: (stage: 'saving') => void,
): Promise<void> {
  onStage?.('saving');
  await saveKeyEnvelope(session, material.envelope);
  await saveKeyMaterial(session.user_id, material.keyA, material.recoveryKey);
}

export async function beginRecovery(token: string): Promise<RecoveryChallenge> {
  let response: RecoveryChallengeResponse;
  try {
    response = await request<RecoveryChallengeResponse>('/auth/recovery/challenge', { method: 'POST' }, token);
  } catch (reason) {
    if (reason instanceof Error && reason.message === '429: recovery_rate_limited') {
      throw new Error(RECOVERY_RATE_LIMITED_MESSAGE);
    }
    if (reason instanceof Error && (reason.message === '409: recovery_not_configured' || reason.message === '404: recovery_material_not_found')) {
      throw new Error('このアカウントにはRecovery Keyが登録されていません。Passkey認証後に新しいRecovery Keyを登録してください。');
    }
    if (reason instanceof Error && reason.message === '401: recovery_challenge_failed') {
      throw new Error('Recovery Keyを確認できませんでした。本人確認状態を確認してから、もう一度お試しください。');
    }
    throw reason;
  }
  if (!response.data || !isRecoveryChallenge(response.data)) throw new Error('Recovery challenge response is invalid');
  return response.data;
}

export async function recoverWithPreAuth(preAuth: PreAuth, recoveryKey: string): Promise<PreAuth> {
  enforceClientRecoveryLimit(preAuth.user_id);
  const challenge = await beginRecovery(preAuth.pre_auth_token);
  let normalizedRecoveryKey: string;
  let keyA: Uint8Array;
  try {
    normalizedRecoveryKey = normalizeRecoveryKey(recoveryKey);
    keyA = recoverKeyA(normalizedRecoveryKey, challenge.envelope);
    if (recoveryPublicKey(keyA) !== challenge.envelope.recovery_public_key) throw new Error('recovery key mismatch');
  } catch {
    await reportInvalidRecoveryProof(preAuth.pre_auth_token, challenge);
    throw new Error(INVALID_RECOVERY_KEY_MESSAGE);
  }

  let response: RecoveryVerifyResponse;
  try {
    response = await request<RecoveryVerifyResponse>('/auth/recovery/verify', {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        challenge: challenge.challenge,
        key_version: challenge.envelope.key_version,
        signature: signRecoveryProof(keyA, preAuth.user_id, challenge.envelope.key_version, challenge.challenge),
      }),
    }, preAuth.pre_auth_token);
  } catch (reason) {
    throw mapRecoveryVerificationError(reason);
  }
  if (!isPreAuth(response.data)) throw new Error('Recovery pre-auth response is invalid');
  await saveKeyMaterial(preAuth.user_id, keyA, normalizedRecoveryKey);
  recoveryClientAttempts.delete(preAuth.user_id);
  return response.data;
}

export async function recoverWithSession(session: Session, recoveryKey: string): Promise<void> {
  enforceClientRecoveryLimit(session.user_id);
  const challenge = await beginRecovery(session.access_token);
  let normalizedRecoveryKey: string;
  let keyA: Uint8Array;
  try {
    normalizedRecoveryKey = normalizeRecoveryKey(recoveryKey);
    keyA = recoverKeyA(normalizedRecoveryKey, challenge.envelope);
    if (recoveryPublicKey(keyA) !== challenge.envelope.recovery_public_key) throw new Error('recovery key mismatch');
  } catch {
    await reportInvalidRecoveryProof(session.access_token, challenge);
    throw new Error(INVALID_RECOVERY_KEY_MESSAGE);
  }

  try {
    await request('/auth/recovery/verify', {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        challenge: challenge.challenge,
        key_version: challenge.envelope.key_version,
        signature: signRecoveryProof(keyA, session.user_id, challenge.envelope.key_version, challenge.challenge),
      }),
    }, session.access_token);
  } catch (reason) {
    throw mapRecoveryVerificationError(reason);
  }
  await saveKeyMaterial(session.user_id, keyA, normalizedRecoveryKey);
  recoveryClientAttempts.delete(session.user_id);
}

function normalizeRecoveryKey(value: string): string {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized) throw new Error(INVALID_RECOVERY_KEY_MESSAGE);
  try {
    if (fromBase64URL(normalized).length !== 32) throw new Error('invalid recovery key length');
  } catch {
    throw new Error(INVALID_RECOVERY_KEY_MESSAGE);
  }
  return normalized;
}

function enforceClientRecoveryLimit(userID: string): void {
  const current = Date.now();
  const previous = recoveryClientAttempts.get(userID);
  const state = !previous || current - previous.windowStartedAt >= RECOVERY_CLIENT_WINDOW_MS
    ? { attempts: 0, lastAttemptAt: 0, windowStartedAt: current }
    : previous;
  if (state.attempts >= RECOVERY_CLIENT_MAX_ATTEMPTS) throw new Error(RECOVERY_RATE_LIMITED_MESSAGE);
  if (state.lastAttemptAt > 0 && current - state.lastAttemptAt < RECOVERY_CLIENT_MIN_INTERVAL_MS) {
    throw new Error('少し待ってからRecovery Keyを再試行してください。');
  }
  state.attempts += 1;
  state.lastAttemptAt = current;
  recoveryClientAttempts.set(userID, state);
}

async function reportInvalidRecoveryProof(token: string, challenge: RecoveryChallenge): Promise<void> {
  try {
    await request('/auth/recovery/verify', {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        challenge: challenge.challenge,
        key_version: challenge.envelope.key_version,
        // The local unwrap failed, so send a deliberately invalid, correctly
        // shaped proof to consume the server-side challenge attempt.
        signature: toBase64URL(await randomBytes(64)),
      }),
    }, token);
  } catch {
    // The user-facing error must not expose the cryptographic failure or the
    // reporting request's transport/status details.
  }
}

function mapRecoveryVerificationError(reason: unknown): Error {
  if (reason instanceof Error && reason.message === '429: recovery_rate_limited') {
    return new Error(RECOVERY_RATE_LIMITED_MESSAGE);
  }
  if (reason instanceof Error && reason.message === '401: recovery_verification_failed') {
    return new Error(INVALID_RECOVERY_KEY_MESSAGE);
  }
  return reason instanceof Error ? reason : new Error('Recovery Keyの確認に失敗しました。');
}

function isRecoveryChallenge(value: unknown): value is RecoveryChallenge {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RecoveryChallenge>;
  return typeof candidate.challenge_id === 'string'
    && typeof candidate.challenge === 'string'
    && typeof candidate.expires_at === 'string'
    && isKeyEnvelope(candidate.envelope)
    && candidate.envelope.recovery_public_key !== undefined
    && candidate.envelope.recovery_public_key.length > 0;
}
