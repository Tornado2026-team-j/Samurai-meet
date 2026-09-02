import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ChatBubble from "../../components/ChatBubble";
import DismissKeyboardView from "../../components/DismissKeyboardView";
import { useAuth } from "../../hooks/useAuth";
import { APIError } from "../../services/api-client";
import {
	blockUser,
	chatMessageRevision,
	chatRealtimeMode,
  connectChatWebTransport,
  createSafetyReport,
  listChatMessages,
  listChats,
  installNativeChatWebTransportBridge,
	loadChatMessageKey,
	markChatRead,
	moderateChatMessage,
	moderateAndSendChatMessage,
	downloadAndDecryptChatAttachment,
	deleteChatMessage,
	decryptChatTranslation,
	sendChatImage,
  sendChatLocation,
  toChatMessageView,
	translateChatMessage,
	updateChatMessage,
  validateChatDraft,
  type ChatMessageView,
  type ChatReportReason,
  type ChatSummary,
} from "../../services/chat";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  ensureChatAttachmentEncryptionAvailable,
  isChatAttachmentCryptoUnavailable,
  isChatAttachmentContentType,
  toBase64,
  type ChatAttachmentContentType,
} from "../../services/crypto";
import { resolveCurrentLocationDisplay } from "../../services/location";
import { declineMatch, getMatch, type MatchView } from "../../services/matching";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../../services/onboarding";
import { formatTimeRange } from "../../utils/time";
import type { MatchCategory } from "../../types/match";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";
const DANGER = "#b42318";

type ReportTarget = { kind: "account" } | { kind: "message"; messageID: string };
type ConfirmAction = "decline" | "block" | "account_report" | "message_report";
type SafetyModal =
  | { kind: "menu" }
  | { kind: "confirm"; action: ConfirmAction; target: ReportTarget | null }
  | { kind: "report"; target: ReportTarget };
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

const CATEGORY_ICONS: Record<MatchCategory, MaterialIconName> = {
  Food: "restaurant",
  Places: "place",
  Activity: "directions-run",
  Other: "category",
};

const COPY = {
  ja: {
    back: "戻る",
    loading: "チャットを読み込み中…",
    retry: "再試行",
    signInRequired: "ログイン後にチャットを表示できます。",
    loadError: "チャットを読み込めませんでした。時間をおいて再試行してください。",
    input: "メッセージを入力",
    send: "送信",
    sending: "送信中…",
    encryptedMessage: "暗号化メッセージ",
    translate: "翻訳",
    original: "Original",
    translationLoading: "翻訳中…",
    translationNotice: "自動翻訳は初回だけ本文を翻訳サービスへ送信します。結果はKey-Bで暗号化して保存され、次回から再利用されます。Originalをタップすると原文に戻せます。",
    translationUnavailable: "自動翻訳を利用できないため、原文を表示しています。",
    edit: "編集",
    delete: "削除",
    editing: "メッセージを編集中",
    saveEdit: "保存",
    messageEdited: "メッセージを編集しました。",
    editFailed: "メッセージを編集できませんでした。時間をおいて再試行してください。",
    deleteTitle: "メッセージを削除しますか？",
    deleteDescription: "このメッセージは相手の履歴からも削除され、元に戻せません。",
    deleteFailed: "メッセージを削除できませんでした。時間をおいて再試行してください。",
    edited: "編集済み",
    report: "通報",
    decline: "辞退",
    block: "ブロック",
    messageReport: "メッセージを通報",
    accountReport: "相手を通報",
    menuTitle: "安全メニュー",
    blockTitle: "ブロックしますか？",
    declineTitle: "案内を辞退しますか？",
    accountReportTitle: "このユーザーを報告しますか？",
    messageReportTitle: "このメッセージを通報しますか？",
    declineDescription: "相手に通知されます。この案内はキャンセルされます。",
    accountReportDescription: "運営が内容を確認します。相手には通知されません。",
    blockDescription: "相手はあなたにメッセージを送れなくなります。",
    messageReportDescription: "選択したメッセージと前後の会話が運営確認対象になります。",
    cancel: "キャンセル",
    confirm: "確定",
    close: "閉じる",
    reasonTitle: "理由を選択",
    reportSubmitted: "通報を送信しました。運営が内容を確認します。",
    reportFailed: "通報を送信できませんでした。時間をおいて再試行してください。",
    blockedLocal: "このユーザーをブロックしました。新しいメッセージは送信できません。",
    blockFailed: "ブロックできませんでした。時間をおいて再試行してください。",
    declinedLocal: "案内を辞退済みとして扱っています。チャットは閲覧専用です。",
    declineFailed: "この案内はチャット開始後のため、現在のAPIでは辞退を完了できません。acceptedマッチ用のキャンセルAPIが必要です。",
    readOnly: "この案内は完了済みのため、チャットは閲覧専用です。",
    empty: "集合場所や時間を確認しましょう。",
    draftEmpty: "メッセージを入力してください。",
    draftTooLong: "メッセージは2000文字以内で入力してください。",
    sendFailed: "メッセージを送信できませんでした。時間をおいて再試行してください。",
    photo: "画像",
    sendPhoto: "画像を送信",
    photoSelecting: "画像を選択中…",
    photoSending: "画像を送信中…",
    photoSent: "画像を送信しました。",
    photoPermissionDenied: "写真へのアクセスを許可すると画像を送信できます。",
    photoUnsupported: "JPEG、PNG、WebPの画像のみ送信できます。",
    photoTooLarge: "画像は20MB以内で選択してください。",
    photoEncryptionUnavailable: "この環境では安全な乱数生成を利用できないため、画像送信は利用できません。",
    photoSendFailed: "画像を送信できませんでした。鍵の準備と通信状態を確認して再試行してください。",
    photoLoadFailed: "画像を表示できませんでした。",
    photoRetry: "画像を再読み込み",
    shareLocation: "現在地を共有",
    locationConfirmTitle: "現在地を共有しますか？",
    locationConfirm: "相手は有効期限まで地図でこの場所を開けます。自宅などの正確な位置は共有しないでください。",
    locationUnavailable: "現在地を取得できませんでした。位置情報の許可を確認してください。",
    locationShared: "位置情報を共有しました",
    locationExpired: "位置情報の共有期限が切れました",
    openAppleMaps: "Appleマップで開く",
    openGoogleMaps: "Googleマップで開く",
    locationExpires: "共有期限",
    moderationBlocked: "安全上送信できません。表現を見直してください。",
    moderationUnavailable: "安全確認サービスを利用できないため送信できません。時間をおいて再試行してください。",
    safetyNotice: "個人情報、外部連絡先、人気のない場所への誘導は送らないでください。",
    restSyncOnly: "リアルタイム接続にはDevelopment Buildが必要です。Expo Goでは画面を下に引いて手動更新してください。",
    remoteTyping: "相手が入力中です…",
    remoteRead: "既読",
    scheduleTitle: "案内内容",
    date: "日付",
    time: "時刻",
    quickWhere: "集合場所はどこですか？",
    quickGate: "改札前で待ち合わせしましょう。",
    quickThanks: "ありがとうございます。よろしくお願いします。",
    reasons: {
      nuisance: "迷惑行為",
      harassment: "差別・暴言・ハラスメント",
      impersonation: "なりすまし",
      inappropriate_photo: "不適切な写真",
      dangerous: "危険・不安を感じる行動",
      other: "その他",
    },
    categories: {
      abuse: "暴言・差別",
      sexual: "性的な内容",
      money: "金銭要求",
      external_contact: "外部連絡先",
      dangerous_place: "危険な集合場所",
      personal_info: "個人情報",
      coercion: "脅迫・強要",
    },
  },
  en: {
    back: "Back",
    loading: "Loading chat…",
    retry: "Retry",
    signInRequired: "Sign in to view this chat.",
    loadError: "Chat could not be loaded. Please try again later.",
    input: "Enter message",
    send: "Send",
    sending: "Sending…",
    encryptedMessage: "Encrypted message",
    translate: "Translate",
    original: "Original",
    translationLoading: "Translating…",
    translationNotice: "Automatic translation sends the message to the translation service only on the first translation. The result is saved encrypted with Key-B and reused next time. Tap Original to return to the source.",
    translationUnavailable: "Automatic translation is unavailable, so the original is shown.",
    edit: "Edit",
    delete: "Delete",
    editing: "Editing message",
    saveEdit: "Save",
    messageEdited: "Message updated.",
    editFailed: "Message could not be updated. Please try again later.",
    deleteTitle: "Delete this message?",
    deleteDescription: "This message will be removed from the other person's history and cannot be restored.",
    deleteFailed: "Message could not be deleted. Please try again later.",
    edited: "edited",
    report: "Report",
    decline: "Decline",
    block: "Block",
    messageReport: "Report message",
    accountReport: "Report account",
    menuTitle: "Safety menu",
    blockTitle: "Block this person?",
    declineTitle: "Decline this guide?",
    accountReportTitle: "Report this user?",
    messageReportTitle: "Report this message?",
    declineDescription: "The other person will be notified. This guide will be canceled.",
    accountReportDescription: "Operations will review the report. The other person will not be notified.",
    blockDescription: "This person will no longer be able to message you.",
    messageReportDescription: "The selected message and nearby conversation will be sent for operations review.",
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    reasonTitle: "Select a reason",
    reportSubmitted: "Report sent. Operations will review it.",
    reportFailed: "Report could not be sent. Please try again later.",
    blockedLocal: "This user is blocked. You cannot send new messages.",
    blockFailed: "This user could not be blocked. Please try again later.",
    declinedLocal: "This guide is marked declined. The chat is read-only.",
    declineFailed: "This guide is already in chat. The current API cannot complete a decline; an accepted-match cancel API is needed.",
    readOnly: "This guide is completed, so the chat is read-only.",
    empty: "Confirm the meeting place and time.",
    draftEmpty: "Enter a message.",
    draftTooLong: "Messages must be 2000 characters or fewer.",
    sendFailed: "Message could not be sent. Please try again later.",
    photo: "Photo",
    sendPhoto: "Send photo",
    photoSelecting: "Selecting photo…",
    photoSending: "Sending photo…",
    photoSent: "Photo sent.",
    photoPermissionDenied: "Allow photo access to send an image.",
    photoUnsupported: "Only JPEG, PNG, and WebP images can be sent.",
    photoTooLarge: "Choose an image no larger than 20 MB.",
    photoEncryptionUnavailable: "Image attachments are unavailable because secure random generation is not available in this environment.",
    photoSendFailed: "The photo could not be sent. Check key setup and your connection, then try again.",
    photoLoadFailed: "The image could not be displayed.",
    photoRetry: "Reload image",
    shareLocation: "Share current location",
    locationConfirmTitle: "Share your current location?",
    locationConfirm: "The recipient can open this location in a map until it expires. Do not share your home or another sensitive location.",
    locationUnavailable: "Current location could not be obtained. Check location permission.",
    locationShared: "Location shared",
    locationExpired: "Location sharing has expired",
    openAppleMaps: "Open in Apple Maps",
    openGoogleMaps: "Open in Google Maps",
    locationExpires: "Expires",
    moderationBlocked: "This message cannot be sent for safety reasons. Please revise the wording.",
    moderationUnavailable: "Safety checking is unavailable, so this message cannot be sent. Please try again later.",
    safetyNotice: "Do not share personal information, external contacts, or unsafe meeting places.",
    restSyncOnly: "A Development Build is required for real-time chat. In Expo Go, pull down to refresh manually.",
    remoteTyping: "The other person is typing…",
    remoteRead: "Read",
    scheduleTitle: "Guide details",
    date: "Date",
    time: "Time",
    quickWhere: "Where should we meet?",
    quickGate: "Let's meet in front of the ticket gates.",
    quickThanks: "Thank you. I look forward to it.",
    reasons: {
      nuisance: "Nuisance behavior",
      harassment: "Harassment or abuse",
      impersonation: "Impersonation",
      inappropriate_photo: "Inappropriate photo",
      dangerous: "Dangerous or unsafe behavior",
      other: "Other",
    },
    categories: {
      abuse: "Abuse/discrimination",
      sexual: "Sexual content",
      money: "Money request",
      external_contact: "External contact",
      dangerous_place: "Unsafe place",
      personal_info: "Personal information",
      coercion: "Coercion",
    },
  },
} as const;

