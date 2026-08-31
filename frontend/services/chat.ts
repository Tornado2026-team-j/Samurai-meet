import { gcm } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { API_BASE_URL } from "./api-config";
import { requestAPI } from "./api-client";
import type { Session } from "./auth-contract";
import { fromBase64URL, randomBytes, toBase64URL } from "./crypto";

const CHAT_ALGORITHM = "AES-256-GCM";
const CHAT_KEY_VERSION = "chat-mvp-v1";
const CHAT_AAD_PREFIX = "samurai-meet:chat-message:mvp-v1";
const MAX_PLAINTEXT_LENGTH = 2000;

type DataResponse<T> = { data?: T };

export type ChatStatus = "accepted" | "completed";

export type ChatListFilter = "all" | "active" | "completed";

export type ChatSummary = {
  id: string;
  match_id: string;
  status: ChatStatus;
  other_user_id: string;
  other_user_name: string;
  last_message_at?: string;
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
  content_type?: "text" | "location";
  expires_at?: string;
  created_at: string;
};

export type ChatMessagePage = {
  items: EncryptedChatMessage[];
  next_after?: number;
  has_more: boolean;
};

export type ChatMessageView = EncryptedChatMessage & {
  plaintext: string | null;
  location: ChatLocationPayload | null;
  locationExpired: boolean;
  mine: boolean;
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

function chatQuery(after?: number, limit?: number): string {
  const query = new URLSearchParams();
  if (after !== undefined) query.set("after", String(after));
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

function chatKey(chatID: string): Uint8Array {
  return sha256(utf8ToBytes(`${CHAT_AAD_PREFIX}\n${chatID}`));
}

function chatAAD(chatID: string): Uint8Array {
  return utf8ToBytes(`${CHAT_AAD_PREFIX}\n${chatID}\n${CHAT_KEY_VERSION}`);
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

export async function listChatMessages(
  chatID: string,
  session: Session,
  options: { after?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<ChatMessagePage> {
  const response = await requestAPI<DataResponse<ChatMessagePage>>(
    `/chats/${encodeURIComponent(chatID)}/messages${chatQuery(options.after, options.limit)}`,
    session,
    { method: "GET", signal },
  );
  if (!response.data || !Array.isArray(response.data.items)) {
    throw new Error("chat messages response is invalid");
  }
  return response.data;
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
  random: (length: number) => Promise<Uint8Array> = randomBytes,
): Promise<{
  ciphertext: string;
  nonce: string;
  algorithm: typeof CHAT_ALGORITHM;
  key_version: typeof CHAT_KEY_VERSION;
}> {
  const nonce = await random(12);
  const ciphertext = gcm(chatKey(chatID), nonce, chatAAD(chatID)).encrypt(utf8ToBytes(plaintext));
  return {
    ciphertext: toBase64URL(ciphertext),
    nonce: toBase64URL(nonce),
    algorithm: CHAT_ALGORITHM,
    key_version: CHAT_KEY_VERSION,
  };
}

export function decryptChatMessage(chatID: string, message: EncryptedChatMessage): string | null {
  if (message.algorithm !== CHAT_ALGORITHM || message.key_version !== CHAT_KEY_VERSION) return null;
  try {
    const plaintext = gcm(
      chatKey(chatID),
      fromBase64URL(message.nonce),
      chatAAD(chatID),
    ).decrypt(fromBase64URL(message.ciphertext));
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
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
): Promise<EncryptedChatMessage> {
  const encrypted = await encryptChatPlaintext(chatID, plaintext, random);
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
}

export async function sendChatLocation(
  chatID: string,
  location: Omit<ChatLocationPayload, "type" | "expires_at">,
  session: Session,
  expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  clientMessageID = createClientMessageID(),
  signal?: AbortSignal,
  random: (length: number) => Promise<Uint8Array> = randomBytes,
): Promise<EncryptedChatMessage> {
  const payload: ChatLocationPayload = { type: "location", ...location, expires_at: expiresAt };
  if (!parseChatLocationPayload(JSON.stringify(payload), expiresAt)) throw new Error("invalid_chat_location");
  const encrypted = await encryptChatPlaintext(chatID, JSON.stringify(payload), random);
  const response = await requestAPI<DataResponse<EncryptedChatMessage>>(
    `/chats/${encodeURIComponent(chatID)}/messages`, session,
    { method: "POST", body: JSON.stringify({ client_message_id: clientMessageID, ...encrypted, content_type: "location", expires_at: expiresAt }), signal },
  );
  if (!response.data) throw new Error("chat location response is empty");
  return response.data;
}

export function toChatMessageView(
  chatID: string,
  message: EncryptedChatMessage,
  currentUserID: string,
): ChatMessageView {
  const plaintext = decryptChatMessage(chatID, message);
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

export function translateChatText(value: string, targetLanguage: "en" | "ja"): string {
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
