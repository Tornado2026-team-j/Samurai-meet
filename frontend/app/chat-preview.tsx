import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ChatBubble from "../components/ChatBubble";
import { moderateChatText, translateChatText, validateChatDraft } from "../services/chat";
import type { MatchCategory } from "../types/match";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";
const DANGER = "#b42318";

type PreviewMessage = {
  id: string;
  created_at: string;
  speaker: PreviewSpeaker;
  plaintext: string;
};

type PreviewSide = "japanese" | "foreigner";
type PreviewSpeaker = "japanese" | "foreigner";
type ConfirmAction = "decline" | "account_report" | "block" | "message_report";
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

const CATEGORY_ICONS: Record<MatchCategory, MaterialIconName> = {
  Food: "restaurant",
  Heritage: "place",
  Activity: "directions-run",
  Other: "category",
};

const MOCK_RECRUITMENT: {
  category: MatchCategory;
  title: string;
  dateLabel: string;
  meetingPlace: string;
} = {
  category: "Heritage",
  title: "伏見稲荷案内",
  dateLabel: "Today 14:00",
  meetingPlace: "Inari Station",
};

const PREVIEW_PARTICIPANTS: Record<PreviewSide, { name: string; subtitle: string }> = {
  japanese: {
    name: "Sofia",
    subtitle: "United States ・案内前の確認",
  },
  foreigner: {
    name: "Haruto",
    subtitle: "Japan ・Guide coordination",
  },
};

const PREVIEW_UI: Record<PreviewSide, {
  back: string;
  safetyMenu: string;
  safetyNotice: string;
  input: string;
  send: string;
  translate: string;
  messageReport: string;
  decline: string;
  accountReport: string;
  block: string;
  cancel: string;
  confirm: string;
  empty: string;
  tooLong: string;
  blocked: string;
  warning: string;
  declineTitle: string;
  accountReportTitle: string;
  blockTitle: string;
  messageReportTitle: string;
  declineDescription: string;
  accountReportDescription: string;
  blockDescription: string;
  messageReportDescription: string;
  declineNotice: string;
  accountReportNotice: string;
  blockNotice: string;
  messageReportNotice: string;
}> = {
  japanese: {
    back: "戻る",
    safetyMenu: "安全メニュー",
    safetyNotice: "個人情報、外部連絡先、人気のない場所への誘導は送らないでください。",
    input: "メッセージを入力",
    send: "送信",
    translate: "翻訳",
    messageReport: "このメッセージを通報",
    decline: "案件を辞退する",
    accountReport: "このユーザーを報告する",
    block: "ブロックする",
    cancel: "キャンセル",
    confirm: "確定",
    empty: "メッセージを入力してください。",
    tooLong: "メッセージは2000文字以内で入力してください。",
    blocked: "外部連絡先や個人情報を含む可能性があるため送信できません。",
    warning: "安全確認が必要な内容を検知しました。",
    declineTitle: "案内を辞退しますか？",
    accountReportTitle: "このユーザーを報告しますか？",
    blockTitle: "ブロックしますか？",
    messageReportTitle: "このメッセージを通報しますか？",
    declineDescription: "相手に通知されます。この案内はキャンセルされます。",
    accountReportDescription: "運営が内容を確認します。相手には通知されません。",
    blockDescription: "相手はあなたにメッセージを送れなくなります。",
    messageReportDescription: "選択したメッセージと前後の会話が運営確認対象になります。",
    declineNotice: "案内を辞退済みとして扱います。プレビューなのでAPI送信はしません。",
    accountReportNotice: "ユーザー報告を受け付ける導線です。プレビューなのでAPI送信はしません。",
    blockNotice: "ブロック後の送信停止導線です。プレビューなのでAPI送信はしません。",
    messageReportNotice: "メッセージ通報を受け付ける導線です。プレビューなのでAPI送信はしません。",
  },
  foreigner: {
    back: "Back",
    safetyMenu: "Safety menu",
    safetyNotice: "Do not share personal information, external contacts, or unsafe meeting places.",
    input: "Enter message",
    send: "Send",
    translate: "Translate",
    messageReport: "Report this message",
    decline: "Decline this guide",
    accountReport: "Report this user",
    block: "Block",
    cancel: "Cancel",
    confirm: "Confirm",
    empty: "Enter a message.",
    tooLong: "Messages must be 2000 characters or fewer.",
    blocked: "This may include external contact details or personal information, so it cannot be sent.",
    warning: "This message needs a safety check.",
    declineTitle: "Decline this guide?",
    accountReportTitle: "Report this user?",
    blockTitle: "Block this person?",
    messageReportTitle: "Report this message?",
    declineDescription: "The other person will be notified. This guide will be canceled.",
    accountReportDescription: "Operations will review the report. The other person will not be notified.",
    blockDescription: "This person will no longer be able to message you.",
    messageReportDescription: "The selected message and nearby conversation will be sent for operations review.",
    declineNotice: "This guide is marked declined. Preview mode does not call the API.",
    accountReportNotice: "User report flow is ready to preview. Preview mode does not call the API.",
    blockNotice: "Block flow is ready to preview. Preview mode does not call the API.",
    messageReportNotice: "Message report flow is ready to preview. Preview mode does not call the API.",
  },
};

