import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { useAuth } from "../../hooks/useAuth";
import { APIError } from "../../services/api-client";
import {
  blockUser,
  chatWebSocketURL,
  createSafetyReport,
  issueChatTransportToken,
  listChatMessages,
  listChats,
  markChatRead,
  moderateChatText,
  parseChatSocketFrame,
  sendChatMessage,
  toChatMessageView,
  translateChatText,
  validateChatDraft,
  type ChatMessageView,
  type ChatModerationCategory,
  type ChatReportReason,
  type ChatSummary,
} from "../../services/chat";
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
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

const CATEGORY_ICONS: Record<MatchCategory, MaterialIconName> = {
  Food: "restaurant",
  Heritage: "place",
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
    blockedDraft: "外部連絡先や個人情報を含む可能性があるため送信できません。",
    warningDraft: "安全確認が必要な内容を検知しました。内容を見直してください。",
    safetyNotice: "個人情報、外部連絡先、人気のない場所への誘導は送らないでください。",
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
    blockedDraft: "This may include external contact details or personal information, so it cannot be sent.",
    warningDraft: "This message needs a safety check. Please review it before sending.",
    safetyNotice: "Do not share personal information, external contacts, or unsafe meeting places.",
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

function latestSequence(messages: ChatMessageView[]): number {
  return messages.reduce((max, message) => Math.max(max, message.sequence), 0);
}

function mergeChatMessage(
  current: ChatMessageView[],
  incoming: ChatMessageView,
): ChatMessageView[] {
  const next = current.some((message) => message.id === incoming.id || message.client_message_id === incoming.client_message_id)
    ? current.map((message) => (
      message.id === incoming.id || message.client_message_id === incoming.client_message_id ? incoming : message
    ))
    : [...current, incoming];
  return next.sort((left, right) => left.sequence - right.sequence);
}

export default function ChatDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const chatID = Array.isArray(id) ? id[0] : id;
  const { getCurrentSession, refresh, session, status } = useAuth();
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [match, setMatch] = useState<MatchView | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, string>>({});
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locallyClosed, setLocallyClosed] = useState<"declined" | "blocked" | null>(null);
  const [safetySubmitting, setSafetySubmitting] = useState(false);
  const copy = COPY[language ?? "ja"];
  const moderation = useMemo(() => moderateChatText(draft), [draft]);
  const validation = validateChatDraft(draft);
  const readOnly = chat?.status === "completed" || locallyClosed !== null;
  const canSend = !readOnly && !sending && !validation && moderation.severity !== "block";

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
          const currentChat = summaries.find((item) => item.id === chatID) ?? null;
          const currentMatch = currentChat
            ? await getMatch(currentChat.match_id, activeSession, signal).catch(() => null)
            : null;
          return { currentChat, currentMatch, page, userID: activeSession.user_id };
        }, controller.signal);
        if (!cancelled) {
          const messageViews = result.page.items.map((message) => toChatMessageView(chatID, message, result.userID));
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
  }, [chatID, copy.loadError, copy.signInRequired, runWithSession]);

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

  useEffect(() => load("initial"), [load]);

  useEffect(() => {
    if (!chatID || chat?.status !== "accepted" || locallyClosed) return undefined;
    if (typeof WebSocket === "undefined") return undefined;

    const controller = new AbortController();
    let closed = false;
    let socket: WebSocket | null = null;

    const connect = async () => {
      try {
        const token = await runWithSession(
          (activeSession, signal) => issueChatTransportToken(chatID, activeSession, signal),
          controller.signal,
        );
        if (closed || controller.signal.aborted) return;

        socket = new WebSocket(chatWebSocketURL(chatID));
        socketRef.current = socket;
        socket.onopen = () => {
          socket?.send(JSON.stringify({ type: "auth", chat_token: token.chat_token }));
        };
        socket.onmessage = (event) => {
          if (closed || !chatID) return;
          const raw = typeof event.data === "string" ? event.data : String(event.data);
          const frame = parseChatSocketFrame(raw);
          if (!frame) return;

          if (frame.type === "message.created" || frame.type === "message.ack") {
            const activeSession = getCurrentSession() ?? session;
            if (!activeSession) return;
            const view = toChatMessageView(chatID, frame.message, activeSession.user_id);
            setMessages((current) => mergeChatMessage(current, view));
            if (!view.mine) {
              void runWithSession(
                (currentSession, signal) => markChatRead(chatID, view.sequence, currentSession, signal),
                new AbortController().signal,
              ).catch(() => undefined);
            }
          } else if (frame.type === "error" && frame.code === "blocked") {
            setLocallyClosed("blocked");
            setNotice(copy.blockedLocal);
          }
        };
        socket.onclose = () => {
          if (socketRef.current === socket) socketRef.current = null;
        };
      } catch {
        // REST history and send remain available when realtime setup fails.
      }
    };

    void connect();
    return () => {
      closed = true;
      controller.abort();
      if (socketRef.current === socket) socketRef.current = null;
      socket?.close();
    };
  }, [chat?.status, chatID, copy.blockedLocal, getCurrentSession, locallyClosed, runWithSession, session]);

  useEffect(() => {
    if (messages.length === 0) return;
    const handle = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(handle);
  }, [messages.length]);

  const submit = async () => {
    if (!chatID || sending) return;
    setSendError(null);
    if (validation) {
      setSendError(validation === "empty" ? copy.draftEmpty : copy.draftTooLong);
      return;
    }
    if (moderation.severity === "block") {
      setSendError(copy.blockedDraft);
      return;
    }
    if (readOnly) {
      setSendError(locallyClosed === "blocked" ? copy.blockedLocal : locallyClosed === "declined" ? copy.declinedLocal : copy.readOnly);
      return;
    }

    const messageText = draft.trim();
    setSending(true);
    try {
      const sent = await runWithSession((activeSession, signal) => sendChatMessage(chatID, messageText, activeSession, undefined, signal), new AbortController().signal);
      const activeSession = getCurrentSession() ?? session;
      if (activeSession) {
        setMessages((current) => [...current, toChatMessageView(chatID, sent, activeSession.user_id)]);
      }
      setDraft("");
    } catch {
      setSendError(copy.sendFailed);
    } finally {
      setSending(false);
    }
  };

  const showTranslation = (message: ChatMessageView) => {
    setTranslatedMessages((current) => {
      if (current[message.id]) {
        const next = { ...current };
        delete next[message.id];
        return next;
      }
      return {
        ...current,
        [message.id]: translateChatText(message.plaintext ?? "", language === "ja" ? "ja" : "en"),
      };
    });
  };

  const startConfirmation = (action: ConfirmAction) => {
    setMenuVisible(false);
    setConfirmAction(action);
  };

  const confirmSafetyAction = async () => {
    const action = confirmAction;
    if (!action || safetySubmitting) return;

    if (action === "account_report") {
      setReportTarget({ kind: "account" });
      setConfirmAction(null);
      return;
    }
    if (action === "message_report") {
      setReportTarget((current) => current ?? { kind: "message", messageID: "" });
      setConfirmAction(null);
      return;
    }

    setSafetySubmitting(true);
    try {
      if (action === "block") {
        const blockedUserID = chat?.other_user_id;
        if (!blockedUserID) throw new Error("missing_block_target");
        await runWithSession(
          (activeSession, signal) => blockUser(blockedUserID, activeSession, signal),
          new AbortController().signal,
        );
        socketRef.current?.close();
        setLocallyClosed("blocked");
        setNotice(copy.blockedLocal);
      } else {
        const matchID = chat?.match_id ?? match?.id;
        if (!matchID) throw new Error("missing_match");
        await runWithSession(
          (activeSession, signal) => declineMatch(matchID, activeSession, signal),
          new AbortController().signal,
        );
        socketRef.current?.close();
        setLocallyClosed("declined");
        setNotice(copy.declinedLocal);
      }
      setConfirmAction(null);
    } catch {
      setNotice(action === "block" ? copy.blockFailed : copy.declineFailed);
      setConfirmAction(null);
    } finally {
      setSafetySubmitting(false);
    }
  };

  const submitReport = async (reason: ChatReportReason) => {
    const target = reportTarget;
    if (!target || safetySubmitting) return;

    const targetID = target.kind === "message" ? target.messageID : chat?.other_user_id;
    if (!targetID) {
      setReportTarget(null);
      setNotice(copy.reportFailed);
      return;
    }

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
      setReportTarget(null);
      setNotice(`${copy.reportSubmitted} ${copy.reasons[reason]}`);
    } catch {
      setNotice(copy.reportFailed);
    } finally {
      setSafetySubmitting(false);
    }
  };

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

  const categoryLabels = moderation.categories.map((category: ChatModerationCategory) => copy.categories[category]).join(" / ");
  const quickReplies = [copy.quickWhere, copy.quickGate, copy.quickThanks];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
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
          onPress={() => setMenuVisible(true)}
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

        {notice ? (
          <View style={styles.localNotice}>
            <Text style={styles.localNoticeText}>{notice}</Text>
          </View>
        ) : null}

        {messages.length === 0 ? (
          <View style={styles.emptyPanel}>
            <MaterialIcons color={BLUE} name="forum" size={34} />
            <Text style={styles.emptyText}>{copy.empty}</Text>
          </View>
        ) : (
          messages.map((message) => (
            <ChatBubble
              key={message.id}
              createdAt={message.created_at}
              encryptedFallback={!message.plaintext}
              mine={message.mine}
              onReport={!message.mine ? () => {
                setReportTarget({ kind: "message", messageID: message.id });
                setConfirmAction("message_report");
              } : undefined}
              onTranslate={() => showTranslation(message)}
              reportLabel={!message.mine ? copy.messageReport : undefined}
              text={message.plaintext ?? copy.encryptedMessage}
              translateLabel={copy.translate}
              translatedText={translatedMessages[message.id] ?? null}
            />
          ))
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom + 12, 22) }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickReplyScroll}>
          <View style={styles.quickReplyRow}>
            {quickReplies.map((reply) => (
              <Pressable
                key={reply}
                accessibilityRole="button"
                disabled={readOnly}
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
        ) : moderation.severity !== "none" ? (
          <Text accessibilityRole="alert" style={[styles.moderationText, moderation.severity === "block" && styles.blockedModerationText]}>
            {moderation.severity === "block" ? copy.blockedDraft : copy.warningDraft} {categoryLabels}
          </Text>
        ) : sendError ? (
          <Text accessibilityRole="alert" style={styles.moderationText}>{sendError}</Text>
        ) : null}

        <View style={styles.inputRow}>
          <TextInput
            accessibilityLabel={copy.input}
            editable={!readOnly && !sending}
            multiline
            onChangeText={setDraft}
            placeholder={copy.input}
            placeholderTextColor={MUTED_GRAY}
            style={[styles.input, readOnly && styles.inputDisabled]}
            value={draft}
          />
          <Pressable
            accessibilityLabel={sending ? copy.sending : copy.send}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => void submit()}
            style={({ pressed }) => [styles.sendButton, !canSend && styles.sendButtonDisabled, pressed && styles.pressed]}
          >
            {sending ? <ActivityIndicator color="#ffffff" size="small" /> : <MaterialIcons color="#ffffff" name="send" size={24} />}
          </Pressable>
        </View>
      </View>

      <Modal animationType="slide" transparent visible={menuVisible} onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuVisible(false)}>
          <Pressable style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom + 18, 28) }]}>
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
              onPress={() => setMenuVisible(false)}
              style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}
            >
              <Text style={styles.sheetCancelText}>{copy.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal animationType="fade" transparent visible={!!reportTarget && !confirmAction} onRequestClose={() => setReportTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{reportTarget?.kind === "message" ? copy.messageReport : copy.accountReport}</Text>
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
              onPress={() => setReportTarget(null)}
              style={({ pressed }) => [styles.modalCancelButton, pressed && styles.pressed]}
            >
              <Text style={styles.modalCancelText}>{copy.cancel}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={!!confirmAction} onRequestClose={() => setConfirmAction(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{confirmTitle}</Text>
            <Text style={styles.modalSubtitle}>{confirmDescription}</Text>
            <View style={styles.modalActionRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (confirmAction === "message_report") setReportTarget(null);
                  setConfirmAction(null);
                }}
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
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
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
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  bottomSheet: {
    width: "100%",
    paddingTop: 10,
    paddingHorizontal: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#ffffff",
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
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  modalCard: {
    width: "100%",
    maxWidth: 342,
    padding: 22,
    borderRadius: 20,
    backgroundColor: "#ffffff",
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
