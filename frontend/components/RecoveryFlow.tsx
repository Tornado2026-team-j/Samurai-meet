import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { MaterialIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLanguage } from "../services/onboarding";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#7d7d7d";

type RecoveryCopy = {
  back: string;
  title: string;
  inputTitle: string;
  inputDescription: string;
  inputPlaceholder: string;
  submit: string;
  submitting: string;
  displayTitle: string;
  displayDescription: string;
  displayWarning: string;
  rotateTitle: string;
  rotateDescription: string;
  rotateWarning: string;
  rotateComplete: string;
  copyRecoveryKey: string;
  copied: string;
  copyFailed: string;
  supportAccountID: string;
  copyAccountID: string;
  saved: string;
  complete: string;
  completing: string;
  genericError: string;
  deleteAccount: string;
  deleteTitle: string;
  deleteWarning: string;
  deleteScope: string;
  confirmDeleteInstruction: string;
  confirmDeletePlaceholder: string;
  deleteConfirm: string;
  deleting: string;
  deleteError: string;
  cancel: string;
};

const COPY: Record<AppLanguage, RecoveryCopy> = {
  ja: {
    back: "戻る",
    title: "アカウント復旧",
    inputTitle: "Recovery Keyを入力",
    inputDescription: "保存しておいたRecovery Keyを入力してください。鍵は端末上でのみ使われ、サーバーへ送信されません。",
    inputPlaceholder: "Recovery Key（Base64URL）",
    submit: "復旧してPasskeyを設定",
    submitting: "復旧を確認中…",
    displayTitle: "Recovery Keyを保存",
    displayDescription: "この鍵は新しい端末で暗号鍵を復旧するために必要です。画面を閉じる前にパスワード管理アプリなどへ保存してください。",
    displayWarning: "Recovery Keyを失うと、暗号化データを復号できなくなります。サーバーには保存されません。",
    rotateTitle: "新しいRecovery Keyを保存",
    rotateDescription: "現在の暗号鍵を変えずに、新しいRecovery Keyへ更新します。画面を閉じる前に安全な場所へ保存してください。",
    rotateWarning: "更新して続けると、以前のRecovery Keyは無効になります。サーバーにはRecovery Key自体は保存されません。",
    rotateComplete: "新しいKeyを保存して更新",
    copyRecoveryKey: "Recovery Keyをコピー",
    copied: "コピーしました",
    copyFailed: "コピーに失敗しました。キーを選択して手動で保存してください。",
    supportAccountID: "問い合わせ用アカウントID",
    copyAccountID: "IDをコピー",
    saved: "安全な場所に保存しました",
    complete: "保存して続ける",
    completing: "鍵を登録中…",
    genericError: "Recovery Keyの確認に失敗しました。もう一度お試しください。",
    deleteAccount: "このアカウントを削除",
    deleteTitle: "アカウントを削除しますか？",
    deleteWarning: "Recovery Keyを登録せずに削除すると、アカウントと保存データは復元できません。",
    deleteScope: "削除対象: アカウント、全セッション、端末鍵、暗号化データ",
    confirmDeleteInstruction: "確認のため DELETE と入力してください。",
    confirmDeletePlaceholder: "DELETE と入力",
    deleteConfirm: "Passkeyで再認証して削除",
    deleting: "削除中…",
    deleteError: "削除に失敗しました。入力内容と通信状態を確認して、もう一度お試しください。",
    cancel: "キャンセル",
  },
  en: {
    back: "Back",
    title: "Account recovery",
    inputTitle: "Enter your Recovery Key",
    inputDescription: "Enter the Recovery Key you saved. It is used only on this device and is never sent to the server.",
    inputPlaceholder: "Recovery Key (Base64URL)",
    submit: "Recover and set up a passkey",
    submitting: "Verifying recovery…",
    displayTitle: "Save your Recovery Key",
    displayDescription: "You need this key to recover your encryption key on a new device. Save it in a password manager before leaving this screen.",
    displayWarning: "If you lose the Recovery Key, encrypted data cannot be decrypted. The server never stores it.",
    rotateTitle: "Save your new Recovery Key",
    rotateDescription: "Your encryption key stays the same while the Recovery Key is replaced. Save this key somewhere secure before leaving.",
    rotateWarning: "After continuing, the previous Recovery Key will no longer work. The server never stores the Recovery Key itself.",
    rotateComplete: "Save the new key and update",
    copyRecoveryKey: "Copy Recovery Key",
    copied: "Copied",
    copyFailed: "Copy failed. Select the key and save it manually.",
    supportAccountID: "Account ID for support",
    copyAccountID: "Copy ID",
    saved: "I saved it in a secure place",
    complete: "Save and continue",
    completing: "Registering keys…",
    genericError: "Recovery Key could not be verified. Please try again.",
    deleteAccount: "Delete this account",
    deleteTitle: "Delete this account?",
    deleteWarning: "If you delete without registering a Recovery Key, your account and stored data cannot be recovered.",
    deleteScope: "This deletes your account, all sessions, device keys, and encrypted data.",
    confirmDeleteInstruction: "Type DELETE to confirm.",
    confirmDeletePlaceholder: "Type DELETE",
    deleteConfirm: "Re-authenticate with Passkey and delete",
    deleting: "Deleting…",
    deleteError: "Deletion failed. Check the confirmation text and connection, then try again.",
    cancel: "Cancel",
  },
};

