import { gcm } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  fromBase64URL,
  randomBytes,
  toBase64URL,
} from "./crypto";
import type { ChatLocationPayload, ChatMessageView, EncryptedChatTranslation } from "./chat";

const CACHE_VERSION = 1;
const CACHE_KEY_BYTES = 32;
const CACHE_NONCE_BYTES = 12;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_MESSAGES = 200;
const CACHE_MAX_PLAINTEXT_BYTES = 1_200_000;
const CACHE_MAX_FILE_BYTES = 2_000_000;
const CACHE_FILE_PREFIX = "samurai-meet-chat-cache-v1-";
const CACHE_KEY_PREFIX = "samurai_meet_chat_cache_key_v1_";
const CACHE_AAD_DOMAIN = "samurai-meet:chat-cache/v1";

export const CHAT_CACHE_MAX_MESSAGES = CACHE_MAX_MESSAGES;

export type ChatMessageCache = {
  chatID: string;
  userID: string;
  chatUpdatedAt: string;
  savedAt: number;
  messages: ChatMessageView[];
  hasMoreOlder: boolean;
};

type CacheEnvelope = {
  version?: unknown;
  nonce?: unknown;
  ciphertext?: unknown;
};

type CachePayload = {
  version?: unknown;
  chat_id?: unknown;
  user_id?: unknown;
  chat_updated_at?: unknown;
  saved_at?: unknown;
  has_more_older?: unknown;
  messages?: unknown;
};

const cacheKeyPromises = new Map<string, Promise<Uint8Array | null>>();
const cacheOperationQueues = new Map<string, Promise<unknown>>();

function isCacheEnabled(): boolean {
  // The Expo FileSystem web implementation is not a durable private cache.
  // Native builds use Paths.cache plus a device-only SecureStore key instead.
  return Platform.OS !== "web";
}

function hashSuffix(userID: string, chatID: string): string {
  return toBase64URL(sha256(utf8ToBytes(`${CACHE_AAD_DOMAIN}\n${userID}\n${chatID}`)));
}

function cacheIdentity(userID: string, chatID: string) {
  const suffix = hashSuffix(userID, chatID);
  return {
    suffix,
    file: new File(Paths.cache, `${CACHE_FILE_PREFIX}${suffix}.json`),
    tempFile: new File(Paths.cache, `${CACHE_FILE_PREFIX}${suffix}.tmp`),
    keyName: `${CACHE_KEY_PREFIX}${suffix}`,
    aad: utf8ToBytes(`${CACHE_AAD_DOMAIN}\n${userID}\n${chatID}`),
  };
}

async function getStoredKey(keyName: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(keyName);
  } catch {
    return null;
  }
}