const REPORT_REASONS: ChatReportReason[] = [
  "nuisance",
  "harassment",
  "impersonation",
  "inappropriate_photo",
  "dangerous",
  "other",
];

function pickedImageContentType(asset: ImagePicker.ImagePickerAsset): ChatAttachmentContentType | null {
  const declared = asset.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (declared && isChatAttachmentContentType(declared)) return declared;
  const source = (asset.fileName ?? asset.uri).toLowerCase().split("?", 1)[0] ?? "";
  if (source.endsWith(".jpg") || source.endsWith(".jpeg")) return "image/jpeg";
  if (source.endsWith(".png")) return "image/png";
  if (source.endsWith(".webp")) return "image/webp";
  return null;
}

async function readPickedImage(asset: ImagePicker.ImagePickerAsset): Promise<Uint8Array> {
  if (Platform.OS === "web" && asset.file) {
    return new Uint8Array(await asset.file.arrayBuffer());
  }
  try {
    return new Uint8Array(await new File(asset.uri).arrayBuffer());
  } catch {
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error("chat_attachment_read_failed");
    return new Uint8Array(await response.arrayBuffer());
  }
}

function latestSequence(messages: ChatMessageView[]): number {
  return messages.reduce((max, message) => Math.max(max, message.sequence), 0);
}

function deduplicateChatMessages(messages: ChatMessageView[]): ChatMessageView[] {
  const unique: ChatMessageView[] = [];
  const identityIndexes = new Map<string, number>();

  for (const message of messages) {
    const identities = [
      message.id ? `id:${message.id}` : null,
      message.client_message_id ? `client:${message.client_message_id}` : null,
    ].filter((identity): identity is string => identity !== null);
    const existingIndex = identities
      .map((identity) => identityIndexes.get(identity))
      .find((index): index is number => index !== undefined);

    if (existingIndex === undefined) {
      const nextIndex = unique.push(message) - 1;
      for (const identity of identities) identityIndexes.set(identity, nextIndex);
    } else {
      unique[existingIndex] = message;
      for (const identity of identities) identityIndexes.set(identity, existingIndex);
    }
  }

  return unique.sort((left, right) => left.sequence - right.sequence);
}

function chatMessageKey(message: ChatMessageView): string {
  return message.id || message.client_message_id || `sequence:${message.sequence}`;
}

function cachedChatTranslation(
  chatID: string,
  message: ChatMessageView,
  language: "ja" | "en",
  keyB: Uint8Array | null,
) {
  const cached = message.translations?.find((item) => item.target_language === language);
  if (!cached || !keyB) return null;
  return decryptChatTranslation(chatID, message.id, chatMessageRevision(message), cached, keyB);
}

function mergeChatMessage(
  current: ChatMessageView[],
  incoming: ChatMessageView,
): ChatMessageView[] {
  return deduplicateChatMessages([...current, incoming]);
}

