import { gcm } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

// The API path remains /api/v1 for now, but the client-owned root-key
// protocol is intentionally v2-only. There is no legacy recovery fallback.
export const KEY_VERSION = 'v2';
export const DEVICE_AGREEMENT_KEY_VERSION = 'x25519-v1';
export const DEVICE_TRANSFER_ALGORITHM = 'X25519-HKDF-SHA256-AES-256-GCM';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const RECOVERY_PHRASE_INFO_TEXT = 'samurai-meet/recovery-phrase/v2';
const RECOVERY_PROOF_DOMAIN = 'samurai-meet/recovery-proof/v2';
const DEVICE_PROOF_DOMAIN = 'samurai-meet:device-proof/v1';
const IMAGE_KEY_WRAP_INFO = utf8ToBytes('samurai-meet/image-key-wrap/v1');
const IMAGE_KEY_WRAP_DOMAIN = 'samurai-meet:image-key-wrap/v1';
const RECOVERY_PHRASE_INFO = utf8ToBytes(RECOVERY_PHRASE_INFO_TEXT);
const DEVICE_TRANSFER_INFO = utf8ToBytes('samurai-meet/device-transfer/v1');
export const ARGON2ID_DEFAULTS = {
  memory_kib: 32 * 1024,
  iterations: 3,
  parallelism: 1,
} as const;

export type RecoveryKDFImplementation = 'native' | 'javascript';

export type Argon2idParams = {
  memory_kib: number;
  iterations: number;
  parallelism: number;
};