async function setStoredKey(keyName: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(keyName, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function loadCacheKey(keyName: string, create: boolean): Promise<Uint8Array | null> {
  const existing = cacheKeyPromises.get(keyName);
  if (existing) {
    const key = await existing;
    return key ? new Uint8Array(key) : null;
  }

  const pending = (async () => {
    const encoded = await getStoredKey(keyName);
    if (encoded) {
      try {
        const key = fromBase64URL(encoded);
        if (key.length === CACHE_KEY_BYTES) return key;
      } catch {
        // A malformed optional cache key is replaced only when the caller
        // explicitly requests cache creation.
      }
    }
    if (!create) return null;
    const key = await randomBytes(CACHE_KEY_BYTES);
    if (key.length !== CACHE_KEY_BYTES) {
      key.fill(0);
      throw new Error("chat_cache_key_invalid");
    }
    await setStoredKey(keyName, toBase64URL(key));
    return key;
  })();
  cacheKeyPromises.set(keyName, pending);
  try {
    const key = await pending;
    return key ? new Uint8Array(key) : null;
  } finally {
    if (cacheKeyPromises.get(keyName) === pending) cacheKeyPromises.delete(keyName);
  }
}

function enqueueCacheOperation<T>(identity: string, operation: () => Promise<T>): Promise<T> {
  const previous = cacheOperationQueues.get(identity) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  let tracked: Promise<T>;
  tracked = next.finally(() => {
    if (cacheOperationQueues.get(identity) === tracked) cacheOperationQueues.delete(identity);
  });
  cacheOperationQueues.set(identity, tracked);
  return tracked;
}

function safeDelete(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Cache files are disposable. A failed cleanup must never block chat.
  }
}

function copyTranslation(value: EncryptedChatTranslation): EncryptedChatTranslation {
  return {
    target_language: value.target_language,
    ciphertext: value.ciphertext,
    nonce: value.nonce,
    algorithm: value.algorithm,
    key_version: value.key_version,
    message_revision: value.message_revision,
  };
}

function copyMessage(message: ChatMessageView): ChatMessageView {
  return {
    id: message.id,
    chat_id: message.chat_id,
    sender_user_id: message.sender_user_id,
    client_message_id: message.client_message_id,
    sequence: message.sequence,
    ciphertext: message.ciphertext,
    nonce: message.nonce,
    algorithm: message.algorithm,
    key_version: message.key_version,
    ...(message.content_type ? { content_type: message.content_type } : {}),
    ...(message.attachment_id ? { attachment_id: message.attachment_id } : {}),
    ...(message.expires_at ? { expires_at: message.expires_at } : {}),
    ...(message.edited_at ? { edited_at: message.edited_at } : {}),
    created_at: message.created_at,
    ...(message.attachment ? { attachment: { ...message.attachment } } : {}),
    ...(message.translations ? { translations: message.translations.map(copyTranslation) } : {}),
    plaintext: message.plaintext,
    location: message.location ? { ...message.location } : null,
    locationExpired: message.locationExpired,
    mine: message.mine,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCachedAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.chat_id === "string"
    && (value.content_type === "image/jpeg" || value.content_type === "image/png" || value.content_type === "image/webp")
    && typeof value.size_bytes === "number"
    && Number.isSafeInteger(value.size_bytes)
    && typeof value.cipher_sha256 === "string"
    && typeof value.nonce === "string"
    && typeof value.algorithm === "string"
    && typeof value.key_version === "string"
    && typeof value.created_at === "string";
}

function isCachedLocation(value: unknown, messageExpiresAt: unknown): value is ChatLocationPayload {
  if (!isRecord(value)) return false;
  return value.type === "location"
    && typeof value.latitude === "number"
    && Number.isFinite(value.latitude)
    && Math.abs(value.latitude) <= 90
    && typeof value.longitude === "number"
    && Number.isFinite(value.longitude)
    && Math.abs(value.longitude) <= 180
    && typeof value.expires_at === "string"
    && value.expires_at === messageExpiresAt
    && Number.isFinite(Date.parse(value.expires_at))
    && (value.display_name === undefined
      || (typeof value.display_name === "string" && value.display_name.trim().length <= 80))
    && (value.accuracy_m === undefined
      || (typeof value.accuracy_m === "number" && Number.isFinite(value.accuracy_m)
        && value.accuracy_m >= 0 && value.accuracy_m <= 10_000));
}

function isCachedMessage(value: unknown, chatID: string): value is ChatMessageView {
  if (!isRecord(value)) return false;
  if (value.chat_id !== chatID || typeof value.id !== "string" || typeof value.sender_user_id !== "string"
    || typeof value.client_message_id !== "string" || typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || typeof value.ciphertext !== "string" || typeof value.nonce !== "string" || typeof value.algorithm !== "string"
    || typeof value.key_version !== "string" || typeof value.created_at !== "string"
    || (value.content_type !== undefined && value.content_type !== "text" && value.content_type !== "location" && value.content_type !== "image")
    || (value.expires_at !== undefined && typeof value.expires_at !== "string")
    || (value.edited_at !== undefined && typeof value.edited_at !== "string")
    || (value.attachment_id !== undefined && typeof value.attachment_id !== "string")
    || (value.attachment !== undefined && !isCachedAttachment(value.attachment))
    || (value.plaintext !== null && typeof value.plaintext !== "string")
    || typeof value.locationExpired !== "boolean"
    || typeof value.mine !== "boolean") {
    return false;
  }
  if (value.content_type === "location") {
    if (value.location !== null && !isCachedLocation(value.location, value.expires_at)) return false;
    if (value.location === null && !value.locationExpired) return false;
    if (value.location !== null && value.locationExpired) return false;
  } else if (value.location !== null || value.locationExpired) {
    return false;
  }
  if (value.translations !== undefined && (!Array.isArray(value.translations) || value.translations.some((item) => {
    if (!isRecord(item)) return true;
    return typeof item.target_language !== "string" || typeof item.ciphertext !== "string"
      || typeof item.nonce !== "string" || typeof item.algorithm !== "string"
      || typeof item.key_version !== "string" || typeof item.message_revision !== "string";
  }))) return false;
  return true;
}

function decodePayload(value: unknown, chatID: string, userID: string): ChatMessageCache | null {
  if (!isRecord(value)) return null;
  const payload = value as CachePayload;
  if (payload.version !== CACHE_VERSION || payload.chat_id !== chatID || payload.user_id !== userID
    || typeof payload.chat_updated_at !== "string" || typeof payload.saved_at !== "number"
    || !Number.isFinite(payload.saved_at) || typeof payload.has_more_older !== "boolean"
    || !Array.isArray(payload.messages) || payload.messages.length > CACHE_MAX_MESSAGES) return null;
  if (Date.now() - payload.saved_at > CACHE_TTL_MS) return null;
  const messages: ChatMessageView[] = [];
  for (const message of payload.messages) {
    if (!isCachedMessage(message, chatID)) return null;
    const normalized = copyMessage(message);
    if (normalized.location && Date.parse(normalized.location.expires_at) <= Date.now()) {
      normalized.location = null;
      normalized.locationExpired = true;
    }
    messages.push(normalized);
  }
  messages.sort((left, right) => left.sequence - right.sequence);
  return {
    chatID,
    userID,
    chatUpdatedAt: payload.chat_updated_at,
    savedAt: payload.saved_at,
    messages,
    hasMoreOlder: payload.has_more_older,
  };
}

export async function loadChatMessageCache(chatID: string, userID: string): Promise<ChatMessageCache | null> {
  if (!isCacheEnabled() || !chatID || !userID) return null;
  const identity = cacheIdentity(userID, chatID);
  return enqueueCacheOperation(identity.suffix, async () => {
    let key: Uint8Array | null = null;
    try {
      if (!identity.file.exists || identity.file.size > CACHE_MAX_FILE_BYTES) return null;
      const raw = JSON.parse(await identity.file.text()) as CacheEnvelope;
      if (raw.version !== CACHE_VERSION || typeof raw.nonce !== "string" || typeof raw.ciphertext !== "string") {
        safeDelete(identity.file);
        return null;
      }
      const nonce = fromBase64URL(raw.nonce);
      const ciphertext = fromBase64URL(raw.ciphertext);
      if (nonce.length !== CACHE_NONCE_BYTES || ciphertext.length < 16) {
        safeDelete(identity.file);
        return null;
      }
      key = await loadCacheKey(identity.keyName, false);
      if (!key) return null;
      const plaintext = gcm(key, nonce, identity.aad).decrypt(ciphertext);
      try {
        const payload = JSON.parse(new TextDecoder().decode(plaintext));
        const decoded = decodePayload(payload, chatID, userID);
        if (!decoded) safeDelete(identity.file);
        return decoded;
      } finally {
        plaintext.fill(0);
      }
    } catch {
      safeDelete(identity.file);
      return null;
    } finally {
      key?.fill(0);
    }
  });
}

export function saveChatMessageCache(
  chatID: string,
  userID: string,
  chatUpdatedAt: string,
  messages: readonly ChatMessageView[],
  hasMoreOlder: boolean,
): Promise<void> {
  if (!isCacheEnabled() || !chatID || !userID || !chatUpdatedAt) return Promise.resolve();
  const identity = cacheIdentity(userID, chatID);
  return enqueueCacheOperation(identity.suffix, async () => {
    const key = await loadCacheKey(identity.keyName, true);
    if (!key) return;
    try {
      let selected = messages
        .filter((message) => message.chat_id === chatID && Number.isSafeInteger(message.sequence) && message.sequence > 0)
        .map(copyMessage)
        .sort((left, right) => left.sequence - right.sequence)
        .slice(-CACHE_MAX_MESSAGES);
      let cacheHasMoreOlder = hasMoreOlder || messages.length > CACHE_MAX_MESSAGES;
      let payloadText = "";
      do {
        const payload: CachePayload = {
          version: CACHE_VERSION,
          chat_id: chatID,
          user_id: userID,
          chat_updated_at: chatUpdatedAt,
          saved_at: Date.now(),
          has_more_older: cacheHasMoreOlder,
          messages: selected,
        };
        payloadText = JSON.stringify(payload);
        if (payloadText.length <= CACHE_MAX_PLAINTEXT_BYTES || selected.length === 0) break;
        cacheHasMoreOlder = true;
        selected = selected.slice(-Math.max(1, Math.floor(selected.length / 2)));
      } while (selected.length > 0);

      const nonce = await randomBytes(CACHE_NONCE_BYTES);
      if (nonce.length !== CACHE_NONCE_BYTES) {
        nonce.fill(0);
        return;
      }
      try {
        const payloadBytes = utf8ToBytes(payloadText);
        let ciphertext: Uint8Array;
        try {
          ciphertext = gcm(key, nonce, identity.aad).encrypt(payloadBytes);
        } finally {
          payloadBytes.fill(0);
        }
        const envelope = JSON.stringify({
          version: CACHE_VERSION,
          nonce: toBase64URL(nonce),
          ciphertext: toBase64URL(ciphertext),
        });
        if (new TextEncoder().encode(envelope).byteLength <= CACHE_MAX_FILE_BYTES) {
          // Write the authenticated envelope to a sibling file first. The
          // cache is disposable, but a partial JSON write must not make the
          // next launch throw away an otherwise valid cache.
          safeDelete(identity.tempFile);
          identity.tempFile.write(envelope);
          await identity.tempFile.move(identity.file, { overwrite: true });
        }
        ciphertext.fill(0);
      } finally {
        nonce.fill(0);
      }
    } finally {
      key.fill(0);
    }
  });
}

export function clearChatMessageCache(chatID: string, userID: string): Promise<void> {
  if (!isCacheEnabled() || !chatID || !userID) return Promise.resolve();
  const identity = cacheIdentity(userID, chatID);
  return enqueueCacheOperation(identity.suffix, async () => {
    safeDelete(identity.file);
    safeDelete(identity.tempFile);
    cacheKeyPromises.delete(identity.keyName);
    await SecureStore.deleteItemAsync(identity.keyName).catch(() => undefined);
  });
}
