import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { API_BASE_URL } from "./api-config";
import { APIError, requestAPI } from "./api-client";
import { fetchWithAutoRefresh } from "./authenticated-fetch";
import type { Session } from "./auth-contract";
import {
	DEMO_CHAT_ALGORITHM,
	DEMO_CHAT_KEY_VERSION,
	demoBase64URLToBytes,
	decryptDemoChatBytes,
	decryptDemoChatMessage,
	encryptDemoChatBytes,
	encryptDemoChatPlaintext,
	type DemoChatContentType,
} from "./demo-crypto";
import { loadDemoChatKey } from "./demo-key-management";
import {
  CHAT_ATTACHMENT_ALGORITHM,
  CHAT_ATTACHMENT_KEY_VERSION,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_WRAPPING_ALGORITHM,
  CHAT_ACCOUNT_KEY_ENVELOPE_VERSION,
  CHAT_ACCOUNT_KEY_WRAPPING_ALGORITHM,
  CHAT_DEVICE_KEY_ENVELOPE_VERSION,
  CHAT_DEVICE_KEY_WRAPPING_ALGORITHM,
  CHAT_MESSAGE_ALGORITHM,
  CHAT_MESSAGE_KEY_VERSION,
  chatKeyCommitment,
  deriveAccountDataKey,
  decryptChatAttachmentBytes,
  encryptChatAttachmentBytes,
  fromBase64URL,
  hashBytesHex,
  isChatAttachmentContentType,
  randomBytes,
  toBase64URL,
  unwrapChatAttachmentKey,
  unwrapChatKeyForAccount,
  unwrapChatKeyForDevice,
  wrapChatKeyForAccount,
  wrapChatKeyForDevice,
  wrapChatAttachmentKey,
  ensureChatAttachmentEncryptionAvailable,
  type ChatAttachmentContentType,
  type EncryptedChatAttachment,
} from "./crypto";
import type { DeviceKeyBundle } from "./key-management";

const CHAT_ALGORITHM = CHAT_MESSAGE_ALGORITHM;
const CHAT_KEY_VERSION = CHAT_MESSAGE_KEY_VERSION;
const LEGACY_CHAT_KEY_VERSION = "chat-mvp-v1";
const LEGACY_DEVICE_CHAT_KEY_VERSION = "chat-keyb-v1";
const CHAT_AAD_PREFIX = "samurai-meet:chat-message:dek-v1";
const LEGACY_CHAT_AAD_PREFIX = "samurai-meet:chat-message:mvp-v1";
const LEGACY_DEVICE_CHAT_AAD_PREFIX = "samurai-meet:chat-message:keyb-v1";
const LEGACY_DEVICE_CHAT_KEY_INFO = utf8ToBytes("samurai-meet/chat-message/keyb-v1");
const CHAT_KEY_INFO = utf8ToBytes("samurai-meet/chat-message/dek-v1");
const CHAT_TRANSLATION_KEY_VERSION = "chat-translation-dek-v1";
const LEGACY_CHAT_TRANSLATION_KEY_VERSION = "chat-translation-keyb-v1";
const CHAT_TRANSLATION_AAD_PREFIX = "samurai-meet:chat-translation:dek-v1";
const LEGACY_CHAT_TRANSLATION_AAD_PREFIX = "samurai-meet:chat-translation:keyb-v1";
const CHAT_TRANSLATION_KEY_INFO = utf8ToBytes("samurai-meet/chat-translation/dek-v1");
const LEGACY_CHAT_TRANSLATION_KEY_INFO = utf8ToBytes("samurai-meet/chat-translation/keyb-v1");
const CHAT_PLAINTEXT_COMMITMENT_DOMAIN = "samurai-meet:chat-message-plaintext-commitment/v2";
const CHAT_PLAINTEXT_COMMITMENT_KEY_INFO = utf8ToBytes("samurai-meet/chat-message/plaintext-commitment-key/v2");
const MAX_PLAINTEXT_LENGTH = 2000;

async function loadDeviceKeyManagement() {
  return import("./key-management");
}

type DataResponse<T> = { data?: T };

export type ChatStatus = "accepted" | "completed";

export type ChatListFilter = "all" | "active" | "completed";
export type ChatLanguage = "ja" | "en";

export type ChatSummary = {
  id: string;
  match_id: string;
  status: ChatStatus;
  other_user_id: string;
  other_user_name: string;
  last_message_at?: string;
  last_message_sequence?: number;
  unread_count: number;
  updated_at: string;
};

const CHAT_STATUS_FOR_FILTER: Record<Exclude<ChatListFilter, "all">, ChatStatus> = {
  active: "accepted",
  completed: "completed",
};

export function filterChatsByStatus(
  chats: readonly ChatSummary[],
  filter: ChatListFilter,
): ChatSummary[] {
  if (filter === "all") return [...chats];
  return chats.filter((chat) => chat.status === CHAT_STATUS_FOR_FILTER[filter]);
}

export type EncryptedChatMessage = {
  id: string;
  chat_id: string;
  sender_user_id: string;
  client_message_id: string;
  sequence: number;
  ciphertext: string;
  nonce: string;
  algorithm: typeof CHAT_ALGORITHM;
  key_version: string;
  content_type?: "text" | "location" | "image";
  attachment_id?: string;
  attachment?: ChatAttachment;
  expires_at?: string;
  edited_at?: string;
  translations?: EncryptedChatTranslation[];
  created_at: string;
};

export type EncryptedChatTranslation = {
  target_language: ChatLanguage;
  ciphertext: string;
  nonce: string;
  algorithm: typeof CHAT_ALGORITHM;
  key_version: string;
  message_revision: string;
};

export type ChatMessagePage = {
  items: EncryptedChatMessage[];
  next_after?: number;
  next_before?: number;
  has_more: boolean;
};

export type ChatMessageView = EncryptedChatMessage & {
  plaintext: string | null;
  location: ChatLocationPayload | null;
  locationExpired: boolean;
  mine: boolean;
};

export type ChatAttachment = {
  id: string;
  chat_id: string;
  content_type: ChatAttachmentContentType;
  size_bytes: number;
  cipher_sha256: string;
  nonce: string;
	algorithm: typeof CHAT_ATTACHMENT_ALGORITHM | typeof DEMO_CHAT_ALGORITHM;
	key_version: typeof CHAT_ATTACHMENT_KEY_VERSION | typeof DEMO_CHAT_KEY_VERSION;
	created_at: string;
};

export type ChatAttachmentKeyRecipient = {
  user_id: string;
  device_id: string;
  key_version: "x25519-v1";
  public_key: string;
};

export type ChatKeyRecipient = ChatAttachmentKeyRecipient & {
  envelope_present: boolean;
};

export type ChatAttachmentKeyEnvelopeInput = {
  user_id: string;
  device_id: string;
  key_version: "x25519-v1";
  public_key: string;
  algorithm: typeof CHAT_ATTACHMENT_WRAPPING_ALGORITHM;
  envelope: string;
};

export type ChatKeyEnvelopeScope = "account" | "device";

export type ChatKeyEnvelope = {
  scope: ChatKeyEnvelopeScope;
  user_id: string;
  device_id: string;
  key_version: string;
  public_key: string;
  algorithm: string;
  envelope: string;
  key_commitment: string;
};

export type ChatKeyEnvelopeBundle = {
  account_envelope?: ChatKeyEnvelope;
  device_envelope?: ChatKeyEnvelope;
};

export type ChatImageSendResult = {
	message: EncryptedChatMessage;
	attachment: ChatAttachment;
};

type EncryptedDemoChatAttachment = {
	ciphertext: string;
	nonce: string;
	algorithm: typeof DEMO_CHAT_ALGORITHM;
	keyVersion: typeof DEMO_CHAT_KEY_VERSION;
	contentType: ChatAttachmentContentType;
};

export type ChatLocationPayload = {
  type: "location";
  latitude: number;
  longitude: number;
  display_name?: string;
  accuracy_m?: number;
  expires_at: string;
};

export type ChatModerationCategory =
  | "abuse"
  | "sexual"
  | "money"
  | "external_contact"
  | "dangerous_place"
  | "personal_info"
  | "coercion";

export type ChatModerationResult = {
  categories: ChatModerationCategory[];
  severity: "none" | "warn" | "block";
};

// The server intentionally exposes no provider categories, scores, or raw
// response. Any non-allowed decision is fail-closed: ciphertext delivery must
// not begin until a later moderation attempt returns allowed.
export type ChatModerationDecision = "allowed" | "blocked" | "unavailable";

export type ChatReportReason =
  | "nuisance"
  | "harassment"
  | "impersonation"
  | "inappropriate_photo"
  | "dangerous"
  | "other";

export type SafetyReportTargetType = "user" | "recruitment_card" | "message" | "photo";

export type SafetyReport = {
  id: string;
  target_type: SafetyReportTargetType;
  target_id: string;
  reason: ChatReportReason;
  comment: string;
  status: "received" | "reviewing" | "actioned" | "dismissed";
  created_at: string;
};

export type ChatTransportToken = {
  chat_token: string;
  expires_at: string;
  transport: "webtransport";
};

export type ChatTranslationResult = {
  source_language: string;
  translated_text: string;
  target_language: ChatLanguage;
};

/**
 * React Native/Expo does not currently provide a maintained native WebTransport
 * client that can authenticate CONNECT with an Authorization header. Until one
 * is adopted in a development build, chat uses explicit REST synchronization.
 * Never add a WebSocket fallback: it would weaken the transport contract.
 */
export type ChatRealtimeMode = "webtransport" | "rest_sync";

export type ChatWebTransportFrame =
  | { type: "message.created"; message: EncryptedChatMessage }
  | { type: "message.ack"; client_message_id: string; message: EncryptedChatMessage; duplicate: boolean }
  | { type: "message.updated"; message: EncryptedChatMessage }
  | { type: "message.deleted"; message_id: string; sequence: number }
  | { type: "message.read"; user_id: string; last_message_sequence: number }
  | { type: "typing"; user_id: string; state: "start" | "stop" }
  | { type: "closing"; reason: string }
  | { type: "error"; code: string; message?: string };

export type ChatWebTransportConnection = {
  close: () => void | Promise<void>;
};

export type ChatWebTransportSession = {
  connection: ChatWebTransportConnection;
  expiresAt: string;
};

/**
 * Native modules register here from a Development/production build. The module
 * must establish HTTP/3 WebTransport with TLS 1.3 and pass the short-lived chat
 * token only in CONNECT's Authorization header. It must not send state-changing
 * frames with 0-RTT data.
 */
export type ChatWebTransportAdapter = {
  connect: (input: {
    url: string;
    headers: { Authorization: string };
    onFrame: (frame: ChatWebTransportFrame) => void;
    onClose: () => void;
  }) => Promise<ChatWebTransportConnection>;
};

let registeredWebTransportAdapter: ChatWebTransportAdapter | null = null;

type NativeWebTransportEvent = {
  connectionID?: unknown;
  frame?: unknown;
};

