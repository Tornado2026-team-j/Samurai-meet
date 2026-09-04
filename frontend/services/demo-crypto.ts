import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { entropyToMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { secureRandomBytes } from "./runtime-crypto";

export const DEMO_DEVICE_KEY_VERSION = "demo-keyb-v1";
export const DEMO_CHAT_KEY_VERSION = "demo-chat-v1";
export const DEMO_CHAT_ALGORITHM = "AES-256-GCM";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const DEMO_KEY_A_INFO = utf8ToBytes("samurai-meet/demo/key-a/v1");
const DEMO_KEY_B_INFO = utf8ToBytes("samurai-meet/demo/key-b/v1");
const DEMO_AGREEMENT_INFO = utf8ToBytes("samurai-meet/demo/agreement/v1");
const DEMO_CHAT_KEY_INFO = utf8ToBytes("samurai-meet/demo-chat/key/v1");
const DEMO_CHAT_SALT_PREFIX = "samurai-meet/demo-chat/v1/";
const DEMO_CHAT_AAD_PREFIX = "samurai-meet:demo-chat:v1";

export type DemoKeyMaterial = {
  keyA: Uint8Array;
  keyB: Uint8Array;
  recoveryKey: string;
  salt: Uint8Array;
  agreementPrivateKey: Uint8Array;
  agreementPublicKey: Uint8Array;
};

export type DemoChatContentType = "text" | "location" | "image";

export type DemoEncryptedChatPayload = {
  ciphertext: string;
  nonce: string;
  algorithm: typeof DEMO_CHAT_ALGORITHM;
  key_version: typeof DEMO_CHAT_KEY_VERSION;
};

export type DemoPeerKey = {
  user_id: string;
  key_version: typeof DEMO_DEVICE_KEY_VERSION;
  public_key: string;
};

function bytesToBase64URL(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function demoBytesToBase64URL(bytes: Uint8Array): string {
  return bytesToBase64URL(bytes);
}

export function demoBase64URLToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid demo Base64URL value");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function deriveDemoKey(input: Uint8Array, salt: Uint8Array, info: Uint8Array): Uint8Array {
  if (input.length !== KEY_BYTES || (salt.length !== 0 && salt.length !== SALT_BYTES)) {
    throw new Error("Invalid demo key material");
  }
  return hkdf(sha256, input, salt, info, KEY_BYTES);
}

/**
 * Creates the fast review-only key family. Argon2id and native sodium are
 * deliberately absent from this module; the normal account provider remains
 * responsible for the production Key-A/Key-B protocol.
 */
export async function createDemoKeyMaterial(
  random: (length: number) => Promise<Uint8Array> = secureRandomBytes,
): Promise<DemoKeyMaterial> {
  const salt = await random(SALT_BYTES);
  const entropy = await random(KEY_BYTES);
  if (salt.length !== SALT_BYTES || entropy.length !== KEY_BYTES) {
    salt.fill(0);
    entropy.fill(0);
    throw new Error("demo_key_randomness_invalid");
  }
  const recoveryKey = entropyToMnemonic(entropy, wordlist);
  const keyA = deriveDemoKey(entropy, salt, DEMO_KEY_A_INFO);
  const keyB = deriveDemoKey(entropy, salt, DEMO_KEY_B_INFO);
  const agreementPrivateKey = deriveDemoKey(keyB, new Uint8Array(0), DEMO_AGREEMENT_INFO);
  const agreementPublicKey = deriveDemoAgreementPublicKey(agreementPrivateKey);
  entropy.fill(0);
  return { keyA, keyB, recoveryKey, salt, agreementPrivateKey, agreementPublicKey };
}

export function deriveDemoAgreementPublicKey(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== KEY_BYTES) throw new Error("invalid_demo_agreement_key");
  return x25519.getPublicKey(privateKey);
}

export function isDemoRecoveryPhrase(value: string): boolean {
  const words = value.trim().split(/\s+/u);
  return words.length === 24 && validateMnemonic(value.trim().toLowerCase(), wordlist);
}

