import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export const KEY_VERSION = 'v1';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const RECOVERY_INFO = utf8ToBytes('samurai-meet/recovery-key/v1');

export type KeyEnvelope = {
  key_version: string;
  encrypted_key_a: string;
  nonce: string;
  kdf_params: { algorithm: 'HKDF-SHA256'; salt: string; info: string };
};

export type RandomBytes = (length: number) => Promise<Uint8Array>;

export async function createKeyMaterial(randomBytes: RandomBytes = expoRandomBytes) {
  const keyA = await randomBytes(KEY_BYTES);
  const recoveryBytes = await randomBytes(KEY_BYTES);
  const salt = await randomBytes(SALT_BYTES);
  const nonce = await randomBytes(NONCE_BYTES);
  const recoveryKey = toBase64URL(recoveryBytes);
  const derived = hkdf(sha256, recoveryBytes, salt, RECOVERY_INFO, KEY_BYTES);
  const encryptedKeyA = gcm(derived, nonce).encrypt(keyA);
  return {
    keyA,
    recoveryKey,
    envelope: {
      key_version: KEY_VERSION,
      encrypted_key_a: toBase64URL(encryptedKeyA),
      nonce: toBase64URL(nonce),
      kdf_params: { algorithm: 'HKDF-SHA256' as const, salt: toBase64URL(salt), info: toBase64URL(RECOVERY_INFO) },
    },
  };
}

export function recoverKeyA(recoveryKey: string, envelope: KeyEnvelope): Uint8Array {
  if (envelope.key_version !== KEY_VERSION || envelope.kdf_params.algorithm !== 'HKDF-SHA256') throw new Error('Unsupported Key-A envelope');
  const recoveryBytes = fromBase64URL(recoveryKey);
  const salt = fromBase64URL(envelope.kdf_params.salt);
  const nonce = fromBase64URL(envelope.nonce);
  const info = fromBase64URL(envelope.kdf_params.info);
  const encryptedKeyA = fromBase64URL(envelope.encrypted_key_a);
  if (recoveryBytes.length !== KEY_BYTES || salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || info.length === 0) throw new Error('Invalid Key-A envelope');
  return gcm(hkdf(sha256, recoveryBytes, salt, info, KEY_BYTES), nonce).decrypt(encryptedKeyA);
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

async function expoRandomBytes(length: number): Promise<Uint8Array> {
  const Crypto = await import('expo-crypto');
  return Crypto.getRandomBytesAsync(length);
}