type NativeWebTransportBridge = {
  connect: (input: {
    url: string;
    headers: { Authorization: string };
  }) => Promise<{ connectionID: string }>;
  close: (connectionID: string) => Promise<void> | void;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

type NativeEventSubscription = { remove: () => void };
type NativeEventEmitterBridge = {
  addListener: (eventName: string, listener: (event: NativeWebTransportEvent) => void) => NativeEventSubscription;
};

type ReactNativeBridgeRuntime = {
  NativeModules: { SamuraiMeetWebTransport?: NativeWebTransportBridge };
  NativeEventEmitter: new (module: NativeWebTransportBridge) => NativeEventEmitterBridge;
};

function loadReactNativeBridgeRuntime(): ReactNativeBridgeRuntime | null {
  // Avoid importing react-native in Bun/unit-test and web runtimes. Metro makes
  // require available in native application code, including Development Builds.
  if (typeof require !== "function") return null;
  try {
    return require("react-native") as ReactNativeBridgeRuntime;
  } catch {
    return null;
  }
}

function parseNativeWebTransportFrame(value: unknown): ChatWebTransportFrame | null {
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") return null;
  return value as ChatWebTransportFrame;
}

/**
 * Installs the bridge shipped in a Development/production build. Expo Go has no
 * custom native module, so this returns false and the screen remains in the
 * explicit REST-only mode. The bridge contract intentionally exposes no send
 * API: application state changes stay on authenticated REST until a separately
 * reviewed WebTransport send contract exists without 0-RTT writes.
 */
export function installNativeChatWebTransportBridge(): boolean {
  const runtime = loadReactNativeBridgeRuntime();
  const candidate = runtime?.NativeModules.SamuraiMeetWebTransport;
  if (!candidate || typeof candidate.connect !== "function" || typeof candidate.close !== "function"
    || typeof candidate.addListener !== "function" || typeof candidate.removeListeners !== "function") {
    registerChatWebTransportAdapter(null);
    return false;
  }

  const events = new runtime.NativeEventEmitter(candidate);
  registerChatWebTransportAdapter({
    connect: async ({ url, headers, onFrame, onClose }) => {
      const result = await candidate.connect({ url, headers });
      if (!result || typeof result.connectionID !== "string" || !result.connectionID) {
        throw new Error("webtransport_native_connection_invalid");
      }
      const connectionID = result.connectionID;
      const frameSubscription = events.addListener("samuraiMeetWebTransportFrame", (event: NativeWebTransportEvent) => {
        if (event?.connectionID !== connectionID) return;
        const frame = parseNativeWebTransportFrame(event.frame);
        if (frame) onFrame(frame);
      });
      const closeSubscription = events.addListener("samuraiMeetWebTransportClose", (event: NativeWebTransportEvent) => {
        if (event?.connectionID !== connectionID) return;
        frameSubscription.remove();
        closeSubscription.remove();
        onClose();
      });
      return {
        close: async () => {
          frameSubscription.remove();
          closeSubscription.remove();
          await candidate.close(connectionID);
        },
      };
    },
  });
  return true;
}

export function registerChatWebTransportAdapter(adapter: ChatWebTransportAdapter | null): void {
  registeredWebTransportAdapter = adapter;
}

export function chatRealtimeMode(): ChatRealtimeMode {
  return registeredWebTransportAdapter ? "webtransport" : "rest_sync";
}

export function chatWebTransportURL(chatID: string, baseURL = API_BASE_URL): string {
  const url = new URL(baseURL);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/wt/chats/${encodeURIComponent(chatID)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function connectChatWebTransport(
  chatID: string,
  session: Session,
  handlers: Pick<Parameters<ChatWebTransportAdapter["connect"]>[0], "onFrame" | "onClose">,
  signal?: AbortSignal,
): Promise<ChatWebTransportSession> {
  const adapter = registeredWebTransportAdapter;
  if (!adapter) throw new Error("webtransport_native_client_unavailable");
  const token = await issueChatTransportToken(chatID, session, signal);
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  const connection = await adapter.connect({
    url: chatWebTransportURL(chatID),
    headers: { Authorization: `Bearer ${token.chat_token}` },
    ...handlers,
  });
  return { connection, expiresAt: token.expires_at };
}

function chatQuery(after?: number, limit?: number, before?: number): string {
  const query = new URLSearchParams();
  if (after !== undefined) query.set("after", String(after));
  if (before !== undefined) query.set("before", String(before));
  if (limit !== undefined) query.set("limit", String(limit));
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

function requireArrayData<T>(response: DataResponse<T[]>, resource: string): T[] {
  if (!Array.isArray(response.data)) {
    throw new Error(`${resource} response is invalid`);
  }
  return response.data;
}

function chatKey(chatID: string, contentKey: Uint8Array): Uint8Array {
  if (contentKey.length !== 32) throw new Error("chat_key_unavailable");
  return hkdf(
    sha256,
    contentKey,
    utf8ToBytes(`${CHAT_AAD_PREFIX}\n${chatID}`),
    CHAT_KEY_INFO,
    32,
  );
}

function chatAAD(chatID: string): Uint8Array {
  return utf8ToBytes(`${CHAT_AAD_PREFIX}\n${chatID}\n${CHAT_KEY_VERSION}`);
}

function legacyDeviceChatKey(chatID: string, keyB: Uint8Array): Uint8Array {
  if (keyB.length !== 32) throw new Error("chat_key_unavailable");
  return hkdf(
    sha256,
    keyB,
    utf8ToBytes(`${LEGACY_DEVICE_CHAT_AAD_PREFIX}\n${chatID}`),
    LEGACY_DEVICE_CHAT_KEY_INFO,
    32,
  );
}

export function chatPlaintextCommitmentKey(chatID: string, contentKey: Uint8Array): Uint8Array {
  if (contentKey.length !== 32) throw new Error("chat_key_unavailable");
  return hkdf(
    sha256,
    contentKey,
    utf8ToBytes(`${CHAT_AAD_PREFIX}\n${chatID}`),
    CHAT_PLAINTEXT_COMMITMENT_KEY_INFO,
    32,
  );
}

function chatTranslationKey(chatID: string, contentKey: Uint8Array): Uint8Array {
  if (contentKey.length !== 32) throw new Error("chat_key_unavailable");
  return hkdf(
    sha256,
    contentKey,
    utf8ToBytes(`${CHAT_TRANSLATION_AAD_PREFIX}\n${chatID}`),
    CHAT_TRANSLATION_KEY_INFO,
    32,
  );
}

function legacyChatTranslationKey(chatID: string, keyB: Uint8Array): Uint8Array {
  if (keyB.length !== 32) throw new Error("chat_key_unavailable");
  return hkdf(
    sha256,
    keyB,
    utf8ToBytes(`${LEGACY_CHAT_TRANSLATION_AAD_PREFIX}\n${chatID}`),
    LEGACY_CHAT_TRANSLATION_KEY_INFO,
    32,
  );
}

function chatTranslationAAD(chatID: string, messageID: string, messageRevision: string, targetLanguage: ChatLanguage): Uint8Array {
  return utf8ToBytes(`${CHAT_TRANSLATION_AAD_PREFIX}\n${chatID}\n${messageID}\n${messageRevision}\n${targetLanguage}`);
}

function legacyChatTranslationAAD(chatID: string, messageID: string, messageRevision: string, targetLanguage: ChatLanguage): Uint8Array {
  return utf8ToBytes(`${LEGACY_CHAT_TRANSLATION_AAD_PREFIX}\n${chatID}\n${messageID}\n${messageRevision}\n${targetLanguage}`);
}

function isChatLanguage(value: string): value is ChatLanguage {
  return value === "ja" || value === "en";
}

function isUsableTranslationResult(result: ChatTranslationResult, targetLanguage: ChatLanguage): boolean {
  return typeof result.source_language === "string" && result.source_language.trim().length > 0
    && typeof result.translated_text === "string" && result.translated_text.trim().length > 0
    && result.translated_text.length <= 8000 && result.target_language === targetLanguage;
}

export function chatMessageRevision(message: Pick<EncryptedChatMessage, "edited_at" | "created_at">): string {
  return message.edited_at || message.created_at;
}

export async function encryptChatTranslation(
  chatID: string,
  messageID: string,
  messageRevision: string,
  result: ChatTranslationResult,
  contentKey: Uint8Array,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
): Promise<EncryptedChatTranslation> {
  if (contentKey.length !== 32 || !messageID || !messageRevision || !isUsableTranslationResult(result, result.target_language)) {
    throw new Error("chat_translation_invalid");
  }
  const nonce = await random(12);
  if (nonce.length !== 12) throw new Error("chat_translation_nonce_invalid");
  const payload = utf8ToBytes(JSON.stringify({
    source_language: result.source_language.trim(),
    translated_text: result.translated_text.trim(),
    target_language: result.target_language,
  }));
  const messageKey = chatTranslationKey(chatID, contentKey);
  try {
    const ciphertext = gcm(
      messageKey,
      nonce,
      chatTranslationAAD(chatID, messageID, messageRevision, result.target_language),
    ).encrypt(payload);
    return {
      target_language: result.target_language,
      ciphertext: toBase64URL(ciphertext),
      nonce: toBase64URL(nonce),
      algorithm: CHAT_ALGORITHM,
      key_version: CHAT_TRANSLATION_KEY_VERSION,
      message_revision: messageRevision,
    };
  } finally {
    payload.fill(0);
    messageKey.fill(0);
  }
}

export function decryptChatTranslation(
  chatID: string,
  messageID: string,
  messageRevision: string,
  encrypted: EncryptedChatTranslation,
  contentKey?: Uint8Array,
): ChatTranslationResult | null {
  if (!contentKey || contentKey.length !== 32 || encrypted.algorithm !== CHAT_ALGORITHM
    || (encrypted.key_version !== CHAT_TRANSLATION_KEY_VERSION && encrypted.key_version !== LEGACY_CHAT_TRANSLATION_KEY_VERSION)
    || encrypted.message_revision !== messageRevision || !isChatLanguage(encrypted.target_language)) return null;
  try {
    const legacy = encrypted.key_version === LEGACY_CHAT_TRANSLATION_KEY_VERSION;
    const messageKey = legacy ? legacyChatTranslationKey(chatID, contentKey) : chatTranslationKey(chatID, contentKey);
    try {
      const plaintext = gcm(
        messageKey,
        fromBase64URL(encrypted.nonce),
        legacy
          ? legacyChatTranslationAAD(chatID, messageID, messageRevision, encrypted.target_language)
          : chatTranslationAAD(chatID, messageID, messageRevision, encrypted.target_language),
      ).decrypt(fromBase64URL(encrypted.ciphertext));
      try {
        const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<ChatTranslationResult>;
        if (typeof parsed.source_language !== "string" || typeof parsed.translated_text !== "string"
          || !isChatLanguage(String(parsed.target_language)) || parsed.target_language !== encrypted.target_language) return null;
        const result: ChatTranslationResult = {
          source_language: parsed.source_language,
          translated_text: parsed.translated_text,
          target_language: parsed.target_language,
        };
        return isUsableTranslationResult(result, encrypted.target_language) ? result : null;
      } finally {
        plaintext.fill(0);
      }
    } finally {
      messageKey.fill(0);
    }
  } catch {
    return null;
  }
}

function legacyChatKey(chatID: string): Uint8Array {
  return sha256(utf8ToBytes(`${LEGACY_CHAT_AAD_PREFIX}\n${chatID}`));
}

function legacyChatAAD(chatID: string): Uint8Array {
  return utf8ToBytes(`${LEGACY_CHAT_AAD_PREFIX}\n${chatID}\n${LEGACY_CHAT_KEY_VERSION}`);
}

function legacyDeviceChatAAD(chatID: string): Uint8Array {
  return utf8ToBytes(`${LEGACY_DEVICE_CHAT_AAD_PREFIX}\n${chatID}\n${LEGACY_DEVICE_CHAT_KEY_VERSION}`);
}

/** Returns a copy of the device Key-B for legacy chat reads/device proof use. */
export async function loadChatMessageKey(session: Session): Promise<Uint8Array> {
	if (session.account_type === "demo") throw new Error("legacy_chat_key_unavailable");
	const { loadStoredDeviceKeyB } = await loadDeviceKeyManagement();
	const device = await loadStoredDeviceKeyB(session.user_id);
	if (!device) throw new Error("legacy_chat_key_unavailable");
	try {
		if (device.keyB.length !== 32) throw new Error("chat_key_unavailable");
    return device.keyB.slice();
  } finally {
    device.keyB.fill(0);
  }
}

type ChatDeviceProofBundle = Pick<DeviceKeyBundle, "device">;

export type ChatContentKeyLoadOptions = {
  /** Do not create a new DEK when existing chat-dek-v1 ciphertext is present. */
  allowCreate?: boolean;
};

async function ensureChatDeviceProofBundle(session: Session, allowCreate = true): Promise<ChatDeviceProofBundle> {
  const { ensureDeviceKeyB, loadStoredDeviceKeyB } = await loadDeviceKeyManagement();
  const device = allowCreate
    ? await ensureDeviceKeyB(session)
    : await loadStoredDeviceKeyB(session.user_id);
  if (!device) throw new Error("chat_device_proof_unavailable");
  return { device };
}

/**
 * Loads the stable per-chat DEK. Ordinary reads need only the stored signing
 * key for the device proof; the X25519 agreement key is requested lazily only
 * when a device envelope must actually be opened or a new envelope set must
 * be created. This keeps restart-time chat reads outside the recent-Passkey
 * registration boundary.
 */
export async function loadChatContentKey(
  chatID: string,
  session: Session,
  signal?: AbortSignal,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
  options: ChatContentKeyLoadOptions = {},
): Promise<Uint8Array> {
  if (!chatID) throw new Error("chat_key_unavailable");
  if (session.account_type === "demo") {
    return loadDemoChatKey(chatID, session, signal);
  }
  const {
    loadStoredKeyA,
    loadStoredKeyEnvelope,
    listKeyEnvelopes,
  } = await loadDeviceKeyManagement();
  let deviceBundle = await ensureChatDeviceProofBundle(session, options.allowCreate !== false);
  let agreementBundle: DeviceKeyBundle | null = null;
  const ensureAgreementBundle = async (): Promise<DeviceKeyBundle> => {
    if (agreementBundle) return agreementBundle;
    const next = await ensureChatDeviceAgreementKey(session);
    wipeChatDeviceProofBundle(deviceBundle);
    agreementBundle = next;
    deviceBundle = next;
    return next;
  };
  let keyA: Uint8Array | null = null;
  let accountDataKey: Uint8Array | null = null;
  let contentKey: Uint8Array | null = null;
  let returned = false;
  try {
    let rootEnvelope = await loadStoredKeyEnvelope(session.user_id);
    if (!rootEnvelope) {
      // A transferred/recovered device may already have a usable device
      // envelope while the root envelope is still behind the recent-Passkey
      // gate. Do not make device-envelope chat recovery depend on fetching it.
      const remoteEnvelopes = await listKeyEnvelopes(session).catch(() => []);
      rootEnvelope = remoteEnvelopes[0] ?? null;
    }
    if (rootEnvelope) {
      keyA = await loadStoredKeyA(session.user_id);
      if (keyA) accountDataKey = deriveAccountDataKey(keyA, rootEnvelope.kdf_params.data_salt);
    }

    const stored = await getChatKeyEnvelope(chatID, session, deviceBundle, signal);
    const storedCommitment = chatKeyEnvelopeCommitment(stored);
    if (stored.account_envelope && accountDataKey) {
      try {
        contentKey = unwrapChatKeyForAccount(
          stored.account_envelope.envelope,
          accountDataKey,
          session.user_id,
          chatID,
        );
      } catch {
        contentKey = null;
      }
      if (contentKey && storedCommitment && chatKeyCommitment(contentKey) !== storedCommitment) {
        contentKey.fill(0);
        contentKey = null;
      }
    }
    if (!contentKey && stored.device_envelope) {
      const bundle = await ensureAgreementBundle();
      try {
        contentKey = unwrapChatKeyForDevice(
          stored.device_envelope.envelope,
          bundle.agreement.privateKey,
          chatID,
          session.user_id,
          bundle.device.deviceID,
        );
      } catch {
        contentKey = null;
      }
      if (contentKey && storedCommitment && chatKeyCommitment(contentKey) !== storedCommitment) {
        contentKey.fill(0);
        contentKey = null;
      }
    }
    if (contentKey) {
      const commitment = chatKeyCommitment(contentKey);
      if (!stored.account_envelope && accountDataKey) {
        const accountEnvelope = await wrapChatKeyForAccount(
          contentKey,
          accountDataKey,
          session.user_id,
          chatID,
          random,
        );
        try {
          await saveChatKeyEnvelopes(chatID, [{
            scope: "account",
            user_id: session.user_id,
            device_id: "",
            key_version: CHAT_ACCOUNT_KEY_ENVELOPE_VERSION,
            public_key: "",
            algorithm: CHAT_ACCOUNT_KEY_WRAPPING_ALGORITHM,
            envelope: accountEnvelope,
            key_commitment: commitment,
          }], session, deviceBundle, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          if (!(error instanceof APIError) || error.code !== "chat_key_envelope_authority_required") throw error;
        }
      }
      if (!storedCommitment) {
        try {
          await ensureChatKeyManifest(chatID, contentKey, stored, session, deviceBundle, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          if (!(error instanceof APIError) || error.code !== "chat_key_envelope_authority_required") throw error;
        }
      }
      try {
        await provisionMissingChatDeviceEnvelopes(chatID, contentKey, session, deviceBundle, signal, random);
      } catch (error) {
        // The current device can still read and write with its chat DEK when a
        // newly registered peer device is temporarily unavailable. Abort is
        // different: do not return a key after the caller cancelled.
        if (signal?.aborted) throw error;
      }
      returned = true;
      return contentKey;
    }

    if (stored.account_envelope || stored.device_envelope) {
      throw new Error("chat_key_unwrap_failed");
    }
    if (options.allowCreate === false) throw new Error("chat_key_envelope_missing");
    if (!accountDataKey) throw new Error("chat_key_recovery_unavailable");

    const generatedKey = await random(32);
    if (generatedKey.length !== 32) {
      generatedKey.fill(0);
      throw new Error("chat_key_randomness_invalid");
    }
    try {
      const generatedCommitment = chatKeyCommitment(generatedKey);
      const accountEnvelope = await wrapChatKeyForAccount(
        generatedKey,
        accountDataKey,
        session.user_id,
        chatID,
        random,
      );
      // Creating a new chat DEK requires agreement public keys for every
      // participant device. This is the one migration/setup step that may
      // legitimately require recent Passkey authorization.
      await ensureAgreementBundle();
      const recipients = await getChatKeyRecipients(chatID, session, deviceBundle, signal);
      const deviceEnvelopes = await Promise.all(recipients.map(async (recipient) => ({
        scope: "device" as const,
        user_id: recipient.user_id,
        device_id: recipient.device_id,
        key_version: CHAT_DEVICE_KEY_ENVELOPE_VERSION,
        public_key: recipient.public_key,
        algorithm: CHAT_DEVICE_KEY_WRAPPING_ALGORITHM,
        key_commitment: generatedCommitment,
        envelope: await wrapChatKeyForDevice(
          generatedKey,
          recipient.public_key,
          chatID,
          recipient.user_id,
          recipient.device_id,
          random,
        ),
      })));
      await saveChatKeyEnvelopes(chatID, [{
        scope: "account",
        user_id: session.user_id,
        device_id: "",
        key_version: CHAT_ACCOUNT_KEY_ENVELOPE_VERSION,
        public_key: "",
        algorithm: CHAT_ACCOUNT_KEY_WRAPPING_ALGORITHM,
        envelope: accountEnvelope,
        key_commitment: generatedCommitment,
      }, ...deviceEnvelopes], session, deviceBundle, signal);
      contentKey = generatedKey.slice();
      returned = true;
      return contentKey;
    } catch (error) {
      // Two devices can initialize the same chat concurrently. Re-read the
      // immutable row once and use the winner instead of creating a split key.
      const winner = await getChatKeyEnvelope(chatID, session, deviceBundle, signal).catch(() => null);
      const winnerCommitment = winner ? chatKeyEnvelopeCommitment(winner) : "";
      if (winner?.account_envelope && accountDataKey) {
        try {
          contentKey = unwrapChatKeyForAccount(winner.account_envelope.envelope, accountDataKey, session.user_id, chatID);
          if (winnerCommitment && chatKeyCommitment(contentKey) !== winnerCommitment) {
            contentKey.fill(0);
            contentKey = null;
            throw new Error("chat_key_commitment_mismatch");
          }
          returned = true;
          return contentKey;
        } catch {
          // Preserve the original failure below; an invalid winner must not be
          // silently replaced with another chat key.
        }
      }
      if (winner?.device_envelope) {
        try {
          // The winning initializer may belong to the other participant, so
          // there may be no account envelope for this caller. The immutable
          // device envelope is still sufficient to recover the same DEK.
          const bundle = await ensureAgreementBundle();
          contentKey = unwrapChatKeyForDevice(
            winner.device_envelope.envelope,
            bundle.agreement.privateKey,
            chatID,
            session.user_id,
            bundle.device.deviceID,
          );
          if (winnerCommitment && chatKeyCommitment(contentKey) !== winnerCommitment) {
            contentKey.fill(0);
            contentKey = null;
            throw new Error("chat_key_commitment_mismatch");
          }
          returned = true;
          return contentKey;
        } catch {
          // Preserve the original failure below; an invalid winner must not be
          // silently replaced with another chat key.
        }
      }
      throw error;
    } finally {
      generatedKey.fill(0);
    }
  } finally {
    keyA?.fill(0);
    accountDataKey?.fill(0);
    if (!returned) contentKey?.fill(0);
    if (agreementBundle) wipeDeviceBundle(agreementBundle);
    else wipeChatDeviceProofBundle(deviceBundle);
    // The returned key is intentionally owned by the caller and is not wiped.
  }
}

export async function listChats(
  session: Session,
  signal?: AbortSignal,
): Promise<ChatSummary[]> {
  const response = await requestAPI<DataResponse<ChatSummary[]>>(
    "/chats",
    session,
    { method: "GET", signal },
  );
  return requireArrayData(response, "chats");
}

export async function getChat(
  chatID: string,
  session: Session,
  signal?: AbortSignal,
): Promise<ChatSummary> {
  const response = await requestAPI<DataResponse<ChatSummary>>(
    `/chats/${encodeURIComponent(chatID)}`,
    session,
    { method: "GET", signal },
  );
  if (!response.data || typeof response.data.id !== "string") {
    throw new Error("chat summary response is invalid");
  }
  return response.data;
}

export async function listChatMessages(
  chatID: string,
  session: Session,
  options: { after?: number; before?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<ChatMessagePage> {
  const response = await requestAPI<DataResponse<ChatMessagePage>>(
    `/chats/${encodeURIComponent(chatID)}/messages${chatQuery(options.after, options.limit, options.before)}`,
    session,
    { method: "GET", signal },
  );
  if (!response.data || !Array.isArray(response.data.items)) {
    throw new Error("chat messages response is invalid");
  }
  return response.data;
}

export const CHAT_MESSAGE_PAGE_SIZE = 100;
export const CHAT_MESSAGE_WINDOW_LIMIT = 500;

export type ChatMessageWindow = {
  items: EncryptedChatMessage[];
  hasMoreOlder: boolean;
  truncated: boolean;
};

/**
 * Loads the newest bounded window by walking the before cursor backwards.
 * Pages are returned in display order and never exceed the client window cap.
 */
export async function listLatestChatMessages(
  chatID: string,
  session: Session,
  latestSequence: number,
  maxMessages = CHAT_MESSAGE_WINDOW_LIMIT,
  signal?: AbortSignal,
): Promise<ChatMessageWindow> {
  const boundedMax = Math.max(1, Math.min(Math.floor(maxMessages), CHAT_MESSAGE_WINDOW_LIMIT));
  if (!Number.isSafeInteger(latestSequence) || latestSequence < 0) {
    throw new Error("chat latest sequence is invalid");
  }

  // Older deployments did not expose last_message_sequence. Keep a safe
  // forward-cursor fallback so the client remains compatible during rollout.
  if (latestSequence === 0) {
    let after = 0;
    const items: EncryptedChatMessage[] = [];
    let hasMoreOlder = false;
    let truncated = false;
    while (items.length < boundedMax) {
      const page = await listChatMessages(
        chatID,
        session,
        { after, limit: Math.min(CHAT_MESSAGE_PAGE_SIZE, boundedMax - items.length) },
        signal,
      );
      items.push(...page.items);
      if (!page.has_more || page.items.length === 0) break;
      hasMoreOlder = true;
      const nextAfter = page.next_after ?? page.items[page.items.length - 1]?.sequence;
      if (!nextAfter || nextAfter <= after) break;
      after = nextAfter;
      truncated = true;
    }
    return { items, hasMoreOlder, truncated };
  }

  let before = latestSequence + 1;
  const pages: EncryptedChatMessage[][] = [];
  let hasMoreOlder = false;
  let truncated = false;
  let collected = 0;
  while (collected < boundedMax) {
    const page = await listChatMessages(
      chatID,
      session,
      { before, limit: Math.min(CHAT_MESSAGE_PAGE_SIZE, boundedMax - collected) },
      signal,
    );
    if (page.items.length === 0) break;
    pages.unshift(page.items);
    collected += page.items.length;
    if (!page.has_more) {
      hasMoreOlder = false;
      break;
    }
    hasMoreOlder = true;
    truncated = collected >= boundedMax;
    const nextBefore = page.next_before ?? page.items[0]?.sequence;
    if (!nextBefore || nextBefore >= before) break;
    before = nextBefore;
  }
  return { items: pages.flat(), hasMoreOlder, truncated };
}

/** Loads a bounded forward delta from a known sequence cursor. */
export async function listChatMessageDelta(
  chatID: string,
  session: Session,
  after: number,
  maxMessages = CHAT_MESSAGE_WINDOW_LIMIT,
  signal?: AbortSignal,
): Promise<ChatMessageWindow> {
  if (!Number.isSafeInteger(after) || after < 0) throw new Error("chat message cursor is invalid");
  const boundedMax = Math.max(1, Math.min(Math.floor(maxMessages), CHAT_MESSAGE_WINDOW_LIMIT));
  let cursor = after;
  const items: EncryptedChatMessage[] = [];
  let truncated = false;
  while (items.length < boundedMax) {
    const page = await listChatMessages(
      chatID,
      session,
      { after: cursor, limit: Math.min(CHAT_MESSAGE_PAGE_SIZE, boundedMax - items.length) },
      signal,
    );
    items.push(...page.items);
    if (!page.has_more || page.items.length === 0) break;
    const nextAfter = page.next_after ?? page.items[page.items.length - 1]?.sequence;
    if (!nextAfter || nextAfter <= cursor) break;
    cursor = nextAfter;
    truncated = items.length >= boundedMax;
  }
  return { items, hasMoreOlder: false, truncated };
}

function signedChatAPIPath(path: string): string {
  const base = new URL(API_BASE_URL).pathname.replace(/\/+$/u, "");
  return `${base}${path}`;
}

async function deviceAttachmentRequest(
  path: string,
  session: Session,
  bundle: ChatDeviceProofBundle,
  method: "GET" | "PUT" | "POST",
  body?: Uint8Array,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Response> {
  const { createDeviceProofHeaders } = await loadDeviceKeyManagement();
  const proof = await createDeviceProofHeaders(
    session,
    bundle.device,
    method,
    signedChatAPIPath(path),
    body ?? new Uint8Array(),
  );
  return fetchWithAutoRefresh(path, session, {
    method,
    headers: { ...proof, ...headers },
    ...(body ? { body: body as unknown as BodyInit } : {}),
    signal,
  }, 60_000);
}

async function ensureChatDeviceAgreementKey(session: Session): Promise<DeviceKeyBundle> {
  const { ensureDeviceAgreementKey } = await loadDeviceKeyManagement();
  return ensureDeviceAgreementKey(session);
}

function parseChatKeyEnvelope(value: unknown): ChatKeyEnvelope {
  if (!value || typeof value !== "object") throw new Error("Invalid chat key envelope response");
  const candidate = value as Partial<ChatKeyEnvelope>;
  const keyCommitment = candidate.key_commitment === undefined ? "" : candidate.key_commitment;
  if ((candidate.scope !== "account" && candidate.scope !== "device")
    || typeof candidate.user_id !== "string" || !candidate.user_id
    || typeof candidate.device_id !== "string"
    || typeof candidate.key_version !== "string"
    || typeof candidate.public_key !== "string"
    || typeof candidate.algorithm !== "string"
    || typeof candidate.envelope !== "string"
    || typeof keyCommitment !== "string"
    || candidate.envelope.length === 0 || candidate.envelope.length > 16 * 1024) {
    throw new Error("Invalid chat key envelope response");
  }
  if (candidate.scope === "account") {
    if (candidate.device_id !== ""
      || candidate.key_version !== CHAT_ACCOUNT_KEY_ENVELOPE_VERSION
      || candidate.public_key !== ""
      || candidate.algorithm !== CHAT_ACCOUNT_KEY_WRAPPING_ALGORITHM) {
      throw new Error("Invalid chat account key envelope response");
    }
  } else if (candidate.device_id === ""
    || candidate.key_version !== CHAT_DEVICE_KEY_ENVELOPE_VERSION
    || candidate.algorithm !== CHAT_DEVICE_KEY_WRAPPING_ALGORITHM) {
    throw new Error("Invalid chat device key envelope response");
  } else {
    try {
      if (fromBase64URL(candidate.public_key).length !== 32) throw new Error("Invalid key");
    } catch {
      throw new Error("Invalid chat device key envelope response");
    }
  }
  try {
    if (fromBase64URL(candidate.envelope).length < 32) throw new Error("Invalid envelope");
  } catch {
    throw new Error("Invalid chat key envelope response");
  }
  if (keyCommitment !== "") {
    try {
      if (fromBase64URL(keyCommitment).length !== 32) throw new Error("Invalid commitment");
    } catch {
      throw new Error("Invalid chat key envelope commitment response");
    }
  }
  return { ...candidate, key_commitment: keyCommitment } as ChatKeyEnvelope;
}

function parseChatKeyEnvelopeBundle(value: unknown): ChatKeyEnvelopeBundle {
  if (!value || typeof value !== "object") throw new Error("Invalid chat key envelope response");
  const candidate = value as { account_envelope?: unknown; device_envelope?: unknown };
  const result: ChatKeyEnvelopeBundle = {};
  if (candidate.account_envelope !== undefined && candidate.account_envelope !== null) {
    const envelope = parseChatKeyEnvelope(candidate.account_envelope);
    if (envelope.scope !== "account") throw new Error("Invalid chat account key envelope response");
    result.account_envelope = envelope;
  }
  if (candidate.device_envelope !== undefined && candidate.device_envelope !== null) {
    const envelope = parseChatKeyEnvelope(candidate.device_envelope);
    if (envelope.scope !== "device") throw new Error("Invalid chat device key envelope response");
    result.device_envelope = envelope;
  }
  return result;
}

function chatKeyEnvelopeCommitment(bundle: ChatKeyEnvelopeBundle): string {
  const commitments = [bundle.account_envelope?.key_commitment, bundle.device_envelope?.key_commitment]
    .filter((value): value is string => Boolean(value));
  if (commitments.length > 1 && commitments.some((value) => value !== commitments[0])) {
    throw new Error("chat_key_commitment_mismatch");
  }
  return commitments[0] ?? "";
}

async function ensureChatKeyManifest(
  chatID: string,
  contentKey: Uint8Array,
  stored: ChatKeyEnvelopeBundle,
  session: Session,
  deviceBundle: ChatDeviceProofBundle,
  signal: AbortSignal | undefined,
): Promise<void> {
  const existing = stored.account_envelope ?? stored.device_envelope;
  if (!existing || existing.key_commitment) return;
  await saveChatKeyEnvelopes(chatID, [{
    ...existing,
    key_commitment: chatKeyCommitment(contentKey),
  }], session, deviceBundle, signal);
}

export async function getChatKeyEnvelope(
  chatID: string,
  session: Session,
  deviceBundle?: ChatDeviceProofBundle,
  signal?: AbortSignal,
): Promise<ChatKeyEnvelopeBundle> {
  const bundle = deviceBundle ?? await ensureChatDeviceProofBundle(session);
  try {
    const path = `/chats/${encodeURIComponent(chatID)}/key-envelope`;
    const response = await deviceAttachmentRequest(path, session, bundle, "GET", undefined, undefined, signal);
    const payload = await readAttachmentJSON<DataResponse<unknown>>(response);
    return parseChatKeyEnvelopeBundle(payload.data);
  } finally {
    if (!deviceBundle) wipeChatDeviceProofBundle(bundle);
  }
}

export async function saveChatKeyEnvelopes(
  chatID: string,
  envelopes: ChatKeyEnvelope[],
  session: Session,
  deviceBundle?: ChatDeviceProofBundle,
  signal?: AbortSignal,
): Promise<void> {
  if (envelopes.length === 0 || envelopes.length > 64) throw new Error("Invalid chat key envelopes");
  const bundle = deviceBundle ?? await ensureChatDeviceProofBundle(session);
  try {
    const body = new TextEncoder().encode(JSON.stringify({ envelopes }));
    const path = `/chats/${encodeURIComponent(chatID)}/key-envelopes`;
    const response = await deviceAttachmentRequest(path, session, bundle, "PUT", body, {
      "Content-Type": "application/json",
    }, signal);
    if (!response.ok) await readAttachmentJSON(response);
  } finally {
    if (!deviceBundle) wipeChatDeviceProofBundle(bundle);
  }
}

export async function getChatKeyRecipients(
  chatID: string,
  session: Session,
  deviceBundle?: ChatDeviceProofBundle,
  signal?: AbortSignal,
): Promise<ChatKeyRecipient[]> {
  const bundle = deviceBundle ?? await ensureChatDeviceProofBundle(session);
  try {
    const path = `/chats/${encodeURIComponent(chatID)}/key-recipients`;
    const response = await deviceAttachmentRequest(path, session, bundle, "GET", undefined, undefined, signal);
    const payload = await readAttachmentJSON<DataResponse<unknown>>(response);
    return parseChatKeyRecipients(payload.data);
  } finally {
    if (!deviceBundle) wipeChatDeviceProofBundle(bundle);
  }
}

async function provisionMissingChatDeviceEnvelopes(
  chatID: string,
  contentKey: Uint8Array,
  session: Session,
  deviceBundle: ChatDeviceProofBundle,
  signal: AbortSignal | undefined,
  random: (length: number) => Promise<Uint8Array>,
): Promise<void> {
  const recipients = await getChatKeyRecipients(chatID, session, deviceBundle, signal);
  const missing = recipients.filter((recipient) => !recipient.envelope_present);
  if (missing.length === 0) return;
  const buildEnvelopes = (targets: ChatKeyRecipient[]) => Promise.all(targets.map(async (recipient) => ({
    scope: "device" as const,
    user_id: recipient.user_id,
    device_id: recipient.device_id,
    key_version: CHAT_DEVICE_KEY_ENVELOPE_VERSION,
    public_key: recipient.public_key,
    algorithm: CHAT_DEVICE_KEY_WRAPPING_ALGORITHM,
    key_commitment: chatKeyCommitment(contentKey),
    envelope: await wrapChatKeyForDevice(
      contentKey,
      recipient.public_key,
      chatID,
      recipient.user_id,
      recipient.device_id,
      random,
    ),
  })));
  const envelopes = await buildEnvelopes(missing);
  try {
    await saveChatKeyEnvelopes(chatID, envelopes, session, deviceBundle, signal);
  } catch (error) {
    // A non-owner may be racing an owner provisioning another device. Retry
    // only the caller's own devices; never ask the participant to write the
    // other participant's immutable envelope row.
    if (!(error instanceof APIError) || error.code !== "chat_key_envelope_authority_required") throw error;
    const ownMissing = missing.filter((recipient) => recipient.user_id === session.user_id);
    if (ownMissing.length === 0) throw error;
    await saveChatKeyEnvelopes(chatID, await buildEnvelopes(ownMissing), session, deviceBundle, signal);
  }
}

function attachmentResponseErrorCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "request_failed";
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" && code ? code : "request_failed";
}

async function readAttachmentJSON<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const data = body && typeof body === "object" && "data" in body
      ? (body as { data?: unknown }).data
      : undefined;
    const retryAfterHeader = response.headers.get("Retry-After")?.trim() ?? "";
    const parsedRetryAfter = /^\d+$/u.test(retryAfterHeader) ? Number(retryAfterHeader) : NaN;
    const retryAfterSeconds = Number.isSafeInteger(parsedRetryAfter) && parsedRetryAfter > 0
      ? parsedRetryAfter
      : undefined;
    throw new APIError(response.status, attachmentResponseErrorCode(body), data, retryAfterSeconds);
  }
  return body as T;
}

function wipeChatDeviceProofBundle(bundle: ChatDeviceProofBundle): void {
  bundle.device.keyB.fill(0);
}

function wipeDeviceBundle(bundle: DeviceKeyBundle): void {
  wipeChatDeviceProofBundle(bundle);
  bundle.agreement.privateKey.fill(0);
}

function isAttachmentNonce(value: string): boolean {
  try {
    return fromBase64URL(value).length === 12;
  } catch {
    return false;
  }
}

function parseChatAttachment(value: unknown): ChatAttachment {
  if (!value || typeof value !== "object") throw new Error("Invalid chat attachment response");
  const candidate = value as Partial<ChatAttachment>;
  const contentType = candidate.content_type;
  const sizeBytes = candidate.size_bytes;
	const cipherSHA256 = candidate.cipher_sha256;
	const nonce = candidate.nonce;
	const isRegularAttachment = candidate.algorithm === CHAT_ATTACHMENT_ALGORITHM
	  && candidate.key_version === CHAT_ATTACHMENT_KEY_VERSION;
	const isDemoAttachment = candidate.algorithm === DEMO_CHAT_ALGORITHM
	  && candidate.key_version === DEMO_CHAT_KEY_VERSION;
	if (typeof candidate.id !== "string" || !candidate.id
    || typeof candidate.chat_id !== "string" || !candidate.chat_id
    || typeof contentType !== "string" || !isChatAttachmentContentType(contentType)
    || typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 16 || sizeBytes > CHAT_ATTACHMENT_MAX_BYTES
	    || typeof cipherSHA256 !== "string" || !/^[0-9a-f]{64}$/u.test(cipherSHA256)
	    || typeof nonce !== "string" || !isAttachmentNonce(nonce)
	    || (!isRegularAttachment && !isDemoAttachment)
	    || typeof candidate.created_at !== "string") {
    throw new Error("Invalid chat attachment response");
  }
  return candidate as ChatAttachment;
}

export function parseChatAttachmentRecipients(value: unknown): ChatAttachmentKeyRecipient[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("Invalid chat attachment recipient response");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid chat attachment recipient response");
    const candidate = item as Partial<ChatAttachmentKeyRecipient>;
    if (typeof candidate.user_id !== "string" || !candidate.user_id
      || typeof candidate.device_id !== "string" || !candidate.device_id
      || candidate.key_version !== "x25519-v1" || typeof candidate.public_key !== "string") {
      throw new Error("Invalid chat attachment recipient response");
    }
    try {
      if (fromBase64URL(candidate.public_key).length !== 32) throw new Error("Invalid key");
    } catch {
      throw new Error("Invalid chat attachment recipient response");
    }
    return candidate as ChatAttachmentKeyRecipient;
  });
}

function parseChatKeyRecipients(value: unknown): ChatKeyRecipient[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new Error("Invalid chat key recipient response");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid chat key recipient response");
    const candidate = item as Partial<ChatKeyRecipient>;
    if (typeof candidate.user_id !== "string" || !candidate.user_id
      || typeof candidate.device_id !== "string" || !candidate.device_id
      || candidate.key_version !== "x25519-v1" || typeof candidate.public_key !== "string"
      || typeof candidate.envelope_present !== "boolean") {
      throw new Error("Invalid chat key recipient response");
    }
    try {
      if (fromBase64URL(candidate.public_key).length !== 32) throw new Error("Invalid key");
    } catch {
      throw new Error("Invalid chat key recipient response");
    }
    return candidate as ChatKeyRecipient;
  });
}

export async function getChatAttachmentKeyRecipients(
  chatID: string,
  session: Session,
  deviceBundle?: DeviceKeyBundle,
  signal?: AbortSignal,
): Promise<ChatAttachmentKeyRecipient[]> {
  const bundle = deviceBundle ?? await ensureChatDeviceAgreementKey(session);
  try {
    const path = `/chats/${encodeURIComponent(chatID)}/attachment-key-recipients`;
    const response = await deviceAttachmentRequest(path, session, bundle, "GET", undefined, undefined, signal);
    const payload = await readAttachmentJSON<DataResponse<unknown>>(response);
    return parseChatAttachmentRecipients(payload.data);
  } finally {
    if (!deviceBundle) wipeDeviceBundle(bundle);
  }
}

function assertUploadedAttachmentMatches(
  attachment: ChatAttachment,
  encrypted: EncryptedChatAttachment,
  chatID: string,
): void {
  if (attachment.chat_id !== chatID
    || attachment.content_type !== encrypted.contentType
    || attachment.size_bytes !== encrypted.ciphertext.length
    || attachment.nonce !== encrypted.nonce
    || attachment.algorithm !== encrypted.algorithm
    || attachment.key_version !== encrypted.keyVersion
    || attachment.cipher_sha256 !== hashBytesHex(encrypted.ciphertext)) {
    throw new Error("Invalid chat attachment upload response");
  }
}

export async function uploadChatAttachment(
  chatID: string,
  encrypted: EncryptedChatAttachment,
  session: Session,
  deviceBundle?: DeviceKeyBundle,
  signal?: AbortSignal,
): Promise<ChatAttachment> {
  if (encrypted.ciphertext.length > CHAT_ATTACHMENT_MAX_BYTES) throw new Error("chat_attachment_too_large");
  const bundle = deviceBundle ?? await ensureChatDeviceAgreementKey(session);
  try {
    const path = `/chats/${encodeURIComponent(chatID)}/attachments`;
    const response = await deviceAttachmentRequest(path, session, bundle, "POST", encrypted.ciphertext, {
      "Content-Type": "application/octet-stream",
      "X-Chat-Attachment-Content-Type": encrypted.contentType,
      "X-Chat-Attachment-Nonce": encrypted.nonce,
      "X-Chat-Attachment-Algorithm": encrypted.algorithm,
      "X-Chat-Attachment-Key-Version": encrypted.keyVersion,
    }, signal);
    const payload = await readAttachmentJSON<DataResponse<unknown>>(response);
    const attachment = parseChatAttachment(payload.data);
    assertUploadedAttachmentMatches(attachment, encrypted, chatID);
    return attachment;
  } finally {
    if (!deviceBundle) wipeDeviceBundle(bundle);
	}
}

async function uploadDemoChatAttachment(
	chatID: string,
	encrypted: EncryptedDemoChatAttachment,
	session: Session,
	signal?: AbortSignal,
): Promise<ChatAttachment> {
	let ciphertext: Uint8Array | null = null;
	try {
		ciphertext = demoBase64URLToBytes(encrypted.ciphertext);
		if (ciphertext.length < 16 || ciphertext.length > CHAT_ATTACHMENT_MAX_BYTES) {
			throw new Error("chat_attachment_too_large");
		}
		const path = `/chats/${encodeURIComponent(chatID)}/attachments`;
		const response = await fetchWithAutoRefresh(path, session, {
			method: "POST",
			headers: {
				"Content-Type": "application/octet-stream",
				"X-Chat-Attachment-Content-Type": encrypted.contentType,
				"X-Chat-Attachment-Nonce": encrypted.nonce,
				"X-Chat-Attachment-Algorithm": encrypted.algorithm,
				"X-Chat-Attachment-Key-Version": encrypted.keyVersion,
			},
			body: ciphertext as unknown as BodyInit,
			signal,
		}, 60_000);
		const payload = await readAttachmentJSON<DataResponse<unknown>>(response);
		const attachment = parseChatAttachment(payload.data);
		if (attachment.chat_id !== chatID
			|| attachment.content_type !== encrypted.contentType
			|| attachment.size_bytes !== ciphertext.length
			|| attachment.nonce !== encrypted.nonce
			|| attachment.algorithm !== encrypted.algorithm
			|| attachment.key_version !== encrypted.keyVersion
			|| attachment.cipher_sha256 !== hashBytesHex(ciphertext)) {
			throw new Error("Invalid demo chat attachment upload response");
		}
		return attachment;
	} finally {
		ciphertext?.fill(0);
	}
}

export async function saveChatAttachmentKeyEnvelopes(
  chatID: string,
  attachmentID: string,
  envelopes: ChatAttachmentKeyEnvelopeInput[],
  session: Session,
  deviceBundle?: DeviceKeyBundle,
  signal?: AbortSignal,
): Promise<void> {
  if (envelopes.length === 0 || envelopes.length > 32) throw new Error("Invalid chat attachment envelopes");
  const bundle = deviceBundle ?? await ensureChatDeviceAgreementKey(session);
  try {
    const body = new TextEncoder().encode(JSON.stringify({ envelopes }));
    const path = `/chats/${encodeURIComponent(chatID)}/attachments/${encodeURIComponent(attachmentID)}/envelopes`;
    const response = await deviceAttachmentRequest(path, session, bundle, "PUT", body, {
      "Content-Type": "application/json",
    }, signal);
    if (!response.ok) await readAttachmentJSON(response);
  } finally {
    if (!deviceBundle) wipeDeviceBundle(bundle);
  }
}

export async function sendChatAttachmentMessage(
  chatID: string,
  attachmentID: string,
  session: Session,
  clientMessageID = createClientMessageID(),
  signal?: AbortSignal,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
  contentKey?: Uint8Array,
): Promise<EncryptedChatMessage> {
  // The marker is encrypted like all chat message bodies. The image itself is
  // never placed in this JSON or sent to the message endpoint.
  const resolvedContentKey = contentKey ?? await loadChatContentKey(chatID, session, signal, random);
  try {
    const encrypted = await encryptChatPlaintext(
      chatID,
      JSON.stringify({ type: "image" }),
      resolvedContentKey,
      random,
      false,
      "image",
      session.account_type === "demo",
    );
    const response = await requestAPI<DataResponse<EncryptedChatMessage>>(
      `/chats/${encodeURIComponent(chatID)}/messages`,
      session,
      {
        method: "POST",
        body: JSON.stringify({
          client_message_id: clientMessageID,
          ...encrypted,
          content_type: "image",
          attachment_id: attachmentID,
        }),
        signal,
      },
    );
    if (!response.data) throw new Error("chat attachment message response is empty");
    return response.data;
  } finally {
    if (!contentKey) resolvedContentKey.fill(0);
  }
}

/** Executes the complete sender flow and never returns a content key. */
export async function sendChatImage(
  chatID: string,
  plaintext: Uint8Array,
  contentType: ChatAttachmentContentType,
  session: Session,
  clientMessageID = createClientMessageID(),
  signal?: AbortSignal,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
): Promise<ChatImageSendResult> {
	if (session.account_type === "demo") {
		let contentKey: Uint8Array | null = null;
		try {
			contentKey = await loadChatContentKey(chatID, session, signal, random);
			const encrypted = await encryptDemoChatBytes(chatID, plaintext, contentKey, "image", random);
			const attachment = await uploadDemoChatAttachment(chatID, {
				ciphertext: encrypted.ciphertext,
				nonce: encrypted.nonce,
				algorithm: encrypted.algorithm,
				keyVersion: encrypted.key_version,
				contentType,
			}, session, signal);
			const message = await sendChatAttachmentMessage(
				chatID,
				attachment.id,
				session,
				clientMessageID,
				signal,
				random,
				contentKey,
			);
			return { message, attachment };
		} finally {
			contentKey?.fill(0);
		}
	}
	await ensureChatAttachmentEncryptionAvailable();
  const bundle = await ensureChatDeviceAgreementKey(session);
  let encrypted: EncryptedChatAttachment | null = null;
  let contentKey: Uint8Array | null = null;
  try {
    contentKey = await loadChatContentKey(chatID, session, signal, random);
    encrypted = await encryptChatAttachmentBytes(plaintext, contentType, chatID, random);
    const recipients = await getChatAttachmentKeyRecipients(chatID, session, bundle, signal);
    const attachment = await uploadChatAttachment(chatID, encrypted, session, bundle, signal);
    const envelopes: ChatAttachmentKeyEnvelopeInput[] = await Promise.all(recipients.map(async (recipient) => ({
      user_id: recipient.user_id,
      device_id: recipient.device_id,
      key_version: recipient.key_version,
      public_key: recipient.public_key,
      algorithm: CHAT_ATTACHMENT_WRAPPING_ALGORITHM,
      envelope: await wrapChatAttachmentKey(
        encrypted!.imageKey,
        recipient.public_key,
        chatID,
        attachment.id,
        recipient.device_id,
        attachment.cipher_sha256,
        attachment.nonce,
        random,
      ),
    })));
    await saveChatAttachmentKeyEnvelopes(chatID, attachment.id, envelopes, session, bundle, signal);
    const message = await sendChatAttachmentMessage(chatID, attachment.id, session, clientMessageID, signal, random, contentKey);
    return { message, attachment };
  } finally {
    contentKey?.fill(0);
    encrypted?.imageKey.fill(0);
    encrypted?.ciphertext.fill(0);
    wipeDeviceBundle(bundle);
  }
}

export async function downloadAndDecryptChatAttachment(
  chatID: string,
  attachment: ChatAttachment,
  session: Session,
  signal?: AbortSignal,
): Promise<Uint8Array> {
	if (attachment.chat_id !== chatID) throw new Error("Invalid chat attachment reference");
	if (session.account_type === "demo") {
		return downloadAndDecryptDemoChatAttachment(chatID, attachment, session, signal);
	}
	const bundle = await ensureChatDeviceAgreementKey(session);
  let ciphertext: Uint8Array | null = null;
  let imageKey: Uint8Array | null = null;
  try {
    const basePath = `/chats/${encodeURIComponent(chatID)}/attachments/${encodeURIComponent(attachment.id)}`;
    const envelopeResponse = await deviceAttachmentRequest(`${basePath}/envelope`, session, bundle, "GET", undefined, undefined, signal);
    const envelopePayload = await readAttachmentJSON<DataResponse<unknown>>(envelopeResponse);
    if (!envelopePayload.data || typeof envelopePayload.data !== "object") {
      throw new Error("Invalid chat attachment envelope response");
    }
    const envelopeData = envelopePayload.data as { attachment?: unknown; envelope?: unknown };
    const envelopeAttachment = parseChatAttachment(envelopeData.attachment);
    if (envelopeAttachment.id !== attachment.id
      || envelopeAttachment.chat_id !== attachment.chat_id
      || envelopeAttachment.content_type !== attachment.content_type
      || envelopeAttachment.size_bytes !== attachment.size_bytes
      || envelopeAttachment.cipher_sha256 !== attachment.cipher_sha256
      || envelopeAttachment.nonce !== attachment.nonce
      || envelopeAttachment.algorithm !== attachment.algorithm
      || envelopeAttachment.key_version !== attachment.key_version
      || typeof envelopeData.envelope !== "string"
      || envelopeData.envelope.length === 0
      || envelopeData.envelope.length > 16 * 1024) {
      throw new Error("Invalid chat attachment envelope metadata");
    }
    const envelope = envelopeData.envelope;
    const response = await deviceAttachmentRequest(basePath, session, bundle, "GET", undefined, undefined, signal);
    if (!response.ok) await readAttachmentJSON(response);
    ciphertext = new Uint8Array(await response.arrayBuffer());
    if (ciphertext.length !== attachment.size_bytes
      || ciphertext.length > CHAT_ATTACHMENT_MAX_BYTES
      || hashBytesHex(ciphertext) !== attachment.cipher_sha256) {
      throw new Error("Invalid chat attachment ciphertext");
    }
    const nonce = response.headers.get("X-Chat-Attachment-Nonce");
    const algorithm = response.headers.get("X-Chat-Attachment-Algorithm");
    const keyVersion = response.headers.get("X-Chat-Attachment-Key-Version");
    if (nonce !== attachment.nonce || algorithm !== attachment.algorithm || keyVersion !== attachment.key_version) {
      throw new Error("Invalid chat attachment metadata");
    }
    imageKey = unwrapChatAttachmentKey(
      envelope,
      bundle.agreement.privateKey,
      chatID,
      attachment.id,
      bundle.device.deviceID,
      attachment.cipher_sha256,
      attachment.nonce,
    );
    return decryptChatAttachmentBytes(ciphertext, attachment.nonce, imageKey, attachment.content_type, chatID);
  } finally {
    ciphertext?.fill(0);
    imageKey?.fill(0);
    wipeDeviceBundle(bundle);
	}
}

async function downloadAndDecryptDemoChatAttachment(
	chatID: string,
	attachment: ChatAttachment,
	session: Session,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	if (attachment.algorithm !== DEMO_CHAT_ALGORITHM || attachment.key_version !== DEMO_CHAT_KEY_VERSION) {
		throw new Error("demo_attachment_protocol_mismatch");
	}
	const contentKey = await loadChatContentKey(chatID, session, signal);
	let ciphertext: Uint8Array | null = null;
	try {
		const path = `/chats/${encodeURIComponent(chatID)}/attachments/${encodeURIComponent(attachment.id)}`;
		const response = await fetchWithAutoRefresh(path, session, { method: "GET", signal }, 60_000);
		if (!response.ok) await readAttachmentJSON(response);
		ciphertext = new Uint8Array(await response.arrayBuffer());
		if (ciphertext.length !== attachment.size_bytes
			|| ciphertext.length > CHAT_ATTACHMENT_MAX_BYTES
			|| hashBytesHex(ciphertext) !== attachment.cipher_sha256) {
			throw new Error("Invalid demo chat attachment ciphertext");
		}
		if (response.headers.get("X-Chat-Attachment-Nonce") !== attachment.nonce
			|| response.headers.get("X-Chat-Attachment-Algorithm") !== attachment.algorithm
			|| response.headers.get("X-Chat-Attachment-Key-Version") !== attachment.key_version) {
			throw new Error("Invalid demo chat attachment metadata");
		}
		const plaintext = decryptDemoChatBytes(
			chatID,
			toBase64URL(ciphertext),
			attachment.nonce,
			contentKey,
			"image",
		);
		if (!plaintext) throw new Error("demo_attachment_decrypt_failed");
		return plaintext;
	} finally {
		ciphertext?.fill(0);
		contentKey.fill(0);
	}
}

export async function markChatRead(
  chatID: string,
  lastMessageSequence: number,
  session: Session,
  signal?: AbortSignal,
): Promise<void> {
  await requestAPI<null>(
    `/chats/${encodeURIComponent(chatID)}/read`,
    session,
    {
      method: "POST",
      body: JSON.stringify({ last_message_sequence: lastMessageSequence }),
      signal,
    },
  );
}

export async function issueChatTransportToken(
  chatID: string,
  session: Session,
  signal?: AbortSignal,
): Promise<ChatTransportToken> {
  const response = await requestAPI<DataResponse<ChatTransportToken>>(
    `/chats/${encodeURIComponent(chatID)}/transport-token`,
    session,
    {
      method: "POST",
      body: JSON.stringify({ transport: "webtransport" }),
      signal,
    },
  );
  if (!response.data || typeof response.data.chat_token !== "string"
    || response.data.transport !== "webtransport"
    || !Number.isFinite(Date.parse(response.data.expires_at))) {
    throw new Error("chat transport token response is invalid");
  }
  return response.data;
}

export async function createSafetyReport(
  session: Session,
  input: {
    target_type: SafetyReportTargetType;
    target_id: string;
    reason: ChatReportReason;
    comment?: string;
  },
  signal?: AbortSignal,
): Promise<SafetyReport> {
  const response = await requestAPI<DataResponse<SafetyReport>>(
    "/reports",
    session,
    {
      method: "POST",
      body: JSON.stringify({ ...input, comment: input.comment ?? "" }),
      signal,
    },
  );
  if (!response.data) throw new Error("report response is empty");
  return response.data;
}

export async function blockUser(
  userID: string,
  session: Session,
  signal?: AbortSignal,
): Promise<void> {
  await requestAPI<null>(
    "/blocks",
    session,
    {
      method: "POST",
      body: JSON.stringify({ user_id: userID }),
      signal,
    },
  );
}

export async function encryptChatPlaintext(
  chatID: string,
  plaintext: string,
  contentKey: Uint8Array,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
  includePlaintextCommitment = true,
  contentType: DemoChatContentType = "text",
  demoMode = false,
): Promise<{
  ciphertext: string;
  nonce: string;
  algorithm: typeof CHAT_ALGORITHM;
  key_version: string;
  plaintext_commitment?: string;
  plaintext_commitment_salt?: string;
}> {
  if (contentKey.length !== 32) throw new Error("chat_key_unavailable");
  if (demoMode) {
    const encrypted = await encryptDemoChatPlaintext(chatID, plaintext, contentKey, contentType, random);
    if (!includePlaintextCommitment) return encrypted;
    const salt = await random(16);
    if (salt.length !== 16) {
      salt.fill(0);
      throw new Error("chat_message_randomness_invalid");
    }
    const commitmentKey = chatPlaintextCommitmentKey(chatID, contentKey);
    try {
      const plaintextCommitmentSalt = toBase64URL(salt);
      return {
        ...encrypted,
        plaintext_commitment: chatPlaintextCommitment(plaintext, plaintextCommitmentSalt, commitmentKey),
        plaintext_commitment_salt: plaintextCommitmentSalt,
      };
    } finally {
      commitmentKey.fill(0);
      salt.fill(0);
    }
  }
  const nonce = await random(12);
  const salt = includePlaintextCommitment ? await random(16) : null;
  if (nonce.length !== 12 || (salt !== null && salt.length !== 16)) {
    nonce.fill(0);
    salt?.fill(0);
    throw new Error("chat_message_randomness_invalid");
  }
  const messageKey = chatKey(chatID, contentKey);
  const commitmentKey = salt === null ? null : chatPlaintextCommitmentKey(chatID, contentKey);
  try {
    const ciphertext = gcm(messageKey, nonce, chatAAD(chatID)).encrypt(utf8ToBytes(plaintext));
    const encrypted: {
      ciphertext: string;
      nonce: string;
      algorithm: typeof CHAT_ALGORITHM;
      key_version: typeof CHAT_KEY_VERSION;
    } = {
      ciphertext: toBase64URL(ciphertext),
      nonce: toBase64URL(nonce),
      algorithm: CHAT_ALGORITHM,
      key_version: CHAT_KEY_VERSION,
    };
    if (salt === null) return encrypted;
    const plaintextCommitmentSalt = toBase64URL(salt);
    return {
      ...encrypted,
      plaintext_commitment: chatPlaintextCommitment(plaintext, plaintextCommitmentSalt, commitmentKey as Uint8Array),
      plaintext_commitment_salt: plaintextCommitmentSalt,
    };
  } finally {
    messageKey.fill(0);
    commitmentKey?.fill(0);
    nonce.fill(0);
    salt?.fill(0);
  }
}

/** Commits to the client-visible message text with a client-held HMAC key. */
export function chatPlaintextCommitment(plaintext: string, salt: string, commitmentKey: Uint8Array): string {
  if (commitmentKey.length !== 32) throw new Error("chat_key_unavailable");
  return toBase64URL(hmac(
    sha256,
    commitmentKey,
    utf8ToBytes(`${CHAT_PLAINTEXT_COMMITMENT_DOMAIN}\n${salt}\n${plaintext.trim()}`),
  ));
}

export function decryptChatMessage(
  chatID: string,
  message: EncryptedChatMessage,
  contentKey?: Uint8Array,
  legacyKeyB?: Uint8Array,
): string | null {
  if (message.algorithm !== CHAT_ALGORITHM) return null;
  if (message.key_version === DEMO_CHAT_KEY_VERSION) {
    if (!contentKey || contentKey.length !== 32) return null;
    const contentType = message.content_type ?? "text";
    if (contentType !== "text" && contentType !== "location" && contentType !== "image") return null;
    return decryptDemoChatMessage(chatID, message.ciphertext, message.nonce, contentKey, contentType);
  }
  const isLegacy = message.key_version === LEGACY_CHAT_KEY_VERSION;
  const isLegacyDevice = message.key_version === LEGACY_DEVICE_CHAT_KEY_VERSION;
  const deviceKey = legacyKeyB ?? contentKey;
  if (!isLegacy && !isLegacyDevice && message.key_version !== CHAT_KEY_VERSION) return null;
  if (message.key_version === CHAT_KEY_VERSION && (!contentKey || contentKey.length !== 32)) return null;
  if (isLegacyDevice && (!deviceKey || deviceKey.length !== 32)) return null;
  try {
    const messageKey = isLegacy
      ? legacyChatKey(chatID)
      : isLegacyDevice
        ? legacyDeviceChatKey(chatID, deviceKey as Uint8Array)
        : chatKey(chatID, contentKey as Uint8Array);
    try {
      const plaintext = gcm(
        messageKey,
        fromBase64URL(message.nonce),
        isLegacy ? legacyChatAAD(chatID) : isLegacyDevice ? legacyDeviceChatAAD(chatID) : chatAAD(chatID),
      ).decrypt(fromBase64URL(message.ciphertext));
      return new TextDecoder().decode(plaintext);
    } finally {
      messageKey.fill(0);
    }
  } catch {
    return null;
  }
}

type ChatTranslationAPIResponse = {
  cached?: boolean;
  source_language?: unknown;
  translated_text?: unknown;
  target_language?: unknown;
  message_revision?: unknown;
  ciphertext?: unknown;
  nonce?: unknown;
  algorithm?: unknown;
  key_version?: unknown;
};

export async function saveChatMessageTranslation(
  chatID: string,
  messageID: string,
  encrypted: EncryptedChatTranslation,
  session: Session,
  signal?: AbortSignal,
): Promise<void> {
  await requestAPI<null>(
    `/chats/${encodeURIComponent(chatID)}/messages/${encodeURIComponent(messageID)}/translations/${encodeURIComponent(encrypted.target_language)}`,
    session,
    {
      method: "PUT",
      body: JSON.stringify(encrypted),
      signal,
    },
  );
}

export async function translateChatMessage(
  chatID: string,
  messageID: string,
  messageRevision: string,
  plaintext: string,
  targetLanguage: ChatLanguage,
  session: Session,
  signal?: AbortSignal,
  contentKey?: Uint8Array,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
): Promise<ChatTranslationResult> {
  const requestBody: {
    message_id: string;
    text: string;
    target_language: ChatLanguage;
    plaintext_commitment_key?: string;
  } = { message_id: messageID, text: plaintext, target_language: targetLanguage };
  if (contentKey) {
    const commitmentKey = chatPlaintextCommitmentKey(chatID, contentKey);
    try {
      // This derived key is sent only for the request-scoped binding check. It
      // is never persisted with the message or returned by the API.
      requestBody.plaintext_commitment_key = toBase64URL(commitmentKey);
    } finally {
      commitmentKey.fill(0);
    }
  }
  const response = await requestAPI<DataResponse<ChatTranslationAPIResponse>>(
    `/chats/${encodeURIComponent(chatID)}/translate`,
    session,
    {
      method: "POST",
      body: JSON.stringify(requestBody),
      signal,
    },
  );
  const result = response.data;
  if (!result || result.target_language !== targetLanguage) {
    throw new Error("chat translation response is invalid");
  }
  if (result.cached === true) {
    if (!contentKey || typeof result.message_revision !== "string"
      || typeof result.ciphertext !== "string" || typeof result.nonce !== "string"
      || result.algorithm !== CHAT_ALGORITHM || typeof result.key_version !== "string") {
      throw new Error("chat translation cache response is invalid");
    }
    const decrypted = decryptChatTranslation(chatID, messageID, messageRevision, {
      target_language: targetLanguage,
      ciphertext: result.ciphertext,
      nonce: result.nonce,
      algorithm: CHAT_ALGORITHM,
      key_version: result.key_version,
      message_revision: result.message_revision,
    }, contentKey);
    if (!decrypted) throw new Error("chat translation cache unavailable");
    return decrypted;
  }
  if (typeof result.source_language !== "string" || typeof result.translated_text !== "string") {
    throw new Error("chat translation response is invalid");
  }
  const translated: ChatTranslationResult = {
    source_language: result.source_language,
    translated_text: result.translated_text,
    target_language: targetLanguage,
  };
  if (!isUsableTranslationResult(translated, targetLanguage)) {
    throw new Error("chat translation response is invalid");
  }
  if (contentKey) {
    if (result.message_revision !== messageRevision) throw new Error("chat translation revision mismatch");
    const encrypted = await encryptChatTranslation(chatID, messageID, messageRevision, translated, contentKey, random);
    await saveChatMessageTranslation(chatID, messageID, encrypted, session, signal);
  }
  return translated;
}

export async function updateChatMessage(
  chatID: string,
  messageID: string,
  plaintext: string,
  session: Session,
  signal?: AbortSignal,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
  contentKey?: Uint8Array,
): Promise<EncryptedChatMessage> {
  const resolvedContentKey = contentKey ?? await loadChatContentKey(chatID, session, signal, random);
  try {
    const encrypted = await encryptChatPlaintext(
      chatID,
      plaintext,
      resolvedContentKey,
      random,
      true,
      "text",
      session.account_type === "demo",
    );
    const response = await requestAPI<DataResponse<EncryptedChatMessage>>(
      `/chats/${encodeURIComponent(chatID)}/messages/${encodeURIComponent(messageID)}`,
      session,
      {
        method: "PATCH",
        body: JSON.stringify(encrypted),
        signal,
      },
    );
    if (!response.data) throw new Error("chat message update response is empty");
    return response.data;
  } finally {
    if (!contentKey) resolvedContentKey.fill(0);
  }
}

export async function deleteChatMessage(
  chatID: string,
  messageID: string,
  session: Session,
  signal?: AbortSignal,
): Promise<void> {
  await requestAPI<null>(
    `/chats/${encodeURIComponent(chatID)}/messages/${encodeURIComponent(messageID)}`,
    session,
    { method: "DELETE", signal },
  );
}

export function parseChatLocationPayload(value: string | null, expiresAt?: string): ChatLocationPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ChatLocationPayload>;
    if (parsed.type !== "location" || !Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)
      || Math.abs(parsed.latitude as number) > 90 || Math.abs(parsed.longitude as number) > 180
      || typeof parsed.expires_at !== "string" || parsed.expires_at !== expiresAt
      || !Number.isFinite(Date.parse(parsed.expires_at)) || Date.parse(parsed.expires_at) <= Date.now()) return null;
    if (parsed.display_name !== undefined && (typeof parsed.display_name !== "string" || parsed.display_name.trim().length > 80)) return null;
    if (parsed.accuracy_m !== undefined && (!Number.isFinite(parsed.accuracy_m) || parsed.accuracy_m < 0 || parsed.accuracy_m > 10_000)) return null;
    return parsed as ChatLocationPayload;
  } catch {
    return null;
  }
}