const INITIAL_MESSAGES: PreviewMessage[] = [
  {
    id: "preview-1",
    created_at: "2026-08-30T04:42:00Z",
    speaker: "foreigner",
    plaintext: "Hi! Should we meet at Inari Station?",
  },
  {
    id: "preview-2",
    created_at: "2026-08-30T04:44:00Z",
    speaker: "japanese",
    plaintext: "はい、稲荷駅の改札前で待ち合わせしましょう！",
  },
  {
    id: "preview-3",
    created_at: "2026-08-30T04:47:00Z",
    speaker: "foreigner",
    plaintext: "Sounds good! I'm excited.",
  },
];

export default function ChatPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { side } = useLocalSearchParams<{ side?: string | string[] }>();
  const scrollRef = useRef<ScrollView>(null);
  const rawSide = Array.isArray(side) ? side[0] : side;
  const previewSide: PreviewSide = rawSide === "foreigner" ? "foreigner" : "japanese";
  const viewerSpeaker: PreviewSpeaker = previewSide === "foreigner" ? "foreigner" : "japanese";
  const participant = PREVIEW_PARTICIPANTS[previewSide];
  const ui = PREVIEW_UI[previewSide];
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, string>>({
    "preview-3": "いいですね。楽しみにしています。",
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const validation = validateChatDraft(draft);
  const moderation = moderateChatText(draft);
  const canSend = !validation && moderation.severity !== "block";

  useEffect(() => {
    const handle = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(handle);
  }, [messages.length]);

  const sendPreviewMessage = () => {
    if (validation) {
      setNotice(validation === "empty"
        ? ui.empty
        : ui.tooLong);
      return;
    }
    if (moderation.severity === "block") {
      setNotice(ui.blocked);
      return;
    }
    setMessages((current) => [
      ...current,
      {
        id: `preview-${current.length + 1}`,
        created_at: new Date().toISOString(),
        speaker: viewerSpeaker,
        plaintext: draft.trim(),
      },
    ]);
    setDraft("");
    setNotice(null);
  };

  const toggleTranslation = (message: PreviewMessage) => {
    setTranslatedMessages((current) => {
      if (current[message.id]) {
        const next = { ...current };
        delete next[message.id];
        return next;
      }
      return {
        ...current,
        [message.id]: translateChatText(message.plaintext, previewSide === "foreigner" ? "en" : "ja"),
      };
    });
  };

  const startConfirmation = (action: ConfirmAction) => {
    setMenuVisible(false);
    setConfirmAction(action);
  };

  const confirmTitle = confirmAction === "decline"
    ? ui.declineTitle
    : confirmAction === "account_report"
      ? ui.accountReportTitle
      : confirmAction === "block"
        ? ui.blockTitle
        : ui.messageReportTitle;
  const confirmDescription = confirmAction === "decline"
    ? ui.declineDescription
    : confirmAction === "account_report"
      ? ui.accountReportDescription
      : confirmAction === "block"
        ? ui.blockDescription
        : ui.messageReportDescription;

  const confirmPreviewAction = () => {
    const nextNotice = confirmAction === "decline"
      ? ui.declineNotice
      : confirmAction === "account_report"
        ? ui.accountReportNotice
        : confirmAction === "block"
          ? ui.blockNotice
          : ui.messageReportNotice;
    setNotice(nextNotice);
    setConfirmAction(null);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 36) }]}>
        <Pressable
          accessibilityLabel={ui.back}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            { top: Math.max(insets.top + 8, 49) },
            pressed && styles.pressed,
          ]}
        >
          <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
        </Pressable>
        <View style={styles.headerProfile}>
          <View style={styles.headerAvatar}>
            <MaterialIcons color="#ffffff" name="account-circle" size={54} />
          </View>
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={styles.headerName}>{participant.name}</Text>
            <Text numberOfLines={1} style={styles.headerSub}>{participant.subtitle}</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel={ui.safetyMenu}
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
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.schedulePanel}>
          <View style={styles.scheduleIcon}>
            <MaterialIcons color={YELLOW} name={CATEGORY_ICONS[MOCK_RECRUITMENT.category]} size={28} />
          </View>
          <View style={styles.scheduleText}>
            <Text numberOfLines={2} style={styles.scheduleTitle}>{MOCK_RECRUITMENT.title}</Text>
            <View style={styles.scheduleMeta}>
              <MaterialIcons color={YELLOW} name="calendar-today" size={18} />
              <Text style={styles.scheduleMetaText}>{MOCK_RECRUITMENT.dateLabel}</Text>
              <View style={styles.scheduleDivider} />
              <MaterialIcons color={YELLOW} name="location-on" size={20} />
              <Text numberOfLines={1} style={styles.scheduleMetaText}>{MOCK_RECRUITMENT.meetingPlace}</Text>
            </View>
          </View>
        </View>

        <View style={styles.noticePanel}>
          <MaterialIcons color={BLUE} name="security" size={20} />
          <Text style={styles.noticeText}>
            {ui.safetyNotice}
          </Text>
        </View>

        {notice ? (
          <View style={styles.localNotice}>
            <Text accessibilityRole="alert" style={styles.localNoticeText}>{notice}</Text>
          </View>
        ) : null}

        {messages.map((message) => (
          <ChatBubble
            key={message.id}
            createdAt={message.created_at}
            mine={message.speaker === viewerSpeaker}
            onReport={message.speaker !== viewerSpeaker ? () => startConfirmation("message_report") : undefined}
            onTranslate={() => toggleTranslation(message)}
            reportLabel={message.speaker !== viewerSpeaker ? ui.messageReport : undefined}
            text={message.plaintext}
            translateLabel={ui.translate}
            translatedText={translatedMessages[message.id] ?? null}
          />
        ))}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom + 12, 22) }]}>
        {moderation.severity !== "none" ? (
          <Text
            accessibilityRole="alert"
            style={[
              styles.moderationText,
              moderation.severity === "block" && styles.blockedModerationText,
            ]}
          >
            {moderation.severity === "block"
              ? ui.blocked
              : ui.warning}
          </Text>
        ) : null}

        <View style={styles.inputRow}>
          <TextInput
            accessibilityLabel={ui.input}
            multiline
            onChangeText={setDraft}
            placeholder={ui.input}
            placeholderTextColor={MUTED_GRAY}
            style={styles.input}
            value={draft}
          />
          <Pressable
            accessibilityLabel={ui.send}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={sendPreviewMessage}
            style={({ pressed }) => [
              styles.sendButton,
              !canSend && styles.sendButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons color="#ffffff" name="send" size={24} />
          </Pressable>
        </View>
      </View>

      <Modal animationType="slide" transparent visible={menuVisible} onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuVisible(false)}>
          <Pressable style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom + 18, 28) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{ui.safetyMenu}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => startConfirmation("decline")}
              style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}
            >
              <MaterialIcons color={BLUE} name="logout" size={23} />
              <Text style={styles.sheetActionText}>{ui.decline}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => startConfirmation("account_report")}
              style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}
            >
              <MaterialIcons color={BLUE} name="outlined-flag" size={23} />
              <Text style={styles.sheetActionText}>{ui.accountReport}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => startConfirmation("block")}
              style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}
            >
              <MaterialIcons color={DANGER} name="block" size={23} />
              <Text style={[styles.sheetActionText, styles.dangerText]}>{ui.block}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setMenuVisible(false)}
              style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}
            >
              <Text style={styles.sheetCancelText}>{ui.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal animationType="fade" transparent visible={!!confirmAction} onRequestClose={() => setConfirmAction(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{confirmTitle}</Text>
            <Text style={styles.modalSubtitle}>{confirmDescription}</Text>
            <View style={styles.modalActionRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmAction(null)}
                style={({ pressed }) => [styles.modalSecondaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.modalSecondaryText}>{ui.cancel}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={confirmPreviewAction}
                style={({ pressed }) => [styles.modalPrimaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.modalPrimaryText}>{ui.confirm}</Text>
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
    paddingBottom: 210,
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
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 24,
  },
  scheduleMeta: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 10,
  },
  scheduleMetaText: {
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 16,
  },
  scheduleDivider: {
    width: 1,
    height: 20,
    marginHorizontal: 3,
    backgroundColor: BORDER_GRAY,
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
  moderationText: {
    marginTop: 8,
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