type RecoveryKeyInputProps = {
  accountID?: string;
  language: AppLanguage;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (recoveryKey: string) => Promise<void>;
  onDeleteAccount?: () => Promise<void>;
};

export function RecoveryKeyInput({ accountID, language, busy, error, onBack, onSubmit, onDeleteAccount }: RecoveryKeyInputProps) {
  const insets = useSafeAreaInsets();
  const copy = COPY[language];
  const [recoveryKey, setRecoveryKey] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitRecoveryKey = async () => {
    if (busy || recoveryKey.trim().length === 0) return;
    setSubmitError(null);
    try {
      await onSubmit(recoveryKey.replace(/\s+/g, ""));
    } catch {
      // The parent owns the authenticated error state. Keep unexpected
      // promise failures from becoming an Expo unhandled rejection.
      setSubmitError(copy.genericError);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="arrow-back-ios-new" size={21} />
        </Pressable>
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <MaterialIcons color={BLUE} name="vpn-key" size={58} />
        <Text style={styles.title}>{copy.inputTitle}</Text>
        <Text style={styles.description}>{copy.inputDescription}</Text>
        {accountID ? <SupportAccountID accountID={accountID} language={language} /> : null}
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          onChangeText={(value) => {
            setRecoveryKey(value);
            setSubmitError(null);
          }}
          placeholder={copy.inputPlaceholder}
          placeholderTextColor="#a0a0a0"
          style={styles.input}
          textContentType="password"
          value={recoveryKey}
        />
        {error || submitError ? <Text style={styles.errorText}>{error ?? submitError}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || recoveryKey.trim().length === 0}
          onPress={() => void submitRecoveryKey()}
          style={({ pressed }) => [
            styles.primaryButton,
            (busy || recoveryKey.trim().length === 0) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>{copy.submit}</Text>}
        </Pressable>
        {onDeleteAccount ? <AccountDeleteAction busy={busy} copy={copy} onDelete={onDeleteAccount} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type RecoveryKeyDisplayProps = {
  accountID?: string;
  language: AppLanguage;
  mode?: "initial" | "rotate";
  recoveryKey: string;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => Promise<void>;
  onDeleteAccount?: () => Promise<void>;
};

export function RecoveryKeyDisplay({ accountID, language, mode = "initial", recoveryKey, busy, error, onBack, onConfirm, onDeleteAccount }: RecoveryKeyDisplayProps) {
  const insets = useSafeAreaInsets();
  const copy = COPY[language];
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const rotating = mode === "rotate";

  useEffect(() => {
    setSaved(false);
    setCopied(false);
    setCopyError(false);
  }, [recoveryKey]);

  const copyRecoveryKey = async () => {
    try {
      await Clipboard.setStringAsync(recoveryKey.replace(/\s+/g, ""));
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="arrow-back-ios-new" size={21} />
        </Pressable>
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <MaterialIcons color={YELLOW} name="key" size={58} />
        <Text style={styles.title}>{rotating ? copy.rotateTitle : copy.displayTitle}</Text>
        <Text style={styles.description}>{rotating ? copy.rotateDescription : copy.displayDescription}</Text>
        {accountID ? <SupportAccountID accountID={accountID} language={language} /> : null}
        <View style={styles.recoveryKeyBox}>
          <Text selectable style={styles.recoveryKey}>{formatRecoveryKey(recoveryKey)}</Text>
          <Pressable
            accessibilityLabel={copied ? copy.copied : copy.copyRecoveryKey}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void copyRecoveryKey()}
            style={({ pressed }) => [styles.copyButton, busy && styles.disabled, pressed && styles.pressed]}
          >
            <MaterialIcons color={YELLOW} name={copied ? "check" : "content-copy"} size={20} />
            <Text style={styles.copyButtonText}>{copied ? copy.copied : copy.copyRecoveryKey}</Text>
          </Pressable>
        </View>
        {copyError ? <Text style={styles.errorText}>{copy.copyFailed}</Text> : null}
        <Text style={styles.warning}>{rotating ? copy.rotateWarning : copy.displayWarning}</Text>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: saved }}
          onPress={() => setSaved((current) => !current)}
          style={({ pressed }) => [styles.savedRow, pressed && styles.pressed]}
        >
          <MaterialIcons
            color={saved ? YELLOW : "#b0b0b0"}
            name={saved ? "check-box" : "check-box-outline-blank"}
            size={25}
          />
          <Text style={styles.savedText}>{copy.saved}</Text>
        </Pressable>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !saved}
          onPress={() => void onConfirm()}
          style={({ pressed }) => [
            styles.primaryButton,
            (busy || !saved) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>{rotating ? copy.rotateComplete : copy.complete}</Text>}
        </Pressable>
        {onDeleteAccount ? <AccountDeleteAction busy={busy} copy={copy} onDelete={onDeleteAccount} /> : null}
      </ScrollView>
    </View>
  );
}

function AccountDeleteAction({
  busy,
  copy,
  onDelete,
}: {
  busy: boolean;
  copy: RecoveryCopy;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState(false);

  const closeConfirmation = () => {
    if (busy) return;
    setConfirming(false);
    setConfirmation("");
    setDeleteError(false);
  };

  const confirmDeletion = async () => {
    if (busy || confirmation.trim().toUpperCase() !== "DELETE") return;
    setDeleteError(false);
    try {
      await onDelete();
    } catch {
      setDeleteError(true);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          setConfirmation("");
          setDeleteError(false);
          setConfirming(true);
        }}
        style={({ pressed }) => [styles.deleteButton, busy && styles.disabled, pressed && styles.pressed]}
      >
        <Text style={styles.deleteButtonText}>{copy.deleteAccount}</Text>
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={closeConfirmation}
        transparent
        visible={confirming}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.deletePanel}>
            <Text style={styles.deleteTitle}>{copy.deleteTitle}</Text>
            <Text style={styles.deleteWarning}>{copy.deleteWarning}</Text>
            <Text style={styles.deleteScope}>{copy.deleteScope}</Text>
            <Text style={styles.confirmDeleteInstruction}>{copy.confirmDeleteInstruction}</Text>
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(value) => {
                setConfirmation(value);
                setDeleteError(false);
              }}
              placeholder={copy.confirmDeletePlaceholder}
              placeholderTextColor="#a56d68"
              style={styles.deleteInput}
              value={confirmation}
            />
            {deleteError ? <Text style={styles.errorText}>{copy.deleteError}</Text> : null}
            <View style={styles.deleteActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={closeConfirmation}
          style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
        >
          <Text style={styles.cancelText}>{copy.cancel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy || confirmation.trim().toUpperCase() !== "DELETE"}
          onPress={() => void confirmDeletion()}
          style={({ pressed }) => [
            styles.confirmDeleteButton,
            (busy || confirmation.trim().toUpperCase() !== "DELETE") && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.confirmDeleteText}>{copy.deleteConfirm}</Text>}
        </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function formatRecoveryKey(value: string): string {
  return value.match(/.{1,8}/g)?.join(" ") ?? value;
}

export function SupportAccountID({ accountID, language }: { accountID: string; language: AppLanguage }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = COPY[language];

  const copyAccountID = async () => {
    try {
      await Clipboard.setStringAsync(accountID);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return (
    <View style={styles.accountReference}>
      <Text style={styles.accountReferenceLabel}>{copy.supportAccountID}</Text>
      <View style={styles.accountReferenceRow}>
        <Text selectable style={styles.accountReferenceValue}>{accountID}</Text>
        <Pressable accessibilityRole="button" onPress={() => void copyAccountID()} style={({ pressed }) => [styles.accountReferenceButton, pressed && styles.pressed]}>
          <MaterialIcons color={BLUE} name={copied ? "check" : "content-copy"} size={18} />
          <Text style={styles.accountReferenceButtonText}>{copied ? copy.copied : copy.copyAccountID}</Text>
        </Pressable>
      </View>
      {copyError ? <Text style={styles.errorText}>{copy.copyFailed}</Text> : null}
    </View>
  );
}

export function RecoveryCompletion({
  accountID,
  language,
  mode,
  onContinue,
}: {
  accountID: string;
  language: AppLanguage;
  mode: "initial" | "recovery";
  onContinue: () => void;
}) {
  const insets = useSafeAreaInsets();
  const copy = language === "ja"
    ? {
        title: mode === "initial" ? "暗号鍵の登録が完了しました" : "アカウントの復旧が完了しました",
        description: mode === "initial"
          ? "Recovery Keyを保存し、端末の暗号鍵を登録しました。"
          : "新しい端末の暗号鍵とRecovery Keyを登録しました。",
        continue: "続ける",
      }
    : {
        title: mode === "initial" ? "Encryption keys are ready" : "Account recovery is complete",
        description: mode === "initial"
          ? "Your Recovery Key and device encryption key have been registered."
          : "The new device encryption key and Recovery Key have been registered.",
        continue: "Continue",
      };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.successIcon}>
          <MaterialIcons color="#3d9a68" name="check" size={44} />
        </View>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.description}>{copy.description}</Text>
        <SupportAccountID accountID={accountID} language={language} />
        <Pressable accessibilityRole="button" onPress={onContinue} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>{copy.continue}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  header: {
    minHeight: 104,
    paddingHorizontal: 20,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: BLUE,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  backButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", marginRight: 12 },
  headerTitle: { color: "#ffffff", fontSize: 24, fontWeight: "700" },
  content: { padding: 24, paddingBottom: 48, gap: 18 },
  title: { color: TEXT_GRAY, fontSize: 24, fontWeight: "700" },
  description: { color: MUTED_GRAY, fontSize: 15, lineHeight: 23 },
  accountReference: {
    gap: 5,
    padding: 12,
    borderWidth: 1,
    borderColor: "#d9edf8",
    borderRadius: 10,
    backgroundColor: "#f5fbff",
  },
  accountReferenceLabel: { color: MUTED_GRAY, fontSize: 12, fontWeight: "600" },
  accountReferenceRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8 },
  accountReferenceValue: { flex: 1, color: TEXT_GRAY, fontSize: 13, lineHeight: 19 },
  accountReferenceButton: {
    minHeight: 36,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "#b8dff1",
    borderRadius: 18,
    backgroundColor: "#ffffff",
  },
  accountReferenceButtonText: { color: TEXT_GRAY, fontSize: 12, fontWeight: "700" },
  successIcon: {
    width: 82,
    height: 82,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    borderRadius: 41,
    backgroundColor: "#eef8f2",
  },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 12,
    color: TEXT_GRAY,
    fontSize: 15,
    letterSpacing: 0.4,
  },
  recoveryKey: {
    padding: 18,
    borderRadius: 12,
    backgroundColor: "#fff9e9",
    color: TEXT_GRAY,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 30,
  },
  recoveryKeyBox: {
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fff9e9",
  },
  copyButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 21,
    backgroundColor: "#ffffff",
  },
  copyButtonText: { color: TEXT_GRAY, fontSize: 14, fontWeight: "700" },
  warning: { color: "#9b6b00", fontSize: 14, lineHeight: 21 },
  savedRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  savedText: { flex: 1, color: TEXT_GRAY, fontSize: 15 },
  errorText: { color: "#b42318", fontSize: 14, lineHeight: 20 },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: YELLOW,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  deleteButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d92d20",
    borderRadius: 23,
  },
  deleteButtonText: { color: "#b42318", fontSize: 15, fontWeight: "700" },
  deletePanel: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f3b5af",
    borderRadius: 16,
    backgroundColor: "#fff5f4",
  },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  deleteTitle: { color: "#7a271a", fontSize: 17, fontWeight: "700" },
  deleteWarning: { color: "#7a271a", fontSize: 14, lineHeight: 21 },
  deleteScope: { color: "#7a271a", fontSize: 13, lineHeight: 19, fontWeight: "600" },
  confirmDeleteInstruction: { color: "#7a271a", fontSize: 13, lineHeight: 19 },
  deleteInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#d69289",
    borderRadius: 10,
    color: "#7a271a",
    backgroundColor: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1,
  },
  deleteActions: { gap: 10 },
  cancelButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 22,
    backgroundColor: "#ffffff",
  },
  cancelText: { color: TEXT_GRAY, fontSize: 15, fontWeight: "600" },
  confirmDeleteButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: "#d92d20",
  },
  confirmDeleteText: { color: "#ffffff", fontSize: 14, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