export async function sendChatMessage(
  chatID: string,
  plaintext: string,
  session: Session,
  clientMessageID = createClientMessageID(),
  signal?: AbortSignal,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
  contentKey?: Uint8Array,
): Promise<EncryptedChatMessage> {
  const resolvedContentKey = contentKey ?? await loadChatContentKey(chatID, session, signal, random);
  try {
    const encrypted = await encryptChatPlaintext(
      chatID,
      plaintext,
      resolvedContentKey,
      random,
      true,
      "text",
      session.account_type === "demo",
    );
    const response = await requestAPI<DataResponse<EncryptedChatMessage>>(
      `/chats/${encodeURIComponent(chatID)}/messages`,
      session,
      {
        method: "POST",
        body: JSON.stringify({
          client_message_id: clientMessageID,
          ...encrypted,
        }),
        signal,
      },
    );
    if (!response.data) throw new Error("chat message response is empty");
    return response.data;
  } finally {
    if (!contentKey) resolvedContentKey.fill(0);
  }
}

export async function sendChatLocation(
  chatID: string,
  location: Omit<ChatLocationPayload, "type" | "expires_at">,
  session: Session,
  expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  clientMessageID = createClientMessageID(),
  signal?: AbortSignal,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
  contentKey?: Uint8Array,
): Promise<EncryptedChatMessage> {
  const payload: ChatLocationPayload = { type: "location", ...location, expires_at: expiresAt };
  if (!parseChatLocationPayload(JSON.stringify(payload), expiresAt)) throw new Error("invalid_chat_location");
  const resolvedContentKey = contentKey ?? await loadChatContentKey(chatID, session, signal, random);
  try {
    const encrypted = await encryptChatPlaintext(
      chatID,
      JSON.stringify(payload),
      resolvedContentKey,
      random,
      false,
      "location",
      session.account_type === "demo",
    );
    const response = await requestAPI<DataResponse<EncryptedChatMessage>>(
      `/chats/${encodeURIComponent(chatID)}/messages`, session,
      { method: "POST", body: JSON.stringify({ client_message_id: clientMessageID, ...encrypted, content_type: "location", expires_at: expiresAt }), signal },
    );
    if (!response.data) throw new Error("chat location response is empty");
    return response.data;
  } finally {
    if (!contentKey) resolvedContentKey.fill(0);
  }
}

