import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

export type SecureRandomSource = {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  randomUUID?: () => string;
};

type ExpoCryptoModule = {
  getRandomValues?: (array: Uint8Array) => unknown;
};

export type NativeModuleLoader = (moduleName: string) => Promise<unknown | null>;

export class SecureRandomUnavailableError extends Error {
  readonly code = "secure_random_unavailable";

  constructor() {
    super("A cryptographically secure random source is unavailable in this app build.");
    this.name = "SecureRandomUnavailableError";
  }
}

export class ChatAttachmentCryptoUnavailableError extends Error {
  readonly code = "chat_attachment_crypto_unavailable";

  constructor() {
    super("A cryptographically secure random source is unavailable for image encryption in this app build.");
    this.name = "ChatAttachmentCryptoUnavailableError";
  }
}

const nativeModulePromises = new Map<string, Promise<unknown | null>>();

function globalCrypto(): SecureRandomSource | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto;
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as SecureRandomSource;
  if (typeof value.getRandomValues !== "function" && typeof value.randomUUID !== "function") return null;
  return value;
}

/**
 * Resolve Expo native modules only after a crypto operation is requested.
 * In particular, this never imports expo-crypto's top-level JS entrypoint,
 * whose optional AES export can be absent from Expo Go.
 */
export const loadNativeModule: NativeModuleLoader = async (moduleName) => {
  const existing = nativeModulePromises.get(moduleName);
  if (existing) return existing;

  const pending = import("expo-modules-core")
    .then(({ requireNativeModule }) => requireNativeModule(moduleName))
    .catch(() => null);
  nativeModulePromises.set(moduleName, pending);
  return pending;
};

function isExpoCryptoModule(value: unknown): value is ExpoCryptoModule {
  return typeof value === "object"
    && value !== null
    && typeof (value as ExpoCryptoModule).getRandomValues === "function";
}

async function loadExpoCryptoModule(loader: NativeModuleLoader): Promise<ExpoCryptoModule | null> {
  const value = await loader("ExpoCrypto");
  return isExpoCryptoModule(value) ? value : null;
}

async function hasSecureRandomSource(
  loader: NativeModuleLoader,
  randomSource: SecureRandomSource | null,
): Promise<boolean> {
  if (typeof randomSource?.getRandomValues === "function") return true;
  return (await loadExpoCryptoModule(loader)) !== null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

export async function secureRandomBytes(length: number): Promise<Uint8Array> {
  if (!Number.isInteger(length) || length < 0 || length > 1024) {
    throw new TypeError(`secureRandomBytes(${length}) expected a valid number from range 0...1024`);
  }
  const bytes = new Uint8Array(length);
  const webCrypto = globalCrypto();
  if (webCrypto?.getRandomValues) {
    try {
      webCrypto.getRandomValues(bytes);
      return bytes;
    } catch {
      // Try the Expo native module below. Never fall back to Math.random.
    }
  }

  const nativeCrypto = await loadExpoCryptoModule(loadNativeModule);
  if (nativeCrypto?.getRandomValues) {
    try {
      nativeCrypto.getRandomValues(bytes);
      return bytes;
    } catch {
      // Convert all unavailable native implementations into one safe error.
    }
  }

  bytes.fill(0);
  throw new SecureRandomUnavailableError();
}

export async function secureRandomUUID(): Promise<string> {
  const webCrypto = globalCrypto();
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();

  const bytes = await secureRandomBytes(16);
  try {
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  } finally {
    bytes.fill(0);
  }
}

/** Matches expo-crypto's SHA-256 + BASE64 result without loading expo-crypto. */
export function sha256Base64(value: string): string {
  return bytesToBase64(sha256(utf8ToBytes(value)));
}

export type ChatAttachmentEncryptionCheckOptions = {
  /** Test-only override for the global secure-random source. */
  globalRandomSource?: SecureRandomSource | null;
  /** Test-only loader override for the Expo native random module. */
  nativeModuleLoader?: NativeModuleLoader;
};

/**
 * A chat image may only enter the upload flow when the app has a secure random
 * source. AES-GCM itself is implemented by @noble/ciphers, so an optional
 * ExpoCryptoAES module must not be required here. The capability probe is
 * deliberately lazy so Expo Go can still load the app.
 */
export async function canUseChatAttachmentEncryption(
  options: ChatAttachmentEncryptionCheckOptions = {},
): Promise<boolean> {
  const loader = options.nativeModuleLoader ?? loadNativeModule;
  const randomSource = options.globalRandomSource === undefined ? globalCrypto() : options.globalRandomSource;
  return hasSecureRandomSource(loader, randomSource);
}

export async function ensureChatAttachmentEncryptionAvailable(
  options: ChatAttachmentEncryptionCheckOptions = {},
): Promise<void> {
  if (!(await canUseChatAttachmentEncryption(options))) {
    throw new ChatAttachmentCryptoUnavailableError();
  }
}

export function isChatAttachmentCryptoUnavailable(error: unknown): boolean {
  return error instanceof ChatAttachmentCryptoUnavailableError
    || (error instanceof Error && error.message === "chat_attachment_crypto_unavailable");
}