export type RecoveryKDFParams = {
  algorithm: 'Argon2id+HKDF-SHA256';
  salt: string;
  info: string;
  data_salt: string;
  argon2id: Argon2idParams;
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

export async function createKeyMaterial(
  randomBytes: RandomBytes = expoRandomBytes,
  argon2id: Argon2idParams = ARGON2ID_DEFAULTS,
) {
  return createKeyMaterialV2(randomBytes, argon2id);
}
/**
 * Creates the v2 root envelope. The returned `recoveryKey` field is retained
 * for the existing UI contract; in v2 it contains the 24-word Recovery
 * Phrase. The phrase is derived from 256 bits of local entropy and is never
 * sent to the API.
 */
export async function createKeyMaterialV2(
  randomBytes: RandomBytes = expoRandomBytes,
  argon2id: Argon2idParams = ARGON2ID_DEFAULTS,
) {
  const keyA = await randomBytes(KEY_BYTES);
  const salt = await randomBytes(SALT_BYTES);
  const dataSalt = await randomBytes(SALT_BYTES);
  const entropy = await randomBytes(KEY_BYTES);
  const nonce = await randomBytes(NONCE_BYTES);
  const phrase = entropyToMnemonic(entropy, wordlist);
  const wrappingKey = await deriveRecoveryPhraseWrappingKey(phrase, salt, argon2id);
  const encryptedKeyA = gcm(wrappingKey, nonce, recoveryPhraseEnvelopeAAD(KEY_VERSION, salt, dataSalt)).encrypt(keyA);
  const envelope: KeyEnvelope = {
    key_version: KEY_VERSION,
    encrypted_key_a: toBase64URL(encryptedKeyA),
    nonce: toBase64URL(nonce),
    kdf_params: {
      algorithm: 'Argon2id+HKDF-SHA256',
      salt: toBase64URL(salt),
      info: toBase64URL(RECOVERY_PHRASE_INFO),
      data_salt: toBase64URL(dataSalt),
      argon2id,
    },
    recovery_public_key: toBase64URL(ed25519.getPublicKey(keyA)),
  };
  return { keyA, recoveryKey: phrase, recoveryPhrase: phrase, envelope, kdfVerified: true as const };
}

/** Creates a new v2 phrase envelope without changing the stable root key. */
export async function createRecoveryPhraseMaterial(
  keyA: Uint8Array,
  envelope: KeyEnvelope,
  randomBytes: RandomBytes = expoRandomBytes,
) {
  if (keyA.length !== KEY_BYTES || envelope.key_version !== KEY_VERSION || envelope.kdf_params.algorithm !== 'Argon2id+HKDF-SHA256') {
    throw new Error('Unsupported v2 root envelope');
  }
  const dataSalt = fromBase64URL(envelope.kdf_params.data_salt);
  const argon2id = envelope.kdf_params.argon2id;
  if (dataSalt.length !== SALT_BYTES || !argon2id) throw new Error('Invalid v2 root envelope');
  const salt = await randomBytes(SALT_BYTES);
  const entropy = await randomBytes(KEY_BYTES);
  const nonce = await randomBytes(NONCE_BYTES);
  const phrase = entropyToMnemonic(entropy, wordlist);
  const wrappingKey = await deriveRecoveryPhraseWrappingKey(phrase, salt, argon2id);
  const encryptedKeyA = gcm(wrappingKey, nonce, recoveryPhraseEnvelopeAAD(KEY_VERSION, salt, dataSalt)).encrypt(keyA);
  const nextEnvelope: KeyEnvelope = {
    key_version: KEY_VERSION,
    encrypted_key_a: toBase64URL(encryptedKeyA),
    nonce: toBase64URL(nonce),
    kdf_params: {
      algorithm: 'Argon2id+HKDF-SHA256',
      salt: toBase64URL(salt),
      info: toBase64URL(RECOVERY_PHRASE_INFO),
      data_salt: toBase64URL(dataSalt),
      argon2id,
    },
    recovery_public_key: toBase64URL(ed25519.getPublicKey(keyA)),
  };
  return { keyA, recoveryKey: phrase, recoveryPhrase: phrase, envelope: nextEnvelope, kdfVerified: true as const };
}

export async function createRecoveryMaterial(
  keyA: Uint8Array,
  envelope: KeyEnvelope,
  randomBytes: RandomBytes = expoRandomBytes,
) {
  return createRecoveryPhraseMaterial(keyA, envelope, randomBytes);
}

/** Argon2id recovery is intentionally kept off the synchronous UI path. */
export async function recoverKeyAAsync(recoveryMaterial: string, envelope: KeyEnvelope): Promise<Uint8Array> {
  if (envelope.key_version !== KEY_VERSION || envelope.kdf_params.algorithm !== 'Argon2id+HKDF-SHA256') {
    throw new Error('Unsupported root envelope');
  }
  const phrase = normalizeRecoveryPhrase(recoveryMaterial);
  const entropy = mnemonicToEntropy(phrase, wordlist);
  const salt = fromBase64URL(envelope.kdf_params.salt);
  const nonce = fromBase64URL(envelope.nonce);
  const dataSalt = fromBase64URL(envelope.kdf_params.data_salt);
  const encryptedKeyA = fromBase64URL(envelope.encrypted_key_a);
  const publicKey = fromBase64URL(envelope.recovery_public_key);
  if (entropy.length !== KEY_BYTES || salt.length !== SALT_BYTES || dataSalt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || publicKey.length !== KEY_BYTES || encryptedKeyA.length < KEY_BYTES + 16) {
    throw new Error('Invalid v2 root envelope');
  }
  const wrappingKey = await deriveRecoveryPhraseWrappingKey(phrase, salt, envelope.kdf_params.argon2id);
  const keyA = gcm(wrappingKey, nonce, recoveryPhraseEnvelopeAAD(KEY_VERSION, salt, dataSalt)).decrypt(encryptedKeyA);
  if (!constantTimeEqual(ed25519.getPublicKey(keyA), publicKey)) throw new Error('Recovery public key does not match root key');
  return keyA;
}

export function normalizeRecoveryPhrase(value: string): string {
  const phrase = canonicalizeRecoveryPhrase(value);
  if (phrase.split(' ').length !== 24 || !validateMnemonic(phrase, wordlist)) throw new Error('Invalid Recovery Phrase');
  return phrase;
}

/**
 * Keeps clipboard formatting harmless without accepting punctuation or
 * changing the BIP39 word list. The generated phrase itself is still
 * validated by normalizeRecoveryPhrase before it is used for recovery.
 */
export function canonicalizeRecoveryPhrase(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .trim()
    .split(/\s+/u)
    .join(' ')
    .toLowerCase();
}

export function recoveryPhraseMatches(expected: string, entered: string): boolean {
  return canonicalizeRecoveryPhrase(expected) === canonicalizeRecoveryPhrase(entered);
}

/** Stable v2 account-root derivation. Key-B is deliberately not an input. */
export function deriveAccountDataKey(masterKey: Uint8Array, dataSalt: string): Uint8Array {
  if (masterKey.length !== KEY_BYTES) throw new Error('Invalid Master Key');
  const salt = fromBase64URL(dataSalt);
  if (salt.length !== SALT_BYTES) throw new Error('Invalid data key salt');
  return hkdf(sha256, masterKey, salt, utf8ToBytes('samurai-meet/account-root/v2'), KEY_BYTES);
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

export type DeviceAgreementKeyMaterial = {
  keyVersion: typeof DEVICE_AGREEMENT_KEY_VERSION;
  privateKey: Uint8Array;
  publicKey: string;
};

export async function createDeviceAgreementKeyMaterial(
  randomBytes: RandomBytes = expoRandomBytes,
): Promise<DeviceAgreementKeyMaterial> {
  const privateKey = await randomBytes(KEY_BYTES);
  return {
    keyVersion: DEVICE_AGREEMENT_KEY_VERSION,
    privateKey,
    publicKey: toBase64URL(x25519.getPublicKey(privateKey)),
  };
}

export function deviceAgreementPublicKey(privateKey: Uint8Array): string {
  if (privateKey.length !== KEY_BYTES) throw new Error('Invalid device agreement key');
  return toBase64URL(x25519.getPublicKey(privateKey));
}

export function publicKeyFingerprint(publicKey: string): string {
  const decoded = fromBase64URL(publicKey);
  if (decoded.length !== KEY_BYTES) throw new Error('Invalid public key');
  return toBase64URL(sha256(decoded));
}

export async function createDeviceTransferVerificationCode(
  randomBytes: RandomBytes = expoRandomBytes,
): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const result: string[] = [];
  while (result.length < 8) {
    const bytes = await randomBytes(16);
    for (const byte of bytes) {
      if (byte >= 224) continue;
      result.push(alphabet[byte % alphabet.length] ?? 'A');
      if (result.length === 8) break;
    }
  }
  return result.join('');
}

export async function wrapMasterKeyForDevice(
  masterKey: Uint8Array,
  targetPublicKey: string,
  transferID: string,
  targetDeviceID: string,
  randomBytes: RandomBytes = expoRandomBytes,
): Promise<string> {
  if (masterKey.length !== KEY_BYTES || !transferID || !targetDeviceID) throw new Error('Invalid device transfer');
  const recipientPublicKey = fromBase64URL(targetPublicKey);
  if (recipientPublicKey.length !== KEY_BYTES) throw new Error('Invalid target agreement key');
  const ephemeralPrivateKey = await randomBytes(KEY_BYTES);
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, recipientPublicKey);
  const salt = sha256(deviceTransferBinding(transferID, targetDeviceID, toBase64URL(recipientPublicKey)));
  const wrappingKey = hkdf(sha256, sharedSecret, salt, DEVICE_TRANSFER_INFO, KEY_BYTES);
  const nonce = await randomBytes(NONCE_BYTES);
  const aad = deviceTransferAAD(transferID, targetDeviceID, toBase64URL(ephemeralPublicKey), toBase64URL(recipientPublicKey));
  const ciphertext = gcm(wrappingKey, nonce, aad).encrypt(masterKey);
  return toBase64URL(utf8ToBytes(JSON.stringify({
    algorithm: DEVICE_TRANSFER_ALGORITHM,
    version: 1,
    transfer_id: transferID,
    target_device_id: targetDeviceID,
    ephemeral_public_key: toBase64URL(ephemeralPublicKey),
    recipient_public_key: toBase64URL(recipientPublicKey),
    nonce: toBase64URL(nonce),
    ciphertext: toBase64URL(ciphertext),
  })));
}

