import { gcm } from '@noble/ciphers/aes.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export const KEY_VERSION = 'v1';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const RECOVERY_INFO_TEXT = 'samurai-meet/recovery-key/v1';
const DATA_KEY_INFO = utf8ToBytes('samurai-meet/data-key/v1');
const RECOVERY_PROOF_DOMAIN = 'samurai-meet/recovery-proof/v1';
const DEVICE_PROOF_DOMAIN = 'samurai-meet:device-proof/v1';
const IMAGE_KEY_WRAP_INFO = utf8ToBytes('samurai-meet/image-key-wrap/v1');
const IMAGE_KEY_WRAP_DOMAIN = 'samurai-meet:image-key-wrap/v1';
const RECOVERY_INFO = utf8ToBytes(RECOVERY_INFO_TEXT);

export type RecoveryKDFParams = {
  algorithm: 'HKDF-SHA256';
  salt: string;
  info: string;
  data_salt: string;
};

export type KeyEnvelope = {
  key_version: string;
  encrypted_key_a: string;
  nonce: string;
  kdf_params: RecoveryKDFParams;
  recovery_public_key: string;
};

export type RandomBytes = (length: number) => Promise<Uint8Array>;

export type EncryptedPhotoMaterial = {
  ciphertext: Uint8Array;
  nonce: string;
  keyVersion: string;
  deviceWrappedImageKey: string;
  accountWrappedImageKey: string;
  wrappingAlgorithm: string;
};

export async function randomBytes(length: number): Promise<Uint8Array> {
  return expoRandomBytes(length);
}

export async function createKeyMaterial(randomBytes: RandomBytes = expoRandomBytes) {
  const keyA = await randomBytes(KEY_BYTES);
  const salt = await randomBytes(SALT_BYTES);
  const dataSalt = await randomBytes(SALT_BYTES);
  return wrapKeyA(keyA, KEY_VERSION, dataSalt, randomBytes, salt);
}

/**
 * Creates a new Recovery Key without rotating Key-A or the data-key salt.
 * Existing encrypted application data therefore remains decryptable.
 */
export async function createRecoveryKeyMaterial(
  keyA: Uint8Array,
  envelope: KeyEnvelope,
  randomBytes: RandomBytes = expoRandomBytes,
) {
  if (
    keyA.length !== KEY_BYTES
    || envelope.key_version !== KEY_VERSION
    || envelope.kdf_params.algorithm !== 'HKDF-SHA256'
    || envelope.kdf_params.info !== toBase64URL(RECOVERY_INFO)
  ) throw new Error('Unsupported Key-A envelope');

  const dataSalt = fromBase64URL(envelope.kdf_params.data_salt);
  if (dataSalt.length !== SALT_BYTES) throw new Error('Invalid data key salt');
  return wrapKeyA(keyA, envelope.key_version, dataSalt, randomBytes);
}

export function recoverKeyA(recoveryKey: string, envelope: KeyEnvelope): Uint8Array {
  if (
    envelope.key_version !== KEY_VERSION
    || envelope.kdf_params.algorithm !== 'HKDF-SHA256'
    || envelope.kdf_params.info !== toBase64URL(RECOVERY_INFO)
  ) throw new Error('Unsupported Key-A envelope');
  const recoveryBytes = fromBase64URL(recoveryKey);
  const salt = fromBase64URL(envelope.kdf_params.salt);
  const nonce = fromBase64URL(envelope.nonce);
  const info = fromBase64URL(envelope.kdf_params.info);
  const encryptedKeyA = fromBase64URL(envelope.encrypted_key_a);
  const dataSalt = fromBase64URL(envelope.kdf_params.data_salt);
  if (
    recoveryBytes.length !== KEY_BYTES
    || salt.length !== SALT_BYTES
    || dataSalt.length !== SALT_BYTES
    || nonce.length !== NONCE_BYTES
    || info.length === 0
    || fromBase64URL(envelope.recovery_public_key).length !== KEY_BYTES
  ) throw new Error('Invalid Key-A envelope');
  const keyA = gcm(hkdf(sha256, recoveryBytes, salt, info, KEY_BYTES), nonce, recoveryEnvelopeAAD(envelope.key_version, salt, dataSalt)).decrypt(encryptedKeyA);
  if (!constantTimeEqual(ed25519.getPublicKey(keyA), fromBase64URL(envelope.recovery_public_key))) {
    throw new Error('Recovery public key does not match Key-A');
  }
  return keyA;
}

