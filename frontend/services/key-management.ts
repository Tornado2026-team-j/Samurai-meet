import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_BASE_URL } from './api-config';
import {
	createRecoveryMaterial,
	createKeyMaterial,
	deriveAccountDataKey,
	DEVICE_AGREEMENT_KEY_VERSION,
	DEVICE_TRANSFER_ALGORITHM,
	createDeviceAgreementKeyMaterial,
	createDeviceTransferVerificationCode,
	deviceAgreementPublicKey,
	devicePublicKey,
	fromBase64URL,
	hashBytes,
	normalizeRecoveryPhrase,
	recoverKeyAAsync,
	randomBytes,
	recoveryPublicKey,
	signDeviceProof,
	signRecoveryProof,
	toBase64URL,
	unwrapMasterKeyForDevice,
	wrapMasterKeyForDevice,
	type DeviceAgreementKeyMaterial,
	type KeyEnvelope,
} from './crypto';
import { persistPreAuth } from './auth';
import { isPreAuth, type PreAuth, type Session } from './auth-contract';
import { fetchWithAutoRefresh } from './authenticated-fetch';

const KEY_A_STORAGE_PREFIX = 'samurai_meet_key_a_v1_';
const RECOVERY_KEY_STORAGE_PREFIX = 'samurai_meet_recovery_key_v1_';
const KEY_ENVELOPE_STORAGE_PREFIX = 'samurai_meet_key_envelope_v1_';
const INITIAL_KEY_MATERIAL_DRAFT_PREFIX = 'samurai_meet_initial_key_material_draft_v1_';
const RECOVERY_KEY_ROTATION_PENDING_PREFIX = 'samurai_meet_recovery_key_rotation_pending_v1_';
const RECOVERY_KEY_ROTATION_MATERIAL_PREFIX = 'samurai_meet_recovery_key_rotation_material_v1_';
const DEVICE_ID_STORAGE_PREFIX = 'samurai_meet_device_id_v1_';
const DEVICE_KEY_B_STORAGE_PREFIX = 'samurai_meet_device_key_b_v1_';
const DEVICE_AGREEMENT_PRIVATE_KEY_STORAGE_PREFIX = 'samurai_meet_device_agreement_private_v1_';
const DEVICE_TRANSFER_DRAFT_STORAGE_PREFIX = 'samurai_meet_device_transfer_draft_v1_';
const RECOVERY_CLIENT_MAX_ATTEMPTS = 5;
const RECOVERY_CLIENT_WINDOW_MS = 10 * 60 * 1000;
const RECOVERY_CLIENT_MIN_INTERVAL_MS = 1000;
const KEY_MANAGEMENT_REQUEST_TIMEOUT_MS = 15_000;

const recoveryClientAttempts = new Map<string, {
  attempts: number;
  lastAttemptAt: number;
  windowStartedAt: number;
}>();

const INVALID_RECOVERY_KEY_MESSAGE = 'Recovery Phraseが正しくありません。保存したRecovery Phraseを確認してください。';
const RECOVERY_RATE_LIMITED_MESSAGE = 'Recovery Phraseの試行回数が多すぎます。しばらく待ってから再試行してください。';

type KeyEnvelopeResponseItem = Omit<KeyEnvelope, 'recovery_public_key'> & { recovery_public_key?: string };
type EnvelopeResponse = { data?: KeyEnvelopeResponseItem | KeyEnvelopeResponseItem[] };
type DeviceResponse = { data?: { device_id?: string; key_version?: string; agreement_key_version?: string; agreement_public_key?: string } };
type DeviceListResponse = { data?: RegisteredDevice[] };
type RecoveryChallengeResponse = { data?: RecoveryChallenge };
type RecoveryVerifyResponse = { data?: PreAuth };
type DeviceTransferResponse = { data?: DeviceTransfer | DeviceTransfer[] };

export type RecoveryChallenge = {
  challenge_id: string;
  challenge: string;
  envelope: KeyEnvelope;
  expires_at: string;
};

export type GeneratedKeyMaterial = {
  keyA: Uint8Array;
  recoveryKey: string;
  recoveryPhrase?: string;
  envelope: KeyEnvelope;
  /** True only for material produced by the local KDF in this runtime. */
  kdfVerified?: boolean;
};

export type DeviceTransfer = {
  id: string;
  source_device_id?: string;
  target_device_id: string;
  target_key_version: string;
  target_public_key: string;
  target_public_key_fingerprint: string;
  wrapped_master_key?: string;
  wrapping_algorithm?: string;
  status: 'pending' | 'approved' | 'completed' | 'rejected' | 'expired' | 'cancelled';
  expires_at: string;
  created_at: string;
  approved_at?: string;
  completed_at?: string;
};