export default function ChatDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const chatID = Array.isArray(id) ? id[0] : id;
  const { getCurrentSession, refresh, session, status } = useAuth();
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [realtimeMode] = useState(() => {
    installNativeChatWebTransportBridge();
    return chatRealtimeMode();
  });
  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [match, setMatch] = useState<MatchView | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [editingMessageID, setEditingMessageID] = useState<string | null>(null);
  const [deletingMessageID, setDeletingMessageID] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachmentSources, setAttachmentSources] = useState<Record<string, string>>({});
  const [attachmentLoading, setAttachmentLoading] = useState<Record<string, boolean>>({});
  const [attachmentErrors, setAttachmentErrors] = useState<Record<string, boolean>>({});
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, string>>({});
  const [translationLoading, setTranslationLoading] = useState<Record<string, boolean>>({});
  const [originalMessages, setOriginalMessages] = useState<Record<string, boolean>>({});
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [remoteReadSequence, setRemoteReadSequence] = useState(0);
  const [safetyModal, setSafetyModal] = useState<SafetyModal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locallyClosed, setLocallyClosed] = useState<"declined" | "blocked" | null>(null);
  const [safetySubmitting, setSafetySubmitting] = useState(false);
  const safetySubmittingRef = useRef(false);
  const mountedRef = useRef(true);
  const chatMessageKeyRef = useRef<Uint8Array | null>(null);
  const chatMessageKeyPromiseRef = useRef<Promise<Uint8Array> | null>(null);
  const attachmentSourcesRef = useRef<Record<string, string>>({});
  const loadingAttachmentIDsRef = useRef(new Set<string>());
  const attachmentControllersRef = useRef(new Map<string, AbortController>());
  const translationAttemptsRef = useRef(new Set<string>());
  const editingMessageIDRef = useRef<string | null>(null);
  editingMessageIDRef.current = editingMessageID;
  const copy = COPY[language ?? "ja"];
  const displayMessages = useMemo(() => deduplicateChatMessages(messages), [messages]);
  const validation = validateChatDraft(draft);
  const readOnly = chat?.status === "completed" || locallyClosed !== null;
  const canSend = safetyModal === null && !readOnly && !sending && !deletingMessageID && !sharingLocation && !sendingPhoto && !validation;

  const ensureChatMessageKey = useCallback(async (activeSession: NonNullable<typeof session>): Promise<Uint8Array> => {
    if (chatMessageKeyRef.current) return chatMessageKeyRef.current;
    if (!chatMessageKeyPromiseRef.current) {
      chatMessageKeyPromiseRef.current = loadChatMessageKey(activeSession).then((key) => {
        if (!mountedRef.current) {
          key.fill(0);
          throw new Error("chat_screen_unmounted");
        }
        chatMessageKeyRef.current = key;
        return key;
      }).finally(() => {
        chatMessageKeyPromiseRef.current = null;
      });
    }
    return chatMessageKeyPromiseRef.current;
  }, []);

  const runWithSession = useCallback(async <T,>(
    action: (activeSession: NonNullable<typeof session>, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> => {
    const activeSession = getCurrentSession() ?? session;
    if (status !== "signed_in" || !activeSession) throw new Error("not_signed_in");
    try {
      return await action(activeSession, signal);
    } catch (error) {
      if (!(error instanceof APIError) || error.status !== 401) throw error;
      await refresh();
      const refreshedSession = getCurrentSession();
      if (!refreshedSession) throw error;
      return action(refreshedSession, signal);
    }
  }, [getCurrentSession, refresh, session, status]);

  const hydrateAttachment = useCallback(async (message: ChatMessageView, force = false) => {
    const attachment = message.attachment;
    if (!chatID || !attachment || (!force && attachmentSourcesRef.current[attachment.id])) return;
    if (loadingAttachmentIDsRef.current.has(attachment.id)) return;

    const controller = new AbortController();
    loadingAttachmentIDsRef.current.add(attachment.id);
    attachmentControllersRef.current.set(attachment.id, controller);
    setAttachmentLoading((current) => ({ ...current, [attachment.id]: true }));
    setAttachmentErrors((current) => {
      if (!current[attachment.id]) return current;
      const next = { ...current };
      delete next[attachment.id];
      return next;
    });

    try {
      const decrypted = await runWithSession(
        (activeSession, signal) => downloadAndDecryptChatAttachment(chatID, attachment, activeSession, signal),
        controller.signal,
      );
      try {
        const source = `data:${attachment.content_type};base64,${toBase64(decrypted)}`;
        if (mountedRef.current) {
          setAttachmentSources((current) => {
            const next = { ...current, [attachment.id]: source };
            attachmentSourcesRef.current = next;
            return next;
          });
        }
      } finally {
        decrypted.fill(0);
      }
    } catch {
      if (mountedRef.current && !controller.signal.aborted) {
        setAttachmentErrors((current) => ({ ...current, [attachment.id]: true }));
      }
    } finally {
      loadingAttachmentIDsRef.current.delete(attachment.id);
      attachmentControllersRef.current.delete(attachment.id);
      if (mountedRef.current) {
        setAttachmentLoading((current) => {
          if (!current[attachment.id]) return current;
          const next = { ...current };
          delete next[attachment.id];
          return next;
        });
      }
    }
  }, [chatID, runWithSession]);

  useEffect(() => {
    mountedRef.current = true;
    const attachmentControllers = attachmentControllersRef.current;
    const loadingAttachmentIDs = loadingAttachmentIDsRef.current;
    return () => {
      mountedRef.current = false;
      for (const controller of attachmentControllers.values()) controller.abort();
      attachmentControllers.clear();
      loadingAttachmentIDs.clear();
      attachmentSourcesRef.current = {};
      chatMessageKeyRef.current?.fill(0);
      chatMessageKeyRef.current = null;
    };
  }, []);

  const load = useCallback((mode: "initial" | "refresh" = "refresh") => {
    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      if (!chatID) {
        setLoadError(copy.loadError);
        setLoading(false);
        return;
      }
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setLoadError(null);
      try {
        const result = await runWithSession(async (activeSession, signal) => {
          const [summaries, page] = await Promise.all([
            listChats(activeSession, signal),
            listChatMessages(chatID, activeSession, { limit: 100 }, signal),
          ]);
          const messageKey = await ensureChatMessageKey(activeSession);
          const currentChat = summaries.find((item) => item.id === chatID) ?? null;
          const currentMatch = currentChat
            ? await getMatch(currentChat.match_id, activeSession, signal).catch(() => null)
            : null;
          return { currentChat, currentMatch, page, userID: activeSession.user_id, messageKey };
        }, controller.signal);
        if (!cancelled) {
          const messageViews = deduplicateChatMessages(
            result.page.items.map((message) => toChatMessageView(chatID, message, result.userID, result.messageKey)),
          );
          setChat(result.currentChat);
          setMatch(result.currentMatch);
          setMessages(messageViews);
          const sequence = latestSequence(messageViews);
          if (sequence > 0) {
            void runWithSession((activeSession, signal) => markChatRead(chatID, sequence, activeSession, signal), controller.signal).catch(() => undefined);
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!cancelled) {
          setLoadError(error instanceof Error && error.message === "not_signed_in" ? copy.signInRequired : copy.loadError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [chatID, copy.loadError, copy.signInRequired, ensureChatMessageKey, runWithSession]);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage ?? "ja");
    });
    void loadLanguage().then((storedLanguage) => {
      if (active) setLanguage(storedLanguage ?? "ja");
    }).catch(() => {
      if (active) setLanguage("ja");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!chatID || !language) return undefined;
    const controller = new AbortController();

    const applyTranslation = (message: ChatMessageView, plaintext: string, result: { source_language: string; translated_text: string; target_language: "ja" | "en" }) => {
      const translated = result.translated_text.trim();
      const sourceLanguage = result.source_language.trim().toLowerCase().split("-", 1)[0];
      if (sourceLanguage === language || !translated || translated === plaintext) {
        setTranslatedMessages((current) => {
          if (!current[message.id]) return current;
          const next = { ...current };
          delete next[message.id];
          return next;
        });
        setOriginalMessages((current) => {
          if (!current[message.id]) return current;
          const next = { ...current };
          delete next[message.id];
          return next;
        });
      } else {
        setTranslatedMessages((current) => ({ ...current, [message.id]: translated }));
        setOriginalMessages((current) => {
          if (!current[message.id]) return current;
          const next = { ...current };
          delete next[message.id];
          return next;
        });
      }
    };

    for (const message of displayMessages) {
      const plaintext = message.plaintext?.trim();
      const isTextMessage = (message.content_type ?? "text") === "text";
      if (!plaintext || !isTextMessage) continue;

      const revision = chatMessageRevision(message);
      const attemptKey = `${message.id}:${language}:${revision}`;
      const cached = cachedChatTranslation(chatID, message, language, chatMessageKeyRef.current);
      if (cached) {
        translationAttemptsRef.current.add(attemptKey);
        applyTranslation(message, plaintext, cached);
        continue;
      }
      if (translationAttemptsRef.current.has(attemptKey)) continue;
      translationAttemptsRef.current.add(attemptKey);
      setTranslationLoading((current) => current[message.id] ? current : { ...current, [message.id]: true });
      void runWithSession(
        async (activeSession, signal) => {
          const messageKey = await ensureChatMessageKey(activeSession);
          return translateChatMessage(chatID, message.id, revision, plaintext, language, activeSession, signal, messageKey);
        },
        controller.signal,
      ).then((result) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        applyTranslation(message, plaintext, result);
      }).catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        // Keep the original visible when the optional translation service is
        // unavailable. A later tap/action can retry without losing content.
      }).finally(() => {
        if (mountedRef.current && !controller.signal.aborted) {
          setTranslationLoading((current) => {
            if (!current[message.id]) return current;
            const next = { ...current };
            delete next[message.id];
            return next;
          });
        }
      });
    }

    return () => controller.abort();
  }, [chatID, displayMessages, ensureChatMessageKey, language, runWithSession]);

  useEffect(() => load("initial"), [load]);

  useEffect(() => {
    if (!chatID || chat?.status !== "accepted" || locallyClosed || realtimeMode !== "webtransport") {
      return undefined;
    }

    const controller = new AbortController();
    let closed = false;
    let connection: { close: () => void | Promise<void> } | null = null;
    let rotateTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      try {
        const transport = await runWithSession(
          (activeSession, signal) => connectChatWebTransport(chatID, activeSession, {
            onFrame: (frame) => {
              if (closed) return;
              const activeSession = getCurrentSession() ?? session;
              if (!activeSession) return;
              if (frame.type === "message.created" || frame.type === "message.ack") {
                const view = toChatMessageView(chatID, frame.message, activeSession.user_id, chatMessageKeyRef.current ?? undefined);
                setMessages((current) => mergeChatMessage(current, view));
                if (!view.mine) {
                  void runWithSession(
                    (currentSession, signal) => markChatRead(chatID, view.sequence, currentSession, signal),
                    new AbortController().signal,
                  ).catch(() => undefined);
                }
              } else if (frame.type === "message.updated") {
                const view = toChatMessageView(chatID, frame.message, activeSession.user_id, chatMessageKeyRef.current ?? undefined);
                setMessages((current) => mergeChatMessage(current, view));
                setTranslatedMessages((current) => {
                  if (!current[view.id]) return current;
                  const next = { ...current };
                  delete next[view.id];
                  return next;
                });
                setOriginalMessages((current) => {
                  if (!current[view.id]) return current;
                  const next = { ...current };
                  delete next[view.id];
                  return next;
                });
              } else if (frame.type === "message.deleted") {
                setMessages((current) => current.filter((message) => message.id !== frame.message_id));
                setTranslatedMessages((current) => {
                  if (!current[frame.message_id]) return current;
                  const next = { ...current };
                  delete next[frame.message_id];
                  return next;
                });
                setOriginalMessages((current) => {
                  if (!current[frame.message_id]) return current;
                  const next = { ...current };
                  delete next[frame.message_id];
                  return next;
                });
                if (editingMessageIDRef.current === frame.message_id) {
                  setEditingMessageID(null);
                  setDraft("");
                }
              } else if (frame.type === "typing" && frame.user_id !== activeSession.user_id) {
                setRemoteTyping(frame.state === "start");
              } else if (frame.type === "message.read" && frame.user_id !== activeSession.user_id) {
                setRemoteReadSequence((current) => Math.max(current, frame.last_message_sequence));
              }
            },
            onClose: () => {
              if (!closed) void load("refresh");
            },
          }, signal),
          controller.signal,
        );
        if (closed || controller.signal.aborted) {
          void transport.connection.close();
          return;
        }
        connection = transport.connection;
        const rotateIn = Math.max(0, Date.parse(transport.expiresAt) - Date.now() - 15_000);
        rotateTimer = setTimeout(() => {
          if (closed) return;
          void connection?.close();
          connection = null;
          void connect();
        }, rotateIn);
      } catch {
        if (!closed) void load("refresh");
      }
    };

    void connect();
    return () => {
      closed = true;
      controller.abort();
      if (rotateTimer) clearTimeout(rotateTimer);
      void connection?.close();
    };
  }, [chat?.status, chatID, getCurrentSession, load, locallyClosed, realtimeMode, runWithSession, session]);

  useEffect(() => {
    if (displayMessages.length === 0) return;
    const handle = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(handle);
  }, [displayMessages.length]);

  useEffect(() => {
    for (const message of displayMessages) {
      if (message.content_type === "image" && message.attachment) {
        void hydrateAttachment(message);
      }
    }
  }, [displayMessages, hydrateAttachment]);

  const submit = async () => {
    if (!chatID || sending || deletingMessageID) return;
    setSendError(null);
    if (validation) {
      setSendError(validation === "empty" ? copy.draftEmpty : copy.draftTooLong);
      return;
    }
    if (readOnly) {
      setSendError(locallyClosed === "blocked" ? copy.blockedLocal : locallyClosed === "declined" ? copy.declinedLocal : copy.readOnly);
      return;
    }

    const messageText = draft.trim();
    const editingID = editingMessageID;
    setSending(true);
    const controller = new AbortController();
    try {
      if (editingID) {
        const original = displayMessages.find((message) => message.id === editingID);
        if (!original?.plaintext || (original.content_type ?? "text") !== "text") {
          setEditingMessageID(null);
          setDraft("");
          setSendError(copy.editFailed);
          return;
        }
        if (original.plaintext.trim() === messageText) {
          setEditingMessageID(null);
          setDraft("");
          return;
        }

        let decision: Awaited<ReturnType<typeof moderateChatMessage>>;
        try {
          decision = await runWithSession(
            (activeSession, signal) => moderateChatMessage(chatID, messageText, activeSession, signal),
            controller.signal,
          );
        } catch {
          // An edit is a new plaintext operation and must pass the same
          // fail-closed moderation gate as a new message.
          setSendError(copy.moderationUnavailable);
          return;
        }
        if (decision !== "allowed") {
          setSendError(decision === "blocked" ? copy.moderationBlocked : copy.moderationUnavailable);
          return;
        }

        let updated;
        try {
          updated = await runWithSession(
            (activeSession, signal) => updateChatMessage(chatID, editingID, messageText, activeSession, signal),
            controller.signal,
          );
        } catch {
          setSendError(copy.editFailed);
          return;
        }
        const activeSession = getCurrentSession() ?? session;
        if (activeSession) {
          setMessages((current) => current.map((message) => message.id === editingID
            ? toChatMessageView(chatID, updated, activeSession.user_id, chatMessageKeyRef.current ?? undefined)
            : message));
        }
        for (const key of translationAttemptsRef.current) {
          if (key.startsWith(`${editingID}:`)) translationAttemptsRef.current.delete(key);
        }
        setTranslatedMessages((current) => {
          if (!current[editingID]) return current;
          const next = { ...current };
          delete next[editingID];
          return next;
        });
        setOriginalMessages((current) => {
          if (!current[editingID]) return current;
          const next = { ...current };
          delete next[editingID];
          return next;
        });
        setEditingMessageID(null);
        setDraft("");
        setNotice(copy.messageEdited);
        return;
      }

      let sent;
      try {
        const result = await runWithSession(
          (activeSession, signal) => moderateAndSendChatMessage(chatID, messageText, activeSession, undefined, signal),
          controller.signal,
        );
        if (result.decision !== "allowed") {
          setSendError(result.decision === "blocked" ? copy.moderationBlocked : copy.moderationUnavailable);
          return;
        }
        sent = result.message;
      } catch {
        // Any moderation transport or API failure is fail-closed. Do not
        // encrypt or call /messages when the plaintext was not evaluated.
        setSendError(copy.moderationUnavailable);
        return;
      }
      if (!sent) throw new Error("chat_message_missing_after_moderation");
      const activeSession = getCurrentSession() ?? session;
      if (activeSession) {
        setMessages((current) => mergeChatMessage(current, toChatMessageView(chatID, sent, activeSession.user_id, chatMessageKeyRef.current ?? undefined)));
      }
      setDraft("");
    } catch {
      setSendError(editingID ? copy.editFailed : copy.sendFailed);
    } finally {
      controller.abort();
      setSending(false);
    }
  };

  const pickAndSendImage = async () => {
    if (!chatID || readOnly || sending || sharingLocation || sendingPhoto || safetyModal !== null) return;
    Keyboard.dismiss();
    setSendError(null);
    setNotice(copy.photoSelecting);
    setSendingPhoto(true);
    const controller = new AbortController();
    let selectedBytes: Uint8Array | null = null;
    try {
      await ensureChatAttachmentEncryptionAvailable();
      let permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!permission.granted) permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setSendError(copy.photoPermissionDenied);
        setNotice(null);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        mediaTypes: ["images"],
        quality: 1,
      });
      const asset = result.canceled ? undefined : result.assets?.[0];
      if (!asset) {
        setNotice(null);
        return;
      }
      const contentType = pickedImageContentType(asset);
      if (!contentType) {
        setSendError(copy.photoUnsupported);
        setNotice(null);
        return;
      }
      if (asset.fileSize !== undefined && asset.fileSize > CHAT_ATTACHMENT_MAX_BYTES - 16) {
        setSendError(copy.photoTooLarge);
        setNotice(null);
        return;
      }

      selectedBytes = await readPickedImage(asset);
      if (selectedBytes.length > CHAT_ATTACHMENT_MAX_BYTES - 16) {
        setSendError(copy.photoTooLarge);
        setNotice(null);
        return;
      }
      const bytesForSend = selectedBytes;
      const resultWithAttachment = await runWithSession(
        (activeSession, signal) => sendChatImage(chatID, bytesForSend, contentType, activeSession, undefined, signal),
        controller.signal,
      );
      const activeSession = getCurrentSession() ?? session;
      if (!activeSession) throw new Error("not_signed_in");
      const source = `data:${contentType};base64,${toBase64(bytesForSend)}`;
      const sentMessage = resultWithAttachment.message.attachment
        ? resultWithAttachment.message
        : {
          ...resultWithAttachment.message,
          content_type: "image" as const,
          attachment_id: resultWithAttachment.attachment.id,
          attachment: resultWithAttachment.attachment,
        };
      if (mountedRef.current) {
        setAttachmentSources((current) => {
          const next = { ...current, [resultWithAttachment.attachment.id]: source };
          attachmentSourcesRef.current = next;
          return next;
        });
        setAttachmentErrors((current) => {
          if (!current[resultWithAttachment.attachment.id]) return current;
          const next = { ...current };
          delete next[resultWithAttachment.attachment.id];
          return next;
        });
        setMessages((current) => mergeChatMessage(current, toChatMessageView(chatID, sentMessage, activeSession.user_id, chatMessageKeyRef.current ?? undefined)));
      }
      setNotice(copy.photoSent);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setSendError(error instanceof Error && error.message === "not_signed_in"
          ? copy.signInRequired
          : isChatAttachmentCryptoUnavailable(error) ? copy.photoEncryptionUnavailable : copy.photoSendFailed);
        setNotice(null);
      }
    } finally {
      selectedBytes?.fill(0);
      controller.abort();
      setSendingPhoto(false);
    }
  };

  const toggleTranslation = (message: ChatMessageView) => {
    const translated = translatedMessages[message.id];
    if (translated) {
      setOriginalMessages((current) => ({ ...current, [message.id]: !current[message.id] }));
      return;
    }
    const plaintext = message.plaintext?.trim();
    if (!chatID || !language || !plaintext || (message.content_type ?? "text") !== "text"
      || translationLoading[message.id]) return;

    const revision = chatMessageRevision(message);
    for (const key of translationAttemptsRef.current) {
      if (key.startsWith(`${message.id}:`)) translationAttemptsRef.current.delete(key);
    }
    translationAttemptsRef.current.add(`${message.id}:${language}:${revision}`);
    setTranslationLoading((current) => ({ ...current, [message.id]: true }));
    const controller = new AbortController();
    void runWithSession(
      async (activeSession, signal) => {
        const messageKey = await ensureChatMessageKey(activeSession);
        return translateChatMessage(chatID, message.id, revision, plaintext, language, activeSession, signal, messageKey);
      },
      controller.signal,
    ).then((result) => {
      if (!controller.signal.aborted && mountedRef.current) {
        const translated = result.translated_text.trim();
        const sourceLanguage = result.source_language.trim().toLowerCase().split("-", 1)[0];
        if (sourceLanguage === language || !translated || translated === plaintext) {
          setTranslatedMessages((current) => {
            if (!current[message.id]) return current;
            const next = { ...current };
            delete next[message.id];
            return next;
          });
        } else {
          setTranslatedMessages((current) => ({ ...current, [message.id]: translated }));
        }
        setOriginalMessages((current) => {
          if (!current[message.id]) return current;
          const next = { ...current };
          delete next[message.id];
          return next;
        });
      }
    }).catch((error) => {
      if (!(error instanceof Error && error.name === "AbortError") && mountedRef.current) {
        setNotice(copy.translationUnavailable);
      }
    }).finally(() => {
      if (mountedRef.current && !controller.signal.aborted) {
        setTranslationLoading((current) => {
          if (!current[message.id]) return current;
          const next = { ...current };
          delete next[message.id];
          return next;
        });
      }
    });
  };

  const startEditing = (message: ChatMessageView) => {
    if (readOnly || sending || !!deletingMessageID || !message.mine || !message.plaintext || (message.content_type ?? "text") !== "text") return;
    setEditingMessageID(message.id);
    setDraft(message.plaintext);
    setSendError(null);
    setNotice(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancelEditing = () => {
    if (sending) return;
    setEditingMessageID(null);
    setDraft("");
    setSendError(null);
  };

  const deleteMessage = async (message: ChatMessageView) => {
    if (!chatID || readOnly || !message.mine || deletingMessageID || sending) return;
    const approved = await new Promise<boolean>((resolve) => {
      if (Platform.OS === "web") {
        resolve(globalThis.confirm?.(`${copy.deleteTitle}\n\n${copy.deleteDescription}`) ?? false);
        return;
      }
      Alert.alert(copy.deleteTitle, copy.deleteDescription, [
        { text: copy.cancel, style: "cancel", onPress: () => resolve(false) },
        { text: copy.delete, style: "destructive", onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!approved) return;

    setDeletingMessageID(message.id);
    setSendError(null);
    try {
      await runWithSession(
        (activeSession, signal) => deleteChatMessage(chatID, message.id, activeSession, signal),
        new AbortController().signal,
      );
      setMessages((current) => current.filter((item) => item.id !== message.id));
      setTranslatedMessages((current) => {
        if (!current[message.id]) return current;
        const next = { ...current };
        delete next[message.id];
        return next;
      });
      setOriginalMessages((current) => {
        if (!current[message.id]) return current;
        const next = { ...current };
        delete next[message.id];
        return next;
      });
      for (const key of translationAttemptsRef.current) {
        if (key.startsWith(`${message.id}:`)) translationAttemptsRef.current.delete(key);
      }
      if (editingMessageID === message.id) {
        setEditingMessageID(null);
        setDraft("");
      }
      setNotice(null);
    } catch {
      setNotice(copy.deleteFailed);
    } finally {
      setDeletingMessageID(null);
    }
  };

  const openSafetyModal = (modal: SafetyModal) => {
    Keyboard.dismiss();
    setSafetyModal(modal);
  };

  const shareCurrentLocation = async () => {
    if (!chatID || readOnly || sending || sharingLocation) return;
    const approved = await new Promise<boolean>((resolve) => {
      if (Platform.OS === "web") { resolve(globalThis.confirm?.(`${copy.locationConfirmTitle}\n\n${copy.locationConfirm}`) ?? false); return; }
      Alert.alert(copy.locationConfirmTitle, copy.locationConfirm, [
        { text: copy.cancel, style: "cancel", onPress: () => resolve(false) },
        { text: copy.confirm, onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!approved) return;
    setSharingLocation(true);
    setSendError(null);
    try {
      const current = await resolveCurrentLocationDisplay();
      if (!current) throw new Error("location_unavailable");
      const sent = await runWithSession((activeSession, signal) => sendChatLocation(chatID, {
        latitude: current.coordinates.latitude,
        longitude: current.coordinates.longitude,
        accuracy_m: current.coordinates.accuracy_m,
        display_name: current.displayName,
      }, activeSession, undefined, undefined, signal), new AbortController().signal);
      const activeSession = getCurrentSession() ?? session;
      if (activeSession) setMessages((items) => mergeChatMessage(items, toChatMessageView(chatID, sent, activeSession.user_id, chatMessageKeyRef.current ?? undefined)));
      setNotice(copy.locationShared);
    } catch {
      setSendError(copy.locationUnavailable);
    } finally {
      setSharingLocation(false);
    }
  };

  const openLocationMap = async (provider: "apple" | "google", latitude: number, longitude: number) => {
    const query = `${latitude},${longitude}`;
    const url = provider === "apple"
      ? `https://maps.apple.com/?ll=${encodeURIComponent(query)}&q=${encodeURIComponent(query)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    await Linking.openURL(url).catch(() => setNotice(copy.sendFailed));
  };

  const closeSafetyModal = () => {
    if (safetySubmittingRef.current || safetySubmitting) return;
    Keyboard.dismiss();
    setSafetyModal(null);
  };

  const startConfirmation = (action: ConfirmAction, target: ReportTarget | null = null) => {
    openSafetyModal({ kind: "confirm", action, target });
  };

  const confirmSafetyAction = async () => {
    const modal = safetyModal;
    if (!modal || modal.kind !== "confirm" || safetySubmitting || safetySubmittingRef.current) return;
    const { action } = modal;

    if (action === "account_report") {
      openSafetyModal({ kind: "report", target: { kind: "account" } });
      return;
    }
    if (action === "message_report") {
      if (!modal.target) {
        setSafetyModal(null);
        setNotice(copy.reportFailed);
        return;
      }
      openSafetyModal({ kind: "report", target: modal.target });
      return;
    }

    safetySubmittingRef.current = true;
    setSafetySubmitting(true);
    try {
      if (action === "block") {
        const blockedUserID = chat?.other_user_id;
        if (!blockedUserID) throw new Error("missing_block_target");
        await runWithSession(
          (activeSession, signal) => blockUser(blockedUserID, activeSession, signal),
          new AbortController().signal,
        );
        setLocallyClosed("blocked");
        setNotice(copy.blockedLocal);
        setSafetyModal(null);
      } else {
        const matchID = chat?.match_id ?? match?.id;
        if (!matchID) throw new Error("missing_match");
        await runWithSession(
          (activeSession, signal) => declineMatch(matchID, activeSession, signal),
          new AbortController().signal,
        );
        setSafetyModal(null);
        router.replace("/chat");
      }
    } catch {
      setNotice(action === "block" ? copy.blockFailed : copy.declineFailed);
      setSafetyModal(null);
    } finally {
      safetySubmittingRef.current = false;
      setSafetySubmitting(false);
    }
  };

  const submitReport = async (reason: ChatReportReason) => {
    const modal = safetyModal;
    if (!modal || modal.kind !== "report" || safetySubmitting || safetySubmittingRef.current) return;
    const { target } = modal;

    const targetID = target.kind === "message" ? target.messageID : chat?.other_user_id;
    if (!targetID) {
      setSafetyModal(null);
      setNotice(copy.reportFailed);
      return;
    }

    safetySubmittingRef.current = true;
    setSafetySubmitting(true);
    try {
      await runWithSession(
        (activeSession, signal) => createSafetyReport(activeSession, {
          target_type: target.kind === "message" ? "message" : "user",
          target_id: targetID,
          reason,
        }, signal),
        new AbortController().signal,
      );
      setSafetyModal(null);
      setNotice(`${copy.reportSubmitted} ${copy.reasons[reason]}`);
    } catch {
      setSafetyModal(null);
      setNotice(copy.reportFailed);
    } finally {
      safetySubmittingRef.current = false;
      setSafetySubmitting(false);
    }
  };

  const confirmAction = safetyModal?.kind === "confirm" ? safetyModal.action : null;
  const confirmTitle = confirmAction === "decline"
    ? copy.declineTitle
    : confirmAction === "block"
      ? copy.blockTitle
      : confirmAction === "account_report"
        ? copy.accountReportTitle
        : copy.messageReportTitle;
  const confirmDescription = confirmAction === "decline"
    ? copy.declineDescription
    : confirmAction === "block"
      ? copy.blockDescription
      : confirmAction === "account_report"
        ? copy.accountReportDescription
        : copy.messageReportDescription;

  if (!language || loading) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <ActivityIndicator color={BLUE} />
        <Text style={styles.loadingText}>{copy.loading}</Text>
      </View>
    );
  }

  if (loadError || !chatID) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <Text accessibilityRole="alert" style={styles.loadingText}>{loadError ?? copy.loadError}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void load("initial")}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <Text style={styles.retryButtonText}>{copy.retry}</Text>
        </Pressable>
      </View>
    );
  }

  const quickReplies = [copy.quickWhere, copy.quickGate, copy.quickThanks];
  const latestOwnMessage = [...displayMessages].reverse().find((message) => message.mine);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <DismissKeyboardView pointerEvents={safetyModal ? "none" : "auto"} style={styles.screenContent}>
        <StatusBar style="light" />
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 36) }]}>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, { top: Math.max(insets.top + 8, 49) }, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
        </Pressable>
        <View style={styles.headerProfile}>
          <View style={styles.headerAvatar}>
            <MaterialIcons color="#ffffff" name="account-circle" size={54} />
          </View>
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={styles.headerName}>{chat?.other_user_name || "Samurai Meet user"}</Text>
            <Text numberOfLines={1} style={styles.headerSub}>{readOnly ? copy.readOnly : copy.safetyNotice}</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel={copy.menuTitle}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => openSafetyModal({ kind: "menu" })}
          style={({ pressed }) => [
            styles.moreButton,
            { top: Math.max(insets.top + 8, 49) },
            pressed && styles.pressed,
          ]}
        >
          <MaterialIcons color="#ffffff" name="more-horiz" size={30} />
        </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl onRefresh={() => void load("refresh")} refreshing={refreshing} tintColor={BLUE} />
          }
          scrollEnabled={safetyModal === null}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        {match ? (
          <View style={styles.schedulePanel}>
            <View style={styles.scheduleIcon}>
              <MaterialIcons color={YELLOW} name={CATEGORY_ICONS[match.recruitment.category]} size={28} />
            </View>
            <View style={styles.scheduleText}>
              <Text numberOfLines={2} style={styles.scheduleTitle}>{match.recruitment.description || copy.scheduleTitle}</Text>
              <View style={styles.scheduleMeta}>
                <View style={styles.scheduleMetaItem}>
                  <MaterialIcons color={YELLOW} name="calendar-today" size={18} />
                  <Text numberOfLines={1} style={styles.scheduleMetaText}>{copy.date}: {match.recruitment.available_date}</Text>
                </View>
                <View style={styles.scheduleMetaItem}>
                  <MaterialIcons color={YELLOW} name="schedule" size={18} />
                  <Text numberOfLines={1} style={styles.scheduleMetaText}>
                    {copy.time}: {formatTimeRange(match.recruitment.start_time, match.recruitment.duration_hours)}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.noticePanel}>
          <MaterialIcons color={BLUE} name="security" size={20} />
          <Text style={styles.noticeText}>{copy.safetyNotice}</Text>
        </View>

        {realtimeMode === "rest_sync" ? (
          <Text accessibilityLiveRegion="polite" style={styles.syncNotice}>{copy.restSyncOnly}</Text>
        ) : null}

        {notice ? (
          <View style={styles.localNotice}>
            <Text style={styles.localNoticeText}>{notice}</Text>
          </View>
        ) : null}

        {displayMessages.some((message) => translatedMessages[message.id] || translationLoading[message.id]) ? (
          <Text style={styles.translationNotice}>{copy.translationNotice}</Text>
        ) : null}

        {remoteTyping ? <Text accessibilityLiveRegion="polite" style={styles.syncNotice}>{copy.remoteTyping}</Text> : null}

        {displayMessages.length === 0 ? (
          <View style={styles.emptyPanel}>
            <MaterialIcons color={BLUE} name="forum" size={34} />
            <Text style={styles.emptyText}>{copy.empty}</Text>
          </View>
        ) : (
          displayMessages.map((message) => {
            const imageAttachment = message.content_type === "image" ? message.attachment : undefined;
            const imageFailed = imageAttachment ? attachmentErrors[imageAttachment.id] === true : false;
            const translatable = (message.content_type ?? "text") === "text" && !!message.plaintext;
            return (
              <View key={chatMessageKey(message)}>
              {message.mine && editingMessageID === message.id ? (
                <Text accessibilityLiveRegion="polite" style={styles.editingNotice}>{copy.editing}</Text>
              ) : null}
              <ChatBubble
                createdAt={message.created_at}
                encryptedFallback={message.content_type !== "image" && !message.plaintext}
                editedAt={message.edited_at}
                editedLabel={copy.edited}
                editLabel={message.mine && (message.content_type ?? "text") === "text" && !!message.plaintext ? copy.edit : undefined}
                deleteLabel={message.mine ? copy.delete : undefined}
                imageLabel={copy.photo}
                imageLoading={imageAttachment ? attachmentLoading[imageAttachment.id] === true : false}
                imageRetryLabel={copy.photoRetry}
                imageUri={imageAttachment ? attachmentSources[imageAttachment.id] ?? null : null}
                mine={message.mine}
                onDelete={message.mine ? () => void deleteMessage(message) : undefined}
                onEdit={message.mine && (message.content_type ?? "text") === "text" && !!message.plaintext
                  ? () => startEditing(message)
                  : undefined}
                onReport={!message.mine
                  ? () => startConfirmation("message_report", { kind: "message", messageID: message.id })
                  : undefined}
                onRetryImage={imageAttachment && imageFailed ? () => void hydrateAttachment(message, true) : undefined}
                onToggleTranslation={translatable ? () => toggleTranslation(message) : undefined}
                onTranslate={translatable ? () => toggleTranslation(message) : undefined}
                originalLabel={copy.original}
                reportLabel={!message.mine ? copy.messageReport : undefined}
                text={imageAttachment ? (imageFailed ? copy.photoLoadFailed : copy.photo) : message.location ? copy.locationShared : message.locationExpired ? copy.locationExpired : message.plaintext ?? copy.encryptedMessage}
                translateLabel={translatable ? copy.translate : ""}
                translatedLabel={copy.translate}
                translatedText={translatedMessages[message.id] ?? null}
                translationLoading={translationLoading[message.id] === true}
                translationLoadingLabel={copy.translationLoading}
                translationMode="inline"
                showOriginal={originalMessages[message.id] === true}
              />
            {message.location ? (
              <View style={[styles.locationCard, message.mine ? styles.locationCardMine : styles.locationCardOther]}>
                <Text numberOfLines={2} style={styles.locationName}>{message.location.display_name || `${message.location.latitude.toFixed(5)}, ${message.location.longitude.toFixed(5)}`}</Text>
                <Text style={styles.locationMeta}>{copy.locationExpires}: {new Date(message.location.expires_at).toLocaleString(language === "ja" ? "ja-JP" : "en-US")}</Text>
                <View style={styles.locationActions}>
                  <Pressable accessibilityRole="link" onPress={() => void openLocationMap("apple", message.location!.latitude, message.location!.longitude)} style={styles.locationAction}>
                    <Text style={styles.locationActionText}>{copy.openAppleMaps}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="link" onPress={() => void openLocationMap("google", message.location!.latitude, message.location!.longitude)} style={styles.locationAction}>
                    <Text style={styles.locationActionText}>{copy.openGoogleMaps}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
              </View>
            );
          })
        )}
        {latestOwnMessage && remoteReadSequence >= latestOwnMessage.sequence ? (
          <Text accessibilityLiveRegion="polite" style={styles.readReceipt}>{copy.remoteRead}</Text>
        ) : null}
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom + 12, 22) }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickReplyScroll}>
          <View style={styles.quickReplyRow}>
            {quickReplies.map((reply) => (
              <Pressable
                key={reply}
                accessibilityRole="button"
                disabled={readOnly || safetyModal !== null}
                onPress={() => setDraft(reply)}
                style={({ pressed }) => [styles.quickReply, readOnly && styles.disabledPill, pressed && styles.pressed]}
              >
                <Text numberOfLines={1} style={[styles.quickReplyText, readOnly && styles.disabledPillText]}>{reply}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {readOnly ? (
          <Text style={styles.readOnlyText}>{locallyClosed === "blocked" ? copy.blockedLocal : locallyClosed === "declined" ? copy.declinedLocal : copy.readOnly}</Text>
        ) : sendError ? (
          <Text accessibilityRole="alert" style={styles.moderationText}>{sendError}</Text>
        ) : null}

        {editingMessageID ? (
          <View style={styles.editingBar}>
            <Text style={styles.editingBarText}>{copy.editing}</Text>
            <Pressable accessibilityRole="button" onPress={cancelEditing} style={({ pressed }) => [styles.editingCancel, pressed && styles.pressed]}>
              <Text style={styles.editingCancelText}>{copy.cancel}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <Pressable
            accessibilityLabel={copy.sendPhoto}
            accessibilityRole="button"
            disabled={readOnly || !!editingMessageID || sending || sharingLocation || sendingPhoto || safetyModal !== null}
            onPress={() => void pickAndSendImage()}
            style={({ pressed }) => [styles.locationButton, (readOnly || !!editingMessageID || sending || sharingLocation || sendingPhoto) && styles.sendButtonDisabled, pressed && styles.pressed]}
          >
            {sendingPhoto ? <ActivityIndicator color="#ffffff" size="small" /> : <MaterialIcons color="#ffffff" name="photo-library" size={22} />}
          </Pressable>
          <Pressable
            accessibilityLabel={copy.shareLocation}
            accessibilityRole="button"
            disabled={readOnly || !!editingMessageID || sending || sharingLocation || sendingPhoto || safetyModal !== null}
            onPress={() => void shareCurrentLocation()}
            style={({ pressed }) => [styles.locationButton, (readOnly || !!editingMessageID || sending || sharingLocation || sendingPhoto) && styles.sendButtonDisabled, pressed && styles.pressed]}
          >
            {sharingLocation ? <ActivityIndicator color="#ffffff" size="small" /> : <MaterialIcons color="#ffffff" name="location-on" size={22} />}
          </Pressable>
          <TextInput
            accessibilityLabel={copy.input}
            editable={!readOnly && !sending && !sendingPhoto && !deletingMessageID && safetyModal === null}
            multiline
            onChangeText={setDraft}
            placeholder={copy.input}
            placeholderTextColor={MUTED_GRAY}
            style={[styles.input, readOnly && styles.inputDisabled]}
            value={draft}
          />
          <Pressable
            accessibilityLabel={editingMessageID ? copy.saveEdit : sendingPhoto ? copy.photoSending : sending ? copy.sending : copy.send}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => void submit()}
            style={({ pressed }) => [styles.sendButton, !canSend && styles.sendButtonDisabled, pressed && styles.pressed]}
          >
            {sending ? <ActivityIndicator color="#ffffff" size="small" /> : <MaterialIcons color="#ffffff" name={editingMessageID ? "check" : "send"} size={24} />}
          </Pressable>
        </View>
        </View>
      </DismissKeyboardView>

      <Modal
        animationType="none"
        onRequestClose={closeSafetyModal}
        presentationStyle="overFullScreen"
        transparent
        visible={safetyModal !== null}
      >
        {safetyModal ? (
          <View accessibilityViewIsModal style={styles.safetyModalRoot}>
            <Pressable
              accessibilityLabel={copy.close}
              disabled={safetySubmitting}
              onPress={closeSafetyModal}
              style={styles.modalScrim}
            />
            <View
              pointerEvents="box-none"
              style={[styles.modalLayer, safetyModal.kind === "menu" && styles.sheetLayer]}
            >
              {safetyModal.kind === "menu" ? (
                <View style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom + 18, 28) }]}>
                  <View style={styles.sheetHandle} />
                  <Text style={styles.sheetTitle}>{copy.menuTitle}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => startConfirmation("decline")}
                    style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}
                  >
                    <MaterialIcons color={BLUE} name="logout" size={23} />
                    <Text style={styles.sheetActionText}>{copy.decline}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => startConfirmation("account_report")}
                    style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}
                  >
                    <MaterialIcons color={BLUE} name="outlined-flag" size={23} />
                    <Text style={styles.sheetActionText}>{copy.accountReport}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => startConfirmation("block")}
                    style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}
                  >
                    <MaterialIcons color={DANGER} name="block" size={23} />
                    <Text style={[styles.sheetActionText, styles.dangerText]}>{copy.block}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={closeSafetyModal}
                    style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}
                  >
                    <Text style={styles.sheetCancelText}>{copy.cancel}</Text>
                  </Pressable>
                </View>
              ) : safetyModal.kind === "report" ? (
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>{safetyModal.target.kind === "message" ? copy.messageReport : copy.accountReport}</Text>
                  <Text style={styles.modalSubtitle}>{copy.reasonTitle}</Text>
                  <View style={styles.reasonList}>
                    {REPORT_REASONS.map((reason) => (
                      <Pressable
                        key={reason}
                        accessibilityRole="button"
                        disabled={safetySubmitting}
                        onPress={() => void submitReport(reason)}
                        style={({ pressed }) => [styles.reasonButton, safetySubmitting && styles.disabledPill, pressed && styles.pressed]}
                      >
                        <Text style={styles.reasonText}>{copy.reasons[reason]}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={safetySubmitting}
                    onPress={closeSafetyModal}
                    style={({ pressed }) => [styles.modalCancelButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.modalCancelText}>{copy.cancel}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>{confirmTitle}</Text>
                  <Text style={styles.modalSubtitle}>{confirmDescription}</Text>
                  <View style={styles.modalActionRow}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={closeSafetyModal}
                      disabled={safetySubmitting}
                      style={({ pressed }) => [styles.modalSecondaryButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.modalSecondaryText}>{copy.cancel}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={safetySubmitting}
                      onPress={() => void confirmSafetyAction()}
                      style={({ pressed }) => [styles.modalPrimaryButton, safetySubmitting && styles.sendButtonDisabled, pressed && styles.pressed]}
                    >
                      {safetySubmitting ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.modalPrimaryText}>{copy.confirm}</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          </View>
        ) : null}
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  screenContent: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 32,
    backgroundColor: "#ffffff",
  },
  loadingText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
  },
  header: {
    position: "relative",
    minHeight: 186,
    justifyContent: "center",
    paddingHorizontal: 38,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: BLUE,
  },
  backButton: {
    position: "absolute",
    left: 18,
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  moreButton: {
    position: "absolute",
    right: 18,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  headerProfile: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerAvatar: {
    width: 62,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
    borderRadius: 31,
  },
  headerText: {
    flex: 1,
    marginLeft: 16,
  },
  headerName: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 32,
  },
  headerSub: {
    marginTop: 5,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 17,
  },
  content: {
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 260,
  },
  schedulePanel: {
    width: "100%",
    maxWidth: 348,
    minHeight: 112,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  scheduleIcon: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 29,
    backgroundColor: "#fff8e8",
  },
  scheduleText: {
    flex: 1,
    marginLeft: 14,
  },
  scheduleTitle: {
    color: "#101318",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 23,
  },
  scheduleMeta: {
    marginTop: 12,
    gap: 8,
  },
  scheduleMetaItem: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scheduleMetaText: {
    flex: 1,
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 17,
  },
  noticePanel: {
    width: "100%",
    maxWidth: 348,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#caeafd",
    borderRadius: 10,
    backgroundColor: SOFT_BLUE,
  },
  noticeText: {
    flex: 1,
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 17,
  },
  localNotice: {
    width: "100%",
    maxWidth: 348,
    alignSelf: "center",
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#f7dfaa",
    borderRadius: 10,
    backgroundColor: "#fff8e8",
  },
  localNoticeText: {
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 18,
  },
  translationNotice: {
    marginTop: 10,
    paddingHorizontal: 24,
    color: MUTED_GRAY,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
    textAlign: "center",
  },
  emptyPanel: {
    minHeight: 190,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 20,
    textAlign: "center",
  },
  bottomBar: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    backgroundColor: "#ffffff",
  },
  quickReplyScroll: {
    maxHeight: 46,
  },
  quickReplyRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 24,
  },
  quickReply: {
    height: 34,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#caeafd",
    borderRadius: 17,
    backgroundColor: SOFT_BLUE,
  },
  quickReplyText: {
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 16,
  },
  disabledPill: {
    borderColor: BORDER_GRAY,
    backgroundColor: "#f7f7f7",
  },
  disabledPillText: {
    color: MUTED_GRAY,
  },
  readOnlyText: {
    marginTop: 6,
    paddingHorizontal: 24,
    color: MUTED_GRAY,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 17,
    textAlign: "center",
  },
  moderationText: {
    marginTop: 6,
    paddingHorizontal: 24,
    color: YELLOW,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 17,
    textAlign: "center",
  },
  editingNotice: {
    alignSelf: "flex-end",
    marginBottom: 4,
    color: YELLOW,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
  },
  editingBar: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 24,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#fff8e8",
  },
  editingBarText: {
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  editingCancel: {
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  editingCancelText: {
    color: DANGER,
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 17,
  },
  blockedModerationText: {
    color: DANGER,
  },
  inputRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    paddingTop: 10,
    paddingHorizontal: 24,
  },
  input: {
    flex: 1,
    maxHeight: 92,
    minHeight: 48,
    paddingTop: 13,
    paddingRight: 16,
    paddingBottom: 11,
    paddingLeft: 16,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 24,
    color: "#101318",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 21,
    backgroundColor: "#ffffff",
  },
  inputDisabled: {
    backgroundColor: "#f7f7f7",
  },
  sendButton: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 25,
    backgroundColor: YELLOW,
  },
  sendButtonDisabled: {
    backgroundColor: BORDER_GRAY,
  },
  retryButton: {
    minWidth: 92,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 17,
  },
  safetyModalRoot: {
    flex: 1,
    zIndex: 1000,
    elevation: 1000,
  },
  syncNotice: {
    marginTop: 8,
    paddingHorizontal: 24,
    color: MUTED_GRAY,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    textAlign: "center",
  },
  readReceipt: {
    alignSelf: "flex-end",
    marginTop: 4,
    marginRight: 12,
    color: MUTED_GRAY,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  locationButton: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 23,
    backgroundColor: BLUE,
  },
  locationCard: {
    maxWidth: "82%",
    marginTop: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#caeafd",
    borderRadius: 14,
    backgroundColor: SOFT_BLUE,
  },
  locationCardMine: { alignSelf: "flex-end" },
  locationCardOther: { alignSelf: "flex-start" },
  locationName: { color: TEXT_GRAY, fontSize: 14, fontWeight: "900", lineHeight: 20 },
  locationMeta: { marginTop: 4, color: MUTED_GRAY, fontSize: 11, fontWeight: "700", lineHeight: 16 },
  locationActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  locationAction: { minHeight: 32, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderColor: BLUE, borderRadius: 16, backgroundColor: "#ffffff" },
  locationActionText: { color: BLUE, fontSize: 11, fontWeight: "900" },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1001,
    elevation: 1,
    backgroundColor: "rgba(8, 15, 28, 0.68)",
  },
  modalLayer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 1002,
    elevation: 2,
  },
  sheetLayer: {
    alignItems: "stretch",
    justifyContent: "flex-end",
    padding: 0,
  },
  bottomSheet: {
    width: "100%",
    paddingTop: 10,
    paddingHorizontal: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#ffffff",
    zIndex: 1003,
    elevation: 24,
  },
  sheetHandle: {
    width: 48,
    height: 5,
    alignSelf: "center",
    borderRadius: 3,
    backgroundColor: BORDER_GRAY,
  },
  sheetTitle: {
    marginTop: 18,
    marginBottom: 8,
    color: "#101318",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 24,
  },
  sheetAction: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  sheetActionText: {
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 20,
  },
  dangerText: {
    color: DANGER,
  },
  sheetCancel: {
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    borderRadius: 10,
    backgroundColor: "#f7f7f7",
  },
  sheetCancelText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 342,
    padding: 22,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    zIndex: 1003,
    elevation: 24,
  },
  modalTitle: {
    color: "#101318",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 26,
  },
  modalSubtitle: {
    marginTop: 8,
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 19,
  },
  reasonList: {
    marginTop: 18,
    gap: 8,
  },
  reasonButton: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  reasonText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 18,
  },
  modalCancelButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    borderRadius: 10,
    backgroundColor: "#f7f7f7",
  },
  modalCancelText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  modalActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  modalSecondaryButton: {
    flex: 1,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  modalSecondaryText: {
    color: BLUE,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  modalPrimaryButton: {
    flex: 1,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  modalPrimaryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
});