export async function moderateChatMessage(
  chatID: string,
  plaintext: string,
  session: Session,
  signal?: AbortSignal,
): Promise<ChatModerationDecision> {
  const response = await requestAPI<DataResponse<{ decision?: unknown; code?: unknown }>>(
    `/chats/${encodeURIComponent(chatID)}/moderation`,
    session,
    { method: "POST", body: JSON.stringify({ text: plaintext }), signal },
  );
  const decision = response.data?.decision;
  if (decision === "allowed" || decision === "blocked" || decision === "unavailable") return decision;
  throw new Error("invalid_chat_moderation_response");
}

export type ModeratedChatMessageSend = {
  decision: ChatModerationDecision;
  message?: EncryptedChatMessage;
};

/**
 * Marks a failure after the moderation decision was already allowed. Keep the
 * underlying error out of the UI so API responses and cryptographic details
 * are not exposed, while preserving the phase for safe, accurate messaging.
 */
export class ModeratedChatMessageSendError extends Error {
  readonly phase = "send" as const;
  readonly code?: string;
  readonly requiresSessionRefresh: boolean;

  constructor(error: unknown) {
    super("chat_message_send_failed");
    this.name = "ModeratedChatMessageSendError";
    this.code = error instanceof APIError ? error.code : undefined;
    this.requiresSessionRefresh = error instanceof APIError && error.status === 401;
  }
}

