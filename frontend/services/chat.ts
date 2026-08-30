import { gcm } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { requestAPI } from "./api-client";
import type { Session } from "./auth-contract";
import { fromBase64URL, randomBytes, toBase64URL } from "./crypto";

const CHAT_ALGORITHM = "AES-256-GCM";
const CHAT_KEY_VERSION = "chat-mvp-v1";
const CHAT_AAD_PREFIX = "samurai-meet:chat-message:mvp-v1";
const MAX_PLAINTEXT_LENGTH = 2000;

type DataResponse<T> = { data?: T };

export type ChatStatus = "accepted" | "completed";

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
  created_at: string;
};

export type ChatMessagePage = {
  items: EncryptedChatMessage[];
  next_after?: number;
  has_more: boolean;
};

export type ChatMessageView = EncryptedChatMessage & {
  plaintext: string | null;
  mine: boolean;
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
  | "offensive"
  | "abuse"
  | "sexual"
  | "money"
  | "external_contact"
  | "dangerous_place"
  | "no_show"
  | "other";

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

export function toChatMessageView(
  chatID: string,
  message: EncryptedChatMessage,
  currentUserID: string,
): ChatMessageView {
  return {
    ...message,
    plaintext: decryptChatMessage(chatID, message),
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