export function deriveDataKey(keyA: Uint8Array, keyB: Uint8Array, dataSalt: string): Uint8Array {
  if (keyA.length !== KEY_BYTES || keyB.length !== KEY_BYTES) throw new Error('Invalid data key material');
  const salt = fromBase64URL(dataSalt);
  if (salt.length !== SALT_BYTES) throw new Error('Invalid data key salt');
  const input = new Uint8Array(KEY_BYTES * 2);
  input.set(keyA, 0);
  input.set(keyB, KEY_BYTES);
  return hkdf(sha256, input, salt, DATA_KEY_INFO, KEY_BYTES);
}

export function deriveAccountImageWrappingKey(keyA: Uint8Array, dataSalt: string): Uint8Array {
  if (keyA.length !== KEY_BYTES) throw new Error('Invalid Key-A');
  const salt = fromBase64URL(dataSalt);
  if (salt.length !== SALT_BYTES) throw new Error('Invalid data key salt');
  return hkdf(sha256, keyA, salt, IMAGE_KEY_WRAP_INFO, KEY_BYTES);
}

export function devicePublicKey(keyB: Uint8Array): string {
  if (keyB.length !== KEY_BYTES) throw new Error('Invalid Key-B');
  return toBase64URL(ed25519.getPublicKey(keyB));
}

export function hashBytes(value: Uint8Array): string {
  return toBase64URL(sha256(value));
}

export async function encryptPhotoBytes(
  plaintext: Uint8Array,
  keyA: Uint8Array,
  keyB: Uint8Array,
  dataSalt: string,
  deviceID: string,
  randomBytes: RandomBytes = expoRandomBytes,
): Promise<EncryptedPhotoMaterial> {
  if (keyA.length !== KEY_BYTES || keyB.length !== KEY_BYTES || !deviceID) throw new Error('Invalid image key material');
  const imageKey = await randomBytes(KEY_BYTES);
  const nonce = await randomBytes(NONCE_BYTES);
  const ciphertext = gcm(imageKey, nonce).encrypt(plaintext);
  const accountKey = deriveAccountImageWrappingKey(keyA, dataSalt);
  const [deviceWrappedImageKey, accountWrappedImageKey] = await Promise.all([
    wrapImageKey(imageKey, keyB, `${IMAGE_KEY_WRAP_DOMAIN}\ndevice\n${deviceID}`, randomBytes),
    wrapImageKey(imageKey, accountKey, `${IMAGE_KEY_WRAP_DOMAIN}\naccount\n${dataSalt}`, randomBytes),
  ]);
  return {
    ciphertext,
    nonce: toBase64URL(nonce),
    keyVersion: KEY_VERSION,
    deviceWrappedImageKey,
    accountWrappedImageKey,
    wrappingAlgorithm: 'KEY-A-AES-GCM+KEY-B-AES-GCM',
  };
}

export function decryptPhotoBytes(ciphertext: Uint8Array, nonceEncoded: string, imageKey: Uint8Array): Uint8Array {
  if (imageKey.length !== KEY_BYTES) throw new Error('Invalid image key');
  const nonce = fromBase64URL(nonceEncoded);
  if (nonce.length !== NONCE_BYTES) throw new Error('Invalid image nonce');
  return gcm(imageKey, nonce).decrypt(ciphertext);
}

export function unwrapPhotoKey(wrappedImageKey: string, wrappingKey: Uint8Array, aadText: string): Uint8Array {
  if (wrappingKey.length !== KEY_BYTES) throw new Error('Invalid wrapping key');
  const sealed = fromBase64URL(wrappedImageKey);
  if (sealed.length <= NONCE_BYTES) throw new Error('Invalid wrapped image key');
  const nonce = sealed.slice(0, NONCE_BYTES);
  return gcm(wrappingKey, nonce, utf8ToBytes(aadText)).decrypt(sealed.slice(NONCE_BYTES));
}

export async function wrapPhotoKeyForDevice(
  imageKey: Uint8Array,
  keyB: Uint8Array,
  deviceID: string,
  randomBytes: RandomBytes = expoRandomBytes,
): Promise<string> {
  return wrapImageKey(imageKey, keyB, `${IMAGE_KEY_WRAP_DOMAIN}\ndevice\n${deviceID}`, randomBytes);
}