// Keep the moderation gate beside encryption so a future caller cannot encrypt
// or call /messages after a blocked or unavailable moderation result.
export async function moderateAndSendChatMessage(
  chatID: string,
  plaintext: string,
  session: Session,
  clientMessageID = createClientMessageID(),
  signal?: AbortSignal,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
): Promise<ModeratedChatMessageSend> {
  const decision = await moderateChatMessage(chatID, plaintext, session, signal);
  if (decision !== "allowed") return { decision };
  try {
    return {
      decision,
      message: await sendChatMessage(chatID, plaintext, session, clientMessageID, signal, random),
    };
  } catch (error) {
    throw new ModeratedChatMessageSendError(error);
  }
}

export function toChatMessageView(
  chatID: string,
  message: EncryptedChatMessage,
  currentUserID: string,
  contentKey?: Uint8Array,
  legacyKeyB?: Uint8Array,
): ChatMessageView {
  // Image messages carry an encrypted marker only. Never render that marker
  // as chat text; the attachment is downloaded and decrypted separately after
  // its recipient envelope is opened on this device.
  const plaintext = message.content_type === "image" ? null : decryptChatMessage(chatID, message, contentKey, legacyKeyB);
  const location = message.content_type === "location" ? parseChatLocationPayload(plaintext, message.expires_at) : null;
  return {
    ...message,
    plaintext,
    location,
    locationExpired: message.content_type === "location" && location === null,
    mine: message.sender_user_id === currentUserID,
  };
}