export type DeviceTransferDraft = {
  transferID: string;
  verificationCode: string;
  targetDeviceID: string;
  createdAt: string;
};

export type DeviceKeyBundle = {
	device: DeviceKeyMaterial;
	agreement: DeviceAgreementKeyMaterial;
};

export type DeviceKeyMaterial = {
  deviceID: string;
  keyVersion: string;
  keyB: Uint8Array;
};

export type RegisteredDevice = {
  device_id: string;
  key_version: string;
  agreement_key_version?: string;
  created_at: string;
  last_seen_at: string;
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

function keyEnvelopeStorageKey(userID: string): string {
  return `${KEY_ENVELOPE_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function initialKeyMaterialDraftStorageKey(userID: string): string {
  return `${INITIAL_KEY_MATERIAL_DRAFT_PREFIX}${storageSuffix(userID)}`;
}

function recoveryKeyRotationPendingStorageKey(userID: string): string {
  return `${RECOVERY_KEY_ROTATION_PENDING_PREFIX}${storageSuffix(userID)}`;
}

function recoveryKeyRotationMaterialStorageKey(userID: string): string {
  return `${RECOVERY_KEY_ROTATION_MATERIAL_PREFIX}${storageSuffix(userID)}`;
}

function deviceIDStorageKey(userID: string): string {
  return `${DEVICE_ID_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function deviceKeyBStorageKey(userID: string): string {
	return `${DEVICE_KEY_B_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function deviceAgreementPrivateKeyStorageKey(userID: string): string {
  return `${DEVICE_AGREEMENT_PRIVATE_KEY_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function deviceTransferDraftStorageKey(userID: string): string {
  return `${DEVICE_TRANSFER_DRAFT_STORAGE_PREFIX}${storageSuffix(userID)}`;
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
  const argon2id = params?.algorithm === 'Argon2id+HKDF-SHA256' ? params.argon2id : undefined;
  return typeof candidate.key_version === 'string'
    && candidate.key_version === 'v2'
    && typeof candidate.encrypted_key_a === 'string'
    && typeof candidate.nonce === 'string'
    && (candidate.recovery_public_key === undefined || typeof candidate.recovery_public_key === 'string')
    && !!params
    && params.algorithm === 'Argon2id+HKDF-SHA256'
    && typeof params.salt === 'string'
    && typeof params.info === 'string'
    && typeof params.data_salt === 'string'
    && !!argon2id
    && Number.isInteger(argon2id.memory_kib)
    && argon2id.memory_kib >= 8192
    && argon2id.memory_kib <= 262144
    && Number.isInteger(argon2id.iterations)
    && argon2id.iterations >= 1
    && argon2id.iterations <= 10
    && Number.isInteger(argon2id.parallelism)
    && argon2id.parallelism >= 1
    && argon2id.parallelism <= 4
    && typeof candidate.recovery_public_key === 'string'
    && candidate.recovery_public_key.length > 0;
}

async function requestWithSession<T>(path: string, init: RequestInit = {}, session: Session): Promise<T> {
  try {
    const response = await fetchWithAutoRefresh(path, session, init, KEY_MANAGEMENT_REQUEST_TIMEOUT_MS);
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
    if (reason instanceof Error && reason.name === 'AbortError' && !init.signal?.aborted) {
      throw new Error('通信がタイムアウトしました。接続を確認して再試行してください。');
    }
    throw reason;
  }
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

/**
 * The encrypted envelope is cached in Secure Storage so ordinary app startup
 * does not need the privileged server envelope endpoint. The server remains
 * authoritative for recovery and key-management operations.
 */
export async function loadStoredKeyEnvelope(userID: string): Promise<KeyEnvelope | null> {
  const stored = await getStoredItem(keyEnvelopeStorageKey(userID));
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isKeyEnvelope(parsed) ? normalizeKeyEnvelope(parsed) : null;
  } catch {
    return null;
  }
}

async function saveStoredKeyEnvelope(userID: string, envelope: KeyEnvelope): Promise<void> {
  await setStoredItem(keyEnvelopeStorageKey(userID), JSON.stringify(envelope));
}

/**
 * Recovery verification succeeds before the new Passkey session exists. Keep
 * this local marker so the post-Passkey key setup cannot silently treat the
 * old Recovery Phrase as complete. It is a workflow marker, not an auth
 * decision; the server remains the authority when the new envelope is saved.
 */
export async function markRecoveryKeyRotationPending(userID: string): Promise<void> {
  await setStoredItem(recoveryKeyRotationPendingStorageKey(userID), '1');
}

export async function isRecoveryKeyRotationPending(userID: string): Promise<boolean> {
  return (await getStoredItem(recoveryKeyRotationPendingStorageKey(userID))) === '1';
}

function validateKeyMaterialShape(material: GeneratedKeyMaterial): string {
  if (
    material.keyA.length !== 32
    || material.envelope.key_version !== 'v2'
    || recoveryPublicKey(material.keyA) !== material.envelope.recovery_public_key
  ) {
    throw new Error('Invalid Recovery Phrase key material');
  }
  return normalizeRecoveryMaterial(material.recoveryKey, material.envelope);
}

function keyBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function verifyKeyMaterial(
  keyA: Uint8Array,
  normalizedRecoveryKey: string,
  envelope: KeyEnvelope,
): Promise<void> {
  const recoveredKeyA = await recoverKeyAAsync(normalizedRecoveryKey, envelope);
  if (!keyBytesEqual(recoveredKeyA, keyA)) throw new Error('Invalid Recovery Phrase key material');
}

async function persistKeyMaterial(
  userID: string,
  keyA: Uint8Array,
  normalizedRecoveryKey: string,
): Promise<void> {
  await Promise.all([
    setStoredItem(keyAStorageKey(userID), toBase64URL(keyA)),
    setStoredItem(recoveryKeyStorageKey(userID), normalizedRecoveryKey),
  ]);
}

async function ensureKeyMaterialVerified(material: GeneratedKeyMaterial): Promise<string> {
  const normalizedRecoveryKey = validateKeyMaterialShape(material);
  if (material.kdfVerified !== true) {
    await verifyKeyMaterial(material.keyA, normalizedRecoveryKey, material.envelope);
  }
  return normalizedRecoveryKey;
}

function serializeKeyMaterial(material: GeneratedKeyMaterial, normalizedRecoveryKey: string): string {
  return JSON.stringify({
    key_a: toBase64URL(material.keyA),
    recovery_material: normalizedRecoveryKey,
    envelope: material.envelope,
  });
}

function parseStoredKeyMaterial(stored: string): GeneratedKeyMaterial | null {
  const parsed: unknown = JSON.parse(stored);
  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed as {
    key_a?: unknown;
    recovery_material?: unknown;
    recovery_key?: unknown;
    envelope?: unknown;
  };
  const storedRecoveryMaterial = candidate.recovery_material ?? candidate.recovery_key;
  if (typeof candidate.key_a !== 'string' || typeof storedRecoveryMaterial !== 'string' || !isKeyEnvelope(candidate.envelope)) {
    return null;
  }
  const keyA = fromBase64URL(candidate.key_a);
  const envelope = normalizeKeyEnvelope(candidate.envelope);
  const recoveryKey = normalizeRecoveryMaterial(storedRecoveryMaterial, envelope);
  if (keyA.length !== 32 || recoveryPublicKey(keyA) !== envelope.recovery_public_key) return null;
  return { keyA, recoveryKey, recoveryPhrase: recoveryKey, envelope, kdfVerified: false };
}

export async function saveInitialKeyMaterialDraft(
  userID: string,
  material: GeneratedKeyMaterial,
): Promise<void> {
  const normalizedRecoveryKey = await ensureKeyMaterialVerified(material);
  await setStoredItem(initialKeyMaterialDraftStorageKey(userID), serializeKeyMaterial(material, normalizedRecoveryKey));
}

export async function loadInitialKeyMaterialDraft(userID: string): Promise<GeneratedKeyMaterial | null> {
  const stored = await getStoredItem(initialKeyMaterialDraftStorageKey(userID));
  if (!stored) return null;
  try {
    return parseStoredKeyMaterial(stored);
  } catch {
    return null;
  }
}

async function clearInitialKeyMaterialDraft(userID: string): Promise<void> {
  await deleteStoredItem(initialKeyMaterialDraftStorageKey(userID));
}

export async function savePendingRecoveryKeyRotation(
  userID: string,
  material: GeneratedKeyMaterial,
): Promise<void> {
  const normalizedRecoveryKey = await ensureKeyMaterialVerified(material);
  await setStoredItem(recoveryKeyRotationMaterialStorageKey(userID), serializeKeyMaterial(material, normalizedRecoveryKey));
  await markRecoveryKeyRotationPending(userID);
}

export async function loadPendingRecoveryKeyRotation(userID: string): Promise<GeneratedKeyMaterial | null> {
  const stored = await getStoredItem(recoveryKeyRotationMaterialStorageKey(userID));
  if (!stored) return null;
  try {
    return parseStoredKeyMaterial(stored);
  } catch {
    return null;
  }
}

async function clearRecoveryKeyRotationPending(userID: string): Promise<void> {
  await Promise.all([
    deleteStoredItem(recoveryKeyRotationPendingStorageKey(userID)),
    deleteStoredItem(recoveryKeyRotationMaterialStorageKey(userID)),
  ]);
}

export async function saveKeyMaterial(userID: string, keyA: Uint8Array, recoveryKey: string, envelope: KeyEnvelope): Promise<void> {
  if (keyA.length !== 32 || envelope.key_version !== 'v2') throw new Error('Invalid Master Key');
  const normalizedRecoveryKey = normalizeRecoveryMaterial(recoveryKey, envelope);
  await verifyKeyMaterial(keyA, normalizedRecoveryKey, envelope);
  await Promise.all([
    persistKeyMaterial(userID, keyA, normalizedRecoveryKey),
    saveStoredKeyEnvelope(userID, envelope),
  ]);
}

export async function saveStoredKeyA(userID: string, keyA: Uint8Array): Promise<void> {
  if (keyA.length !== 32) throw new Error('Invalid Master Key');
  await setStoredItem(keyAStorageKey(userID), toBase64URL(keyA));
}

export async function clearKeyMaterial(userID: string): Promise<void> {
	await Promise.all([
		deleteStoredItem(keyAStorageKey(userID)),
		deleteStoredItem(recoveryKeyStorageKey(userID)),
		deleteStoredItem(keyEnvelopeStorageKey(userID)),
		clearInitialKeyMaterialDraft(userID),
		clearRecoveryKeyRotationPending(userID),
		deleteDeviceStoredItem(deviceIDStorageKey(userID)),
		deleteDeviceStoredItem(deviceKeyBStorageKey(userID)),
		deleteDeviceStoredItem(deviceAgreementPrivateKeyStorageKey(userID)),
		deleteDeviceStoredItem(deviceTransferDraftStorageKey(userID)),
	]);
}

/** Removes all known app encryption secrets from this physical device. */
export async function resetDeviceEncryptionState(userID: string): Promise<void> {
  await clearKeyMaterial(userID);
}

export async function deleteAccount(session: Session): Promise<void> {
  await requestWithSession('/me', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE' }),
  }, session);
  await clearKeyMaterial(session.user_id);
}

/**
 * Recovery verification intentionally produces no normal session until a new
 * Passkey is registered. The server marks that short-lived pre-auth as a
 * recovery capability, allowing an explicit account deletion without
 * weakening ordinary session deletion to a refresh-only operation.
 */
export async function deleteAccountWithPreAuth(preAuth: PreAuth): Promise<void> {
  await request('/me', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE' }),
  }, preAuth.pre_auth_token);
  await clearKeyMaterial(preAuth.user_id);
}

export async function listKeyEnvelopes(session: Session): Promise<KeyEnvelope[]> {
  const response = await requestWithSession<EnvelopeResponse>('/me/key-envelopes', { method: 'GET' }, session);
  if (!Array.isArray(response.data) || !response.data.every(isKeyEnvelope)) {
    throw new Error('Key-A envelope response is invalid');
  }
  return response.data.map(normalizeKeyEnvelope);
}

export async function saveKeyEnvelope(session: Session, envelope: KeyEnvelope): Promise<KeyEnvelope> {
  const response = await requestWithSession<EnvelopeResponse>(`/me/key-envelopes/${encodeURIComponent(envelope.key_version)}`, {
    method: 'PUT',
    body: JSON.stringify(envelope),
  }, session);
  if (!response.data || !isKeyEnvelope(response.data)) throw new Error('Key-A envelope save response is invalid');
  const normalized = normalizeKeyEnvelope(response.data);
  await saveStoredKeyEnvelope(session.user_id, normalized);
  return normalized;
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

async function registerDeviceMaterial(
  session: Session,
  device: DeviceKeyMaterial,
  agreement?: DeviceAgreementKeyMaterial,
): Promise<DeviceResponse> {
  const response = await requestWithSession<DeviceResponse>('/me/devices', {
    method: 'POST',
    body: JSON.stringify({
      device_id: device.deviceID,
      key_version: device.keyVersion,
      public_key: devicePublicKey(device.keyB),
      ...(agreement ? {
        agreement_key_version: agreement.keyVersion,
        agreement_public_key: agreement.publicKey,
      } : {}),
    }),
  }, session);
  if (response.data?.device_id !== device.deviceID || response.data.key_version !== device.keyVersion) {
    throw new Error('Device key registration response is invalid');
  }
  if (agreement && (response.data.agreement_key_version !== agreement.keyVersion || response.data.agreement_public_key !== agreement.publicKey)) {
    throw new Error('Device agreement registration response is invalid');
  }
  return response;
}

export async function ensureDeviceKeyB(session: Session): Promise<DeviceKeyMaterial> {
	let material = await loadStoredDeviceKeyB(session.user_id);
	if (!material) material = await createDeviceKeyMaterial(session.user_id);
	try {
		await registerDeviceMaterial(session, material);
		return material;
	} catch (reason) {
		if (!(reason instanceof Error) || reason.message !== '409: device_key_mismatch') throw reason;
		// A Secure Storage restore can leave an old device ID beside a newly
		// generated key. Rotate the device identifier instead of replacing a
		// server registration with a different public key.
		material = await createDeviceKeyMaterial(session.user_id);
		await registerDeviceMaterial(session, material);
		return material;
	}
}

export async function listRegisteredDevices(session: Session): Promise<RegisteredDevice[]> {
  const response = await requestWithSession<DeviceListResponse>('/me/devices', { method: 'GET' }, session);
  if (!Array.isArray(response.data) || !response.data.every((item) => (
    item
    && typeof item.device_id === 'string'
    && typeof item.key_version === 'string'
    && typeof item.created_at === 'string'
    && typeof item.last_seen_at === 'string'
  ))) {
    throw new Error('Device list response is invalid');
  }
  return response.data;
}

export async function loadStoredDeviceAgreementKey(userID: string): Promise<DeviceAgreementKeyMaterial | null> {
  const encoded = await getDeviceStoredItem(deviceAgreementPrivateKeyStorageKey(userID));
  if (!encoded) return null;
  try {
    const privateKey = fromBase64URL(encoded);
    if (privateKey.length !== 32) return null;
    return {
      keyVersion: DEVICE_AGREEMENT_KEY_VERSION,
      privateKey,
      publicKey: deviceAgreementPublicKey(privateKey),
    };
  } catch {
    return null;
  }
}

async function saveDeviceAgreementKey(userID: string, material: DeviceAgreementKeyMaterial): Promise<void> {
  if (material.keyVersion !== DEVICE_AGREEMENT_KEY_VERSION || material.privateKey.length !== 32 || deviceAgreementPublicKey(material.privateKey) !== material.publicKey) {
    throw new Error('Invalid device agreement key');
  }
  await setDeviceStoredItem(deviceAgreementPrivateKeyStorageKey(userID), toBase64URL(material.privateKey));
}

/** Ensures the signing Key-B and the separate X25519 transfer key are both registered. */
export async function ensureDeviceAgreementKey(session: Session): Promise<DeviceKeyBundle> {
  let device = await ensureDeviceKeyB(session);
  let agreement = await loadStoredDeviceAgreementKey(session.user_id);
  if (!agreement) {
    agreement = await createDeviceAgreementKeyMaterial();
    await saveDeviceAgreementKey(session.user_id, agreement);
  }
  try {
    await registerDeviceMaterial(session, device, agreement);
    return { device, agreement };
  } catch (reason) {
    if (!(reason instanceof Error) || reason.message !== '409: device_agreement_key_mismatch') throw reason;
    // The private agreement key was lost or restored from another install.
    // Never replace the public key in place: create a new device identity.
    device = await createDeviceKeyMaterial(session.user_id);
    agreement = await createDeviceAgreementKeyMaterial();
    await saveDeviceAgreementKey(session.user_id, agreement);
    await registerDeviceMaterial(session, device, agreement);
    return { device, agreement };
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

function signedAPIPath(path: string): string {
  const base = new URL(API_BASE_URL).pathname.replace(/\/+$/u, '');
  return `${base}${path}`;
}

async function deviceRequest<T>(
  session: Session,
  device: DeviceKeyMaterial,
  method: string,
  path: string,
  body?: string,
): Promise<T> {
  const bodyBytes = body ? new TextEncoder().encode(body) : new Uint8Array();
  const proofHeaders = await createDeviceProofHeaders(session, device, method, signedAPIPath(path), bodyBytes);
  const headers: Record<string, string> = { ...proofHeaders };
  if (body) headers['Content-Type'] = 'application/json';
  return requestWithSession<T>(path, { method, headers, ...(body ? { body } : {}) }, session);
}

function isDeviceTransfer(value: unknown): value is DeviceTransfer {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DeviceTransfer>;
  return typeof candidate.id === 'string'
    && typeof candidate.target_device_id === 'string'
    && typeof candidate.target_key_version === 'string'
    && typeof candidate.target_public_key === 'string'
    && typeof candidate.target_public_key_fingerprint === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.expires_at === 'string'
    && typeof candidate.created_at === 'string';
}

function parseDeviceTransferResponse(response: DeviceTransferResponse): DeviceTransfer {
  if (!response.data || Array.isArray(response.data) || !isDeviceTransfer(response.data)) {
    throw new Error('Device transfer response is invalid');
  }
  return response.data;
}

export async function loadDeviceTransferDraft(userID: string): Promise<DeviceTransferDraft | null> {
  const stored = await getDeviceStoredItem(deviceTransferDraftStorageKey(userID));
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<DeviceTransferDraft>;
    if (typeof candidate.transferID !== 'string' || typeof candidate.verificationCode !== 'string' || typeof candidate.targetDeviceID !== 'string' || typeof candidate.createdAt !== 'string') return null;
    return candidate as DeviceTransferDraft;
  } catch {
    return null;
  }
}

/** Starts a new-device transfer. The verification code is shown only locally. */
export async function beginDeviceTransfer(session: Session): Promise<{
  transfer: DeviceTransfer;
  verificationCode: string;
  device: DeviceKeyMaterial;
  agreement: DeviceAgreementKeyMaterial;
}> {
  const bundle = await ensureDeviceAgreementKey(session);
  const verificationCode = await createDeviceTransferVerificationCode();
  const body = JSON.stringify({
    target_device_id: bundle.device.deviceID,
    target_key_version: bundle.agreement.keyVersion,
    target_public_key: bundle.agreement.publicKey,
    verification_code: verificationCode,
  });
  const response = await deviceRequest<DeviceTransferResponse>(session, bundle.device, 'POST', '/me/device-transfers', body);
  const transfer = parseDeviceTransferResponse(response);
  await setDeviceStoredItem(deviceTransferDraftStorageKey(session.user_id), JSON.stringify({
    transferID: transfer.id,
    verificationCode,
    targetDeviceID: bundle.device.deviceID,
    createdAt: transfer.created_at,
  } satisfies DeviceTransferDraft));
  return { transfer, verificationCode, device: bundle.device, agreement: bundle.agreement };
}

export async function listDeviceTransfers(session: Session): Promise<DeviceTransfer[]> {
  const device = await ensureDeviceKeyB(session);
  const response = await deviceRequest<DeviceTransferResponse>(session, device, 'GET', '/me/device-transfers');
  if (!Array.isArray(response.data) || !response.data.every(isDeviceTransfer)) throw new Error('Device transfer list response is invalid');
  return response.data;
}

/** The old device unwraps the stable root and uploads only its new-device envelope. */
export async function approveDeviceTransfer(
  session: Session,
  transfer: DeviceTransfer,
  verificationCode: string,
  masterKey: Uint8Array,
): Promise<DeviceTransfer> {
  const device = await ensureDeviceKeyB(session);
  const wrappedMasterKey = await wrapMasterKeyForDevice(
    masterKey,
    transfer.target_public_key,
    transfer.id,
    transfer.target_device_id,
  );
  const body = JSON.stringify({
    verification_code: verificationCode.trim().toUpperCase(),
    wrapped_master_key: wrappedMasterKey,
    wrapping_algorithm: DEVICE_TRANSFER_ALGORITHM,
  });
  const response = await deviceRequest<DeviceTransferResponse>(session, device, 'POST', `/me/device-transfers/${encodeURIComponent(transfer.id)}/approve`, body);
  return parseDeviceTransferResponse(response);
}

export async function getDeviceTransferForTarget(session: Session, transferID: string): Promise<DeviceTransfer> {
  const bundle = await ensureDeviceAgreementKey(session);
  const response = await deviceRequest<DeviceTransferResponse>(session, bundle.device, 'GET', `/me/device-transfers/${encodeURIComponent(transferID)}`);
  return parseDeviceTransferResponse(response);
}

/** Cancels the target device's pending or approved transfer request. */
export async function cancelDeviceTransfer(session: Session, transferID: string): Promise<void> {
  const device = await ensureDeviceKeyB(session);
  await deviceRequest<unknown>(session, device, 'DELETE', `/me/device-transfers/${encodeURIComponent(transferID)}`);
  await deleteDeviceStoredItem(deviceTransferDraftStorageKey(session.user_id));
}

export async function completeDeviceTransfer(session: Session, transferID: string): Promise<void> {
  const bundle = await ensureDeviceAgreementKey(session);
  await deviceRequest<unknown>(session, bundle.device, 'POST', `/me/device-transfers/${encodeURIComponent(transferID)}/complete`);
}

/** Accepts the target envelope, persists the root locally, then acknowledges it. */
export async function acceptDeviceTransfer(session: Session, transferID: string): Promise<Uint8Array> {
  const bundle = await ensureDeviceAgreementKey(session);
  const transfer = await getDeviceTransferForTarget(session, transferID);
  if ((transfer.status !== 'approved' && transfer.status !== 'completed') || !transfer.wrapped_master_key || transfer.wrapping_algorithm !== DEVICE_TRANSFER_ALGORITHM) {
    throw new Error('この端末への鍵移行はまだ承認されていません。');
  }
  const masterKey = unwrapMasterKeyForDevice(transfer.wrapped_master_key, bundle.agreement.privateKey, transfer.id, bundle.device.deviceID);
  await saveStoredKeyA(session.user_id, masterKey);
  if (transfer.status === 'approved') await completeDeviceTransfer(session, transfer.id);
  await deleteDeviceStoredItem(deviceTransferDraftStorageKey(session.user_id));
  return masterKey;
}

export async function deriveCurrentDataKey(session: Session, envelope: KeyEnvelope): Promise<Uint8Array> {
  const keyA = await loadStoredKeyA(session.user_id);
  if (!keyA) throw new Error('Key-A is not available on this device');
	return deriveAccountDataKey(keyA, envelope.kdf_params.data_salt);
}

export async function createInitialKeyMaterial(): Promise<GeneratedKeyMaterial> {
  return createKeyMaterial();
}

export async function completeInitialKeySetup(session: Session, material: GeneratedKeyMaterial): Promise<void> {
  const normalizedRecoveryKey = await ensureKeyMaterialVerified(material);
  await saveKeyEnvelope(session, material.envelope);
  await persistKeyMaterial(session.user_id, material.keyA, normalizedRecoveryKey);
  await clearInitialKeyMaterialDraft(session.user_id);
}

/**
 * Prepares a Recovery Phrase rotation without changing the Master Key or data-key
 * salt. The returned material must not be sent to the server until the user
 * has confirmed that the newly displayed key was saved.
 */
export async function prepareRecoveryKeyRotation(
  session: Session,
  onStage?: (stage: Exclude<RecoveryRotationStage, 'saving'>) => void,
): Promise<GeneratedKeyMaterial> {
  onStage?.('loading_key_a');
  const keyA = await loadStoredKeyA(session.user_id);
  if (!keyA) throw new Error('この端末に暗号鍵がありません。先にRecovery Phraseで復旧してください。');

  onStage?.('loading_envelope');
  const envelopes = await listKeyEnvelopes(session);
  const envelope = envelopes.find((item) => item.recovery_public_key.length > 0) ?? envelopes[0];
  if (!envelope) throw new Error('このアカウントにはRecovery Phraseが登録されていません。');

  onStage?.('generating');
  const material = await createRecoveryMaterial(keyA, envelope);
  await savePendingRecoveryKeyRotation(session.user_id, material);
  return material;
}

export async function completeRecoveryKeyRotation(
  session: Session,
  material: GeneratedKeyMaterial,
  onStage?: (stage: 'saving') => void,
): Promise<void> {
  onStage?.('saving');
  const normalizedRecoveryKey = await ensureKeyMaterialVerified(material);
  await saveKeyEnvelope(session, material.envelope);
  await persistKeyMaterial(session.user_id, material.keyA, normalizedRecoveryKey);
  await clearRecoveryKeyRotationPending(session.user_id);
}

export async function beginRecovery(token: string, session?: Session): Promise<RecoveryChallenge> {
  let response: RecoveryChallengeResponse;
  try {
    response = session
      ? await requestWithSession<RecoveryChallengeResponse>('/auth/recovery/challenge', { method: 'POST' }, session)
      : await request<RecoveryChallengeResponse>('/auth/recovery/challenge', { method: 'POST' }, token);
  } catch (reason) {
    if (reason instanceof Error && reason.message === '429: recovery_rate_limited') {
      throw new Error(RECOVERY_RATE_LIMITED_MESSAGE);
    }
    if (reason instanceof Error && (reason.message === '409: recovery_not_configured' || reason.message === '404: recovery_material_not_found')) {
      throw new Error('このアカウントにはRecovery Phraseが登録されていません。Passkey認証後に新しいRecovery Phraseを登録してください。');
    }
    if (reason instanceof Error && reason.message === '401: recovery_challenge_failed') {
      throw new Error('Recovery Phraseを確認できませんでした。本人確認状態を確認してから、もう一度お試しください。');
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
    normalizedRecoveryKey = normalizeRecoveryMaterial(recoveryKey, challenge.envelope);
    keyA = await recoverKeyAAsync(normalizedRecoveryKey, challenge.envelope);
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
  // The original Google pre-auth has just been consumed on the server. Save
  // the newly-issued registration capability before any UI transition so a
  // Fast Refresh or process death cannot resurrect the consumed login token
  // and turn the next attempt into a guaranteed 401.
  await persistPreAuth(response.data);
  await persistKeyMaterial(preAuth.user_id, keyA, normalizedRecoveryKey);
  await markRecoveryKeyRotationPending(preAuth.user_id);
  recoveryClientAttempts.delete(preAuth.user_id);
  return response.data;
}

export async function recoverWithSession(session: Session, recoveryKey: string): Promise<void> {
  enforceClientRecoveryLimit(session.user_id);
  const challenge = await beginRecovery(session.access_token, session);
  let normalizedRecoveryKey: string;
  let keyA: Uint8Array;
  try {
    normalizedRecoveryKey = normalizeRecoveryMaterial(recoveryKey, challenge.envelope);
    keyA = await recoverKeyAAsync(normalizedRecoveryKey, challenge.envelope);
    if (recoveryPublicKey(keyA) !== challenge.envelope.recovery_public_key) throw new Error('recovery key mismatch');
  } catch {
    await reportInvalidRecoveryProof(session.access_token, challenge, session);
    throw new Error(INVALID_RECOVERY_KEY_MESSAGE);
  }

  try {
    await requestWithSession('/auth/recovery/verify', {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        challenge: challenge.challenge,
        key_version: challenge.envelope.key_version,
        signature: signRecoveryProof(keyA, session.user_id, challenge.envelope.key_version, challenge.challenge),
      }),
    }, session);
  } catch (reason) {
    throw mapRecoveryVerificationError(reason);
  }
  await persistKeyMaterial(session.user_id, keyA, normalizedRecoveryKey);
  await markRecoveryKeyRotationPending(session.user_id);
  recoveryClientAttempts.delete(session.user_id);
}

function normalizeRecoveryMaterial(value: string, envelope: KeyEnvelope): string {
  if (envelope.key_version !== 'v2' || envelope.kdf_params.algorithm !== 'Argon2id+HKDF-SHA256') {
    throw new Error(INVALID_RECOVERY_KEY_MESSAGE);
  }
  try {
    return normalizeRecoveryPhrase(value);
  } catch {
    throw new Error(INVALID_RECOVERY_KEY_MESSAGE);
  }
}

function enforceClientRecoveryLimit(userID: string): void {
  const current = Date.now();
  const previous = recoveryClientAttempts.get(userID);
  const state = !previous || current - previous.windowStartedAt >= RECOVERY_CLIENT_WINDOW_MS
    ? { attempts: 0, lastAttemptAt: 0, windowStartedAt: current }
    : previous;
  if (state.attempts >= RECOVERY_CLIENT_MAX_ATTEMPTS) throw new Error(RECOVERY_RATE_LIMITED_MESSAGE);
  if (state.lastAttemptAt > 0 && current - state.lastAttemptAt < RECOVERY_CLIENT_MIN_INTERVAL_MS) {
    throw new Error('少し待ってからRecovery Phraseを再試行してください。');
  }
  state.attempts += 1;
  state.lastAttemptAt = current;
  recoveryClientAttempts.set(userID, state);
}

async function reportInvalidRecoveryProof(token: string, challenge: RecoveryChallenge, session?: Session): Promise<void> {
  try {
    const init: RequestInit = {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        challenge: challenge.challenge,
        key_version: challenge.envelope.key_version,
        // The local unwrap failed, so send a deliberately invalid, correctly
        // shaped proof to consume the server-side challenge attempt.
        signature: toBase64URL(await randomBytes(64)),
      }),
    };
    if (session) await requestWithSession('/auth/recovery/verify', init, session);
    else await request('/auth/recovery/verify', init, token);
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
  return reason instanceof Error ? reason : new Error('Recovery Phraseの確認に失敗しました。');
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