export function unwrapMasterKeyForDevice(
  wrappedMasterKey: string,
  privateKey: Uint8Array,
  transferID: string,
  targetDeviceID: string,
): Uint8Array {
  if (privateKey.length !== KEY_BYTES || !transferID || !targetDeviceID) throw new Error('Invalid device transfer');
  const raw = fromBase64URL(wrappedMasterKey);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid wrapped Master Key');
  const envelope = parsed as {
    algorithm?: unknown;
    version?: unknown;
    transfer_id?: unknown;
    target_device_id?: unknown;
    ephemeral_public_key?: unknown;
    recipient_public_key?: unknown;
    nonce?: unknown;
    ciphertext?: unknown;
  };
  if (envelope.algorithm !== DEVICE_TRANSFER_ALGORITHM || envelope.version !== 1 || envelope.transfer_id !== transferID || envelope.target_device_id !== targetDeviceID || typeof envelope.ephemeral_public_key !== 'string' || typeof envelope.recipient_public_key !== 'string' || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string') throw new Error('Invalid wrapped Master Key');
  const ephemeralPublicKey = fromBase64URL(envelope.ephemeral_public_key);
  const recipientPublicKey = fromBase64URL(envelope.recipient_public_key);
  const nonce = fromBase64URL(envelope.nonce);
  const ciphertext = fromBase64URL(envelope.ciphertext);
  const expectedPublicKey = x25519.getPublicKey(privateKey);
  if (ephemeralPublicKey.length !== KEY_BYTES || recipientPublicKey.length !== KEY_BYTES || nonce.length !== NONCE_BYTES || ciphertext.length < KEY_BYTES + 16 || !constantTimeEqual(recipientPublicKey, expectedPublicKey)) throw new Error('Invalid wrapped Master Key');
  const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPublicKey);
  const recipientEncoded = toBase64URL(recipientPublicKey);
  const salt = sha256(deviceTransferBinding(transferID, targetDeviceID, recipientEncoded));
  const wrappingKey = hkdf(sha256, sharedSecret, salt, DEVICE_TRANSFER_INFO, KEY_BYTES);
  return gcm(wrappingKey, nonce, deviceTransferAAD(transferID, targetDeviceID, envelope.ephemeral_public_key, recipientEncoded)).decrypt(ciphertext);
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

type NativeSodiumModule = typeof import('react-native-libsodium');
let nativeSodiumPromise: Promise<NativeSodiumModule | null> | undefined;

function isReactNativeRuntime(): boolean {
  // Avoid loading the native package in browsers, Bun, and Expo Go. React
  // Native identifies its runtime through navigator.product. The native
  // module lookup itself is deferred below so Expo Go never imports the whole
  // react-native namespace and evaluates unsupported getters such as
  // PushNotificationIOS or DevMenu.
  return typeof document === 'undefined'
    && typeof navigator !== 'undefined'
    && navigator.product === 'ReactNative';
}

async function loadNativeSodium(): Promise<NativeSodiumModule | null> {
  if (!isReactNativeRuntime()) return null;
  nativeSodiumPromise ??= import('react-native/Libraries/BatchedBridge/NativeModules.js')
    .then(({ default: modules }) => {
      const nativeModules = modules as typeof modules & { Libsodium?: unknown };
      if (!nativeModules?.Libsodium) return null;
      return import('react-native-libsodium');
    })
    .then((module) => {
      if (!module || typeof module.crypto_pwhash !== 'function') return null;
      if (module.crypto_pwhash_SALTBYTES !== SALT_BYTES) return null;
      if (!Number.isInteger(module.crypto_pwhash_ALG_ARGON2ID13)) return null;
      return module;
    })
    .catch(() => null);
  return nativeSodiumPromise;
}

export async function getRecoveryKDFImplementation(
  argon2id: Argon2idParams = ARGON2ID_DEFAULTS,
): Promise<RecoveryKDFImplementation> {
  if (argon2id.parallelism !== 1 || !(await loadNativeSodium())) return 'javascript';
  return 'native';
}

async function deriveArgon2id(
  entropy: Uint8Array,
  salt: Uint8Array,
  argon2id: Argon2idParams,
): Promise<Uint8Array> {
  // libsodium's crypto_pwhash API has no parallelism parameter. The v2
  // envelope uses p=1, which is the only parameter set eligible for the
  // native implementation. Other valid envelopes remain compatible through
  // the exact same noble-hashes fallback.
  if (argon2id.parallelism === 1) {
    const sodium = await loadNativeSodium();
    if (sodium) {
      try {
        const nativeOutput = sodium.crypto_pwhash(
          KEY_BYTES,
          entropy,
          salt,
          argon2id.iterations,
          argon2id.memory_kib * 1024,
          sodium.crypto_pwhash_ALG_ARGON2ID13,
        );
        if (nativeOutput.length === KEY_BYTES) return new Uint8Array(nativeOutput);
      } catch {
        // Keep the same security parameters when native allocation or
        // capability setup fails; only the implementation changes.
      }
    }
  }

  return argon2idAsync(entropy, salt, {
    m: argon2id.memory_kib,
    t: argon2id.iterations,
    p: argon2id.parallelism,
    dkLen: KEY_BYTES,
    maxmem: argon2id.memory_kib * 1024,
    asyncTick: 10,
  });
}

async function deriveRecoveryPhraseWrappingKey(
  phrase: string,
  salt: Uint8Array,
  argon2id: Argon2idParams,
): Promise<Uint8Array> {
  if (salt.length !== SALT_BYTES || !Number.isInteger(argon2id.memory_kib) || argon2id.memory_kib < 8192 || argon2id.memory_kib > 262144 || !Number.isInteger(argon2id.iterations) || argon2id.iterations < 1 || argon2id.iterations > 10 || !Number.isInteger(argon2id.parallelism) || argon2id.parallelism < 1 || argon2id.parallelism > 4) {
    throw new Error('Invalid Recovery Phrase KDF parameters');
  }
  const entropy = mnemonicToEntropy(normalizeRecoveryPhrase(phrase), wordlist);
  const argonOutput = await deriveArgon2id(entropy, salt, argon2id);
  return hkdf(sha256, argonOutput, new Uint8Array(), RECOVERY_PHRASE_INFO, KEY_BYTES);
}

function recoveryPhraseEnvelopeAAD(keyVersion: string, salt: Uint8Array, dataSalt: Uint8Array): Uint8Array {
  return utf8ToBytes(`samurai-meet:key-a-envelope/v2\n${keyVersion}\n${toBase64URL(salt)}\n${toBase64URL(dataSalt)}\n${RECOVERY_PHRASE_INFO_TEXT}`);
}

function deviceTransferBinding(transferID: string, targetDeviceID: string, recipientPublicKey: string): Uint8Array {
  return utf8ToBytes(`samurai-meet:device-transfer-binding/v1\n${transferID}\n${targetDeviceID}\n${recipientPublicKey}`);
}

function deviceTransferAAD(transferID: string, targetDeviceID: string, ephemeralPublicKey: string, recipientPublicKey: string): Uint8Array {
  return utf8ToBytes(`samurai-meet:device-transfer/v1\n${transferID}\n${targetDeviceID}\n${ephemeralPublicKey}\n${recipientPublicKey}`);
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