export function createClientMessageID(now = Date.now()): string {
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `msg-${now.toString(36)}-${randomPart}`;
}

export function validateChatDraft(value: string): "empty" | "too_long" | null {
  const normalized = value.trim();
  if (!normalized) return "empty";
  if (normalized.length > MAX_PLAINTEXT_LENGTH) return "too_long";
  return null;
}

function addCategory(
  categories: ChatModerationCategory[],
  category: ChatModerationCategory,
) {
  if (!categories.includes(category)) categories.push(category);
}

export function moderateChatText(value: string): ChatModerationResult {
  const normalized = value.toLocaleLowerCase();
  const categories: ChatModerationCategory[] = [];

  if (/(死ね|ばか|バカ|差別|hate|idiot|stupid|racist)/iu.test(value)) addCategory(categories, "abuse");
  if (/(sex|sexual|ホテル|hotel|裸|キス|デートしよう)/iu.test(value)) addCategory(categories, "sexual");
  if (/(送金|投資|チップ|振込|paypal|crypto|bitcoin|money|tip)/iu.test(value)) addCategory(categories, "money");
  if (/(line|instagram|insta|whatsapp|telegram|電話|tel|phone|@\w+)/iu.test(normalized)) addCategory(categories, "external_contact");
  if (/(自宅|家に来て|個室|人気のない|暗い場所|private room|my place|home alone)/iu.test(value)) addCategory(categories, "dangerous_place");
  if (/(住所|パスポート|身分証|カード番号|クレジットカード|address|passport|credit card)/iu.test(normalized)) addCategory(categories, "personal_info");
  if (/(断るな|来ないと困る|絶対来て|must come|don't cancel|do not cancel)/iu.test(normalized)) addCategory(categories, "coercion");
  if (/(?:\+?\d[\d\s-]{8,}\d)/u.test(value)) addCategory(categories, "external_contact");

  if (categories.includes("external_contact") || categories.includes("personal_info")) {
    return { categories, severity: "block" };
  }
  if (categories.length > 0) return { categories, severity: "warn" };
  return { categories, severity: "none" };
}

export function translateChatText(value: string, targetLanguage: ChatLanguage): string {
  const normalized = value.trim().toLocaleLowerCase();
  const dictionary: Record<string, { en: string; ja: string }> = {
    "hi! should we meet at inari station?": {
      en: "Hi! Should we meet at Inari Station?",
      ja: "こんにちは。稲荷駅で待ち合わせしますか？",
    },
    "sounds good! i'm excited.": {
      en: "Sounds good! I'm excited.",
      ja: "いいですね。楽しみにしています。",
    },
    "集合場所はどこですか？": {
      en: "Where should we meet?",
      ja: "集合場所はどこですか？",
    },
    "改札前で待ち合わせしましょう。": {
      en: "Let's meet in front of the ticket gates.",
      ja: "改札前で待ち合わせしましょう。",
    },
  };
  const translated = dictionary[normalized]?.[targetLanguage];
  if (translated) return translated;
  return targetLanguage === "ja"
    ? "翻訳は準備中です。安全のため、個人情報や外部連絡先は送らないでください。"
    : "Translation is being prepared. For safety, do not share personal information or external contacts.";
}