export function unwrapPhotoKeyWithAccount(imageWrappedKey: string, keyA: Uint8Array, dataSalt: string): Uint8Array {
  return unwrapPhotoKey(imageWrappedKey, deriveAccountImageWrappingKey(keyA, dataSalt), `${IMAGE_KEY_WRAP_DOMAIN}\naccount\n${dataSalt}`);
}

export function signDeviceProof(keyB: Uint8Array, userID: string, deviceID: string, method: string, path: string, timestamp: string, nonce: string, bodyHash: string): string {
  if (keyB.length !== KEY_BYTES) throw new Error('Invalid Key-B');
  const message = `${DEVICE_PROOF_DOMAIN}\n${userID}\n${deviceID}\n${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  return toBase64URL(ed25519.sign(utf8ToBytes(message), keyB));
}

export function recoveryProofMessage(userID: string, keyVersion: string, challenge: string): Uint8Array {
  return utf8ToBytes(`${RECOVERY_PROOF_DOMAIN}\n${userID}\n${keyVersion}\n${challenge}`);
}

export function signRecoveryProof(keyA: Uint8Array, userID: string, keyVersion: string, challenge: string): string {
  if (keyA.length !== KEY_BYTES) throw new Error('Invalid Key-A');
  return toBase64URL(ed25519.sign(recoveryProofMessage(userID, keyVersion, challenge), keyA));
}

export function recoveryPublicKey(keyA: Uint8Array): string {
  if (keyA.length !== KEY_BYTES) throw new Error('Invalid Key-A');
  return toBase64URL(ed25519.getPublicKey(keyA));
}

export function toBase64URL(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function fromBase64URL(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid Base64URL value');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function recoveryEnvelopeAAD(keyVersion: string, salt: Uint8Array, dataSalt: Uint8Array): Uint8Array {
  return utf8ToBytes(`samurai-meet:key-a-envelope/v1\n${keyVersion}\n${toBase64URL(salt)}\n${toBase64URL(dataSalt)}`);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function expoRandomBytes(length: number): Promise<Uint8Array> {
  const Crypto = await import('expo-crypto');
  return Crypto.getRandomBytesAsync(length);
}

async function wrapImageKey(
  imageKey: Uint8Array,
  wrappingKey: Uint8Array,
  aadText: string,
  randomBytes: RandomBytes,
): Promise<string> {
  if (imageKey.length !== KEY_BYTES || wrappingKey.length !== KEY_BYTES) throw new Error('Invalid image key material');
  const nonce = await randomBytes(NONCE_BYTES);
  const encrypted = gcm(wrappingKey, nonce, utf8ToBytes(aadText)).encrypt(imageKey);
  const sealed = new Uint8Array(nonce.length + encrypted.length);
  sealed.set(nonce, 0);
  sealed.set(encrypted, nonce.length);
  return toBase64URL(sealed);
}

async function wrapKeyA(
  keyA: Uint8Array,
  keyVersion: string,
  dataSalt: Uint8Array,
  randomBytes: RandomBytes,
  salt?: Uint8Array,
) {
  const envelopeSalt = salt ?? await randomBytes(SALT_BYTES);
  const recoveryBytes = await randomBytes(KEY_BYTES);
  const nonce = await randomBytes(NONCE_BYTES);
  const recoveryKey = toBase64URL(recoveryBytes);
  const derived = hkdf(sha256, recoveryBytes, envelopeSalt, RECOVERY_INFO, KEY_BYTES);
  const encryptedKeyA = gcm(derived, nonce, recoveryEnvelopeAAD(keyVersion, envelopeSalt, dataSalt)).encrypt(keyA);
  return {
    keyA,
    recoveryKey,
    envelope: {
      key_version: keyVersion,
      encrypted_key_a: toBase64URL(encryptedKeyA),
      nonce: toBase64URL(nonce),
      kdf_params: {
        algorithm: 'HKDF-SHA256' as const,
        salt: toBase64URL(envelopeSalt),
        info: toBase64URL(RECOVERY_INFO),
        data_salt: toBase64URL(dataSalt),
      },
      recovery_public_key: toBase64URL(ed25519.getPublicKey(keyA)),
    },
  };
}