export function deriveDemoChatKey(
  localAgreementPrivateKey: Uint8Array,
  peerAgreementPublicKey: Uint8Array,
  chatID: string,
): Uint8Array {
  if (localAgreementPrivateKey.length !== KEY_BYTES || peerAgreementPublicKey.length !== KEY_BYTES || !chatID) {
    throw new Error("demo_chat_key_unavailable");
  }
  const sharedSecret = x25519.getSharedSecret(localAgreementPrivateKey, peerAgreementPublicKey);
  const salt = sha256(utf8ToBytes(`${DEMO_CHAT_SALT_PREFIX}${chatID}`));
  try {
    return hkdf(sha256, sharedSecret, salt, DEMO_CHAT_KEY_INFO, KEY_BYTES);
  } finally {
    sharedSecret.fill(0);
    salt.fill(0);
  }
}

function demoChatAAD(chatID: string, contentType: DemoChatContentType): Uint8Array {
  return utf8ToBytes(`${DEMO_CHAT_AAD_PREFIX}\n${chatID}\n${DEMO_CHAT_KEY_VERSION}\n${contentType}`);
}

export async function encryptDemoChatPlaintext(
  chatID: string,
  plaintext: string,
  contentKey: Uint8Array,
  contentType: DemoChatContentType,
  random: (length: number) => Promise<Uint8Array> = secureRandomBytes,
): Promise<DemoEncryptedChatPayload> {
	const payload = utf8ToBytes(plaintext);
	try {
		return await encryptDemoChatBytes(chatID, payload, contentKey, contentType, random);
	} finally {
		payload.fill(0);
	}
}

export async function encryptDemoChatBytes(
	chatID: string,
	plaintext: Uint8Array,
	contentKey: Uint8Array,
	contentType: DemoChatContentType,
	random: (length: number) => Promise<Uint8Array> = secureRandomBytes,
): Promise<DemoEncryptedChatPayload> {
	if (contentKey.length !== KEY_BYTES || !chatID) throw new Error("demo_chat_key_unavailable");
	const nonce = await random(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) {
    nonce.fill(0);
    throw new Error("demo_chat_randomness_invalid");
  }
	const aad = demoChatAAD(chatID, contentType);
	try {
		const ciphertext = gcm(contentKey, nonce, aad).encrypt(plaintext);
    return {
      ciphertext: bytesToBase64URL(ciphertext),
      nonce: bytesToBase64URL(nonce),
      algorithm: DEMO_CHAT_ALGORITHM,
      key_version: DEMO_CHAT_KEY_VERSION,
    };
	} finally {
		aad.fill(0);
		nonce.fill(0);
	}
}

export function decryptDemoChatBytes(
	chatID: string,
	ciphertextEncoded: string,
	nonceEncoded: string,
	contentKey: Uint8Array,
	contentType: DemoChatContentType,
): Uint8Array | null {
	if (contentKey.length !== KEY_BYTES || !chatID) return null;
	let ciphertext: Uint8Array | null = null;
	let nonce: Uint8Array | null = null;
	let aad: Uint8Array | null = null;
	try {
		ciphertext = demoBase64URLToBytes(ciphertextEncoded);
		nonce = demoBase64URLToBytes(nonceEncoded);
		if (nonce.length !== NONCE_BYTES || ciphertext.length < 16) return null;
		aad = demoChatAAD(chatID, contentType);
		return gcm(contentKey, nonce, aad).decrypt(ciphertext);
	} catch {
		return null;
	} finally {
		ciphertext?.fill(0);
		nonce?.fill(0);
		aad?.fill(0);
	}
}

export function decryptDemoChatMessage(
  chatID: string,
  ciphertextEncoded: string,
  nonceEncoded: string,
  contentKey: Uint8Array,
  contentType: DemoChatContentType,
): string | null {
	const plaintext = decryptDemoChatBytes(chatID, ciphertextEncoded, nonceEncoded, contentKey, contentType);
	if (!plaintext) return null;
	try {
		return new TextDecoder().decode(plaintext);
	} finally {
		plaintext.fill(0);
	}
}
