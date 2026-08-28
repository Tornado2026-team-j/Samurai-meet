import { useEffect, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RecoveryCompletion, RecoveryKeyDisplay } from "../components/RecoveryFlow";
import { useAuth } from "../hooks/useAuth";
import {
  completeRecoveryKeyRotation,
  loadStoredDeviceKeyB,
  prepareRecoveryKeyRotation,
  type DeviceKeyMaterial,
  type GeneratedKeyMaterial,
  type RecoveryRotationStage,
} from "../services/key-management";
import { resetDeviceLocalData } from "../services/device-reset";
import { toBase64URL } from "../services/crypto";
import type { Session } from "../services/auth-contract";
import {
  loadLanguage,
  loadLocalProfile,
} from "../services/onboarding";
import type {
  AppLanguage,
  LocalProfile,
} from "../services/onboarding-contract";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#7d7d7d";
const BORDER_GRAY = "#d4d4d4";

const COPY = {
  ja: {
    title: "プロフィール",
    loading: "プロフィールを読み込んでいます…",
    name: "名前",
    nationality: "国籍",
    bio: "自己紹介",
    notSet: "未設定",
    myRecruitments: "自分の募集を管理",
    myRecruitmentsDescription: "公開中・下書き・終了した募集と応募者を確認できます。",
    myApplications: "応募履歴",
    myApplicationsDescription: "自分が送った応募と結果を確認できます。",
    logout: "ログアウト",
    loggingOut: "ログアウト中…",
    authError: "ログアウトに失敗しました。もう一度お試しください。",
    deleteAccount: "アカウント削除",
    deleteTitle: "アカウントを削除しますか？",
    deleteWarning: "この操作は取り消せません。削除後はログイン・復旧・保存データの返却ができません。",
    deleteScope: "削除対象: アカウント、全セッション、端末鍵、暗号化データ",
    deleteConfirmation: "削除",
    confirmDeleteInstruction: "誤操作防止のため「削除」と入力してください。",
    confirmDeletePlaceholder: "削除 と入力",
    deleteContinue: "Passkeyで再認証して削除",
    deleting: "アカウントを削除中…",
    cancel: "キャンセル",
    deleteError: "アカウント削除に失敗しました。Passkey再認証後にもう一度お試しください。",
    accountId: "アカウントID（問い合わせ用）",
    deviceId: "この端末のデバイスID",
    securityInfoTitle: "問い合わせ・端末情報",
    securityInfoDescription: "サポートへ連絡する際はアカウントIDとデバイスIDを伝えてください。Key-Bはこの端末だけで使う秘密鍵です。",
    copy: "コピー",
    copied: "コピーしました",
    copyFailed: "コピーに失敗しました。選択して手動でコピーしてください。",
    deviceKeyB: "端末固有Key-B",
    deviceKeyBMasked: "••••••••••••••••••••••••••••••••",
    showDeviceKeyB: "PasskeyでKey-Bを表示",
    hideDeviceKeyB: "Key-Bを隠す",
    deviceKeyBWarning: "Key-Bは画像鍵を守る秘密情報です。表示・コピーした値を他人へ渡さないでください。",
    deviceKeyBUnavailable: "この端末にKey-Bがありません。再認証して端末登録をやり直してください。",
    deviceKeyBRevealError: "Key-Bを表示できませんでした。Passkey再認証後にもう一度お試しください。",
    deviceInfoLoading: "端末情報を読み込んでいます…",
    regenerateRecoveryKey: "Recovery Phraseを再生成",
    recoveryDescription: "Recovery Phraseを紛失した場合や、一度使った後はここから新しいPhraseへ更新できます。既存データの暗号鍵は変わりません。",
    recoveryStageReauthenticating: "Passkeyで本人確認中…",
    recoveryStageKeyA: "端末の暗号鍵を確認中…",
    recoveryStageEnvelope: "サーバーの暗号鍵情報を確認中…",
    recoveryStageGenerating: "新しいRecovery Phraseを生成中…",
    recoveryStageSaving: "新しいRecovery Phraseを登録中…",
    recoveryError: "Recovery Phraseの再生成に失敗しました。Passkey再認証後にもう一度お試しください。",
    resetDeviceData: "この端末のデータを初期化",
    resetDeviceTitle: "この端末を初期化しますか？",
    resetDeviceWarning: "この端末に保存されている暗号鍵、端末ID、Recovery Phrase、ログイン情報、プロフィールのローカルデータを削除します。",
    resetDeviceScope: "サーバー上のアカウント・暗号化画像・メッセージは削除しません。再利用にはRecovery Phraseまたは旧端末からの移行が必要です。",
    resetDeviceInstruction: "確認のため「初期化」と入力してください。",
    resetDevicePlaceholder: "初期化 と入力",
    resetDeviceConfirm: "端末データを初期化",
    resettingDevice: "端末データを初期化中…",
    resetDeviceError: "端末データの初期化に失敗しました。もう一度お試しください。",
  },
  en: {
    title: "Profile",
    loading: "Loading profile…",
    name: "Name",
    nationality: "Nationality",
    bio: "Bio",
    notSet: "Not set",
    myRecruitments: "Manage my recruitments",
    myRecruitmentsDescription: "Review your open, draft, and closed recruitments and applicants.",
    myApplications: "Application history",
    myApplicationsDescription: "Review the applications you sent and their results.",
    logout: "Log out",
    loggingOut: "Logging out…",
    authError: "Log out failed. Please try again.",
    deleteAccount: "Delete account",
    deleteTitle: "Delete this account?",
    deleteWarning: "This cannot be undone. You will lose access to the account, recovery, and stored data.",
    deleteScope: "This deletes your account, all sessions, device keys, and encrypted data.",
    deleteConfirmation: "DELETE",
    confirmDeleteInstruction: "Type DELETE to prevent accidental deletion.",
    confirmDeletePlaceholder: "Type DELETE",
    deleteContinue: "Re-authenticate with Passkey and delete",
    deleting: "Deleting account…",
    cancel: "Cancel",
    deleteError: "Account deletion failed. Please re-authenticate with Passkey and try again.",
    accountId: "Account ID (for support)",
    deviceId: "This device's ID",
    securityInfoTitle: "Support and device information",
    securityInfoDescription: "Give support your account ID and device ID. Key-B is a device-only secret used to protect image keys.",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed. Select the value and copy it manually.",
    deviceKeyB: "Device-specific Key-B",
    deviceKeyBMasked: "••••••••••••••••••••••••••••••••",
    showDeviceKeyB: "Show Key-B with Passkey",
    hideDeviceKeyB: "Hide Key-B",
    deviceKeyBWarning: "Key-B is a secret that protects image keys. Do not share a displayed or copied value.",
    deviceKeyBUnavailable: "Key-B is not available on this device. Re-authenticate and register this device again.",
    deviceKeyBRevealError: "Key-B could not be displayed. Re-authenticate with Passkey and try again.",
    deviceInfoLoading: "Loading device information…",
    regenerateRecoveryKey: "Regenerate Recovery Phrase",
    recoveryDescription: "If you lost the phrase or already used it, you can replace it here. Your existing data-encryption key stays unchanged.",
    recoveryStageReauthenticating: "Confirming your identity with Passkey…",
    recoveryStageKeyA: "Checking this device's encryption key…",
    recoveryStageEnvelope: "Checking the server's key envelope…",
    recoveryStageGenerating: "Generating a new Recovery Phrase…",
    recoveryStageSaving: "Registering the new Recovery Phrase…",
    recoveryError: "Recovery Phrase regeneration failed. Re-authenticate with Passkey and try again.",
    resetDeviceData: "Reset this device",
    resetDeviceTitle: "Reset this device?",
    resetDeviceWarning: "This removes the encryption keys, device ID, Recovery Phrase, login data, and locally stored profile data from this device.",
    resetDeviceScope: "Your server account, encrypted photos, and messages are not deleted. You need the Recovery Phrase or an old-device transfer to use this account again.",
    resetDeviceInstruction: "Type RESET to confirm.",
    resetDevicePlaceholder: "Type RESET",
    resetDeviceConfirm: "Reset device data",
    resettingDevice: "Resetting device data…",
    resetDeviceError: "Device data could not be reset. Please try again.",
  },
} as const;

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { continuePasskey, deleteAccount, error, getCurrentSession, logout, session, status } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [showDeviceReset, setShowDeviceReset] = useState(false);
  const [deviceResetConfirmation, setDeviceResetConfirmation] = useState("");
  const [resettingDevice, setResettingDevice] = useState(false);
  const [deviceResetFailed, setDeviceResetFailed] = useState(false);
  const [deviceKeyMaterial, setDeviceKeyMaterial] = useState<DeviceKeyMaterial | null>(null);
  const [deviceInfoLoading, setDeviceInfoLoading] = useState(true);
  const [showDeviceKeyB, setShowDeviceKeyB] = useState(false);
  const [deviceKeyBusy, setDeviceKeyBusy] = useState(false);
  const [deviceInfoError, setDeviceInfoError] = useState<string | null>(null);
  const [recoveryMaterial, setRecoveryMaterial] = useState<GeneratedKeyMaterial | null>(null);
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const [recoveryPreparing, setRecoveryPreparing] = useState(false);
  const [recoveryStage, setRecoveryStage] = useState<RecoveryRotationStage | "reauthenticating" | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const recoverySessionRef = useRef<Session | null>(null);
  const recoveryOperationRef = useRef(0);
  const copy = COPY[language];
  const expectedDeleteConfirmation = copy.deleteConfirmation;
  const expectedDeviceResetConfirmation = language === "ja" ? "初期化" : "RESET";

  useEffect(() => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      return;
    }

    let active = true;
    setProfileLoaded(false);
    void Promise.all([
      loadLanguage(),
      loadLocalProfile(activeSession.user_id),
    ]).then(([storedLanguage, storedProfile]) => {
      if (!active) return;
      setLanguage(storedLanguage ?? "ja");
      setProfile(storedProfile);
      setProfileLoaded(true);
    }).catch(() => {
      if (active) setProfileLoaded(true);
    });

    return () => {
      active = false;
    };
  }, [router, session?.session_id, session?.user_id]);

  useEffect(() => {
    const userID = session?.user_id;
    if (!userID) {
      setDeviceKeyMaterial(null);
      setDeviceInfoLoading(false);
      setShowDeviceKeyB(false);
      return;
    }

    let active = true;
    setDeviceInfoLoading(true);
    setDeviceInfoError(null);
    void loadStoredDeviceKeyB(userID).then((material) => {
      if (active) setDeviceKeyMaterial(material);
    }).catch(() => {
      if (active) {
        setDeviceKeyMaterial(null);
        setDeviceInfoError(copy.deviceKeyBUnavailable);
      }
    }).finally(() => {
      if (active) setDeviceInfoLoading(false);
    });
    return () => {
      active = false;
    };
  }, [copy.deviceKeyBUnavailable, session?.user_id]);

  useEffect(() => {
    if (status === "signed_out") router.replace("/");
  }, [router, status]);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    router.replace("/");
    setLoggingOut(false);
  };

  const handlePrepareRecoveryKey = async () => {
    if (recoveryPreparing || recoveryMaterial || !session) return;
    const rotationSession = sessionRef.current;
    if (!rotationSession) return;
    const operationID = recoveryOperationRef.current + 1;
    recoveryOperationRef.current = operationID;
    const isCurrentOperation = () => recoveryOperationRef.current === operationID;

    setRecoveryPreparing(true);
    setRecoveryStage("reauthenticating");
    setRecoveryError(null);
    try {
      const reauthenticated = await continuePasskey(language);
      if (!reauthenticated) throw new Error(copy.recoveryError);

      const authenticatedSession = getCurrentSession() ?? rotationSession;
      const material = await prepareRecoveryKeyRotation(
        authenticatedSession,
        (stage) => {
          if (isCurrentOperation()) setRecoveryStage(stage);
        },
      );
      if (!isCurrentOperation()) return;
      recoverySessionRef.current = authenticatedSession;
      setRecoveryError(null);
      setRecoveryMaterial(material);
    } catch (reason) {
      if (!isCurrentOperation()) return;
      const message = reason instanceof Error ? reason.message : "";
      setRecoveryError(message === "通信がタイムアウトしました。接続を確認して再試行してください。"
        ? message
        : copy.recoveryError);
    } finally {
      if (isCurrentOperation()) {
        setRecoveryPreparing(false);
        setRecoveryStage(null);
      }
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteFailed(false);
    try {
      const reauthenticated = await continuePasskey(language);
      if (!reauthenticated) {
        throw new Error(copy.deleteError);
      }
      const deleted = await deleteAccount();
      if (!deleted) {
        throw new Error(copy.deleteError);
      }
      router.replace("/");
    } catch {
      setDeleteFailed(true);
      setDeleting(false);
    }
  };

  const revealDeviceKeyB = async () => {
    if (!deviceKeyMaterial || deviceKeyBusy) return;
    if (showDeviceKeyB) {
      setShowDeviceKeyB(false);
      return;
    }
    setDeviceKeyBusy(true);
    setDeviceInfoError(null);
    try {
      const reauthenticated = await continuePasskey(language);
      if (!reauthenticated) throw new Error(copy.deviceKeyBRevealError);
      setShowDeviceKeyB(true);
    } catch {
      setDeviceInfoError(copy.deviceKeyBRevealError);
    } finally {
      setDeviceKeyBusy(false);
    }
  };

  const handleResetDevice = async () => {
    if (!session || resettingDevice || deviceResetConfirmation.trim().toUpperCase() !== expectedDeviceResetConfirmation) return;
	setResettingDevice(true);
	setDeviceResetFailed(false);
	try {
		// Revoke the server session first while the access/refresh material is
		// still available. Local deletion must still run if the network is down.
		const userID = session.user_id;
		try {
			await logout();
		} finally {
			await resetDeviceLocalData(userID);
		}
		setDeviceKeyMaterial(null);
		setShowDeviceKeyB(false);
		setShowDeviceReset(false);
      setDeviceResetConfirmation("");
      // Keep the server account and ciphertext. The next start must go
      // through Recovery Phrase or old-device transfer before data access.
		router.replace("/");
    } catch {
      setDeviceResetFailed(true);
    } finally {
      setResettingDevice(false);
    }
  };

  useEffect(() => {
    if (session) return;
    recoveryOperationRef.current += 1;
    recoverySessionRef.current = null;
    setRecoveryMaterial(null);
    setRecoveryComplete(false);
    setRecoveryPreparing(false);
    setRecoveryStage(null);
  }, [session]);

  if (session && recoveryMaterial) {
    return (
      <RecoveryKeyDisplay
        busy={recoveryPreparing}
        error={recoveryError}
        language={language}
        mode="rotate"
        onBack={() => {
          setRecoveryError(null);
          setRecoveryMaterial(null);
          recoverySessionRef.current = null;
        }}
        onConfirm={async () => {
          const rotationSession = recoverySessionRef.current;
          if (!rotationSession) {
            setRecoveryError(copy.recoveryError);
            return;
          }
          setRecoveryPreparing(true);
          setRecoveryStage("saving");
          setRecoveryError(null);
          try {
            await completeRecoveryKeyRotation(rotationSession, recoveryMaterial, setRecoveryStage);
            setRecoveryMaterial(null);
            recoverySessionRef.current = null;
            setRecoveryComplete(true);
          } catch {
            setRecoveryError(copy.recoveryError);
          } finally {
            setRecoveryPreparing(false);
            setRecoveryStage(null);
          }
        }}
        recoveryKey={recoveryMaterial.recoveryKey}
      />
    );
  }

  if (session && recoveryComplete) {
    return (
      <RecoveryCompletion
        accountID={session.user_id}
        language={language}
        mode="recovery"
        onContinue={() => setRecoveryComplete(false)}
      />
    );
  }

  if (!session || !profileLoaded) {
    return (
      <View style={[styles.loadingScreen, { paddingTop: Math.max(insets.top, 20) }]}>
        <StatusBar style="dark" />
        <ActivityIndicator color={BLUE} size="large" />
        <Text style={styles.loadingText}>{copy.loading}</Text>
      </View>
    );
  }

  const displayedProfile = profile ?? {
    name: "",
    nationalityCode: "",
    bio: "",
    completed: false,
    identityVerificationChoice: null,
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <Pressable
          accessibilityLabel={language === "ja" ? "戻る" : "Back"}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="arrow-back-ios-new" size={21} />
        </Pressable>
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <ScrollView
        style={styles.profileScrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.avatar}>
          <MaterialIcons color={BLUE} name="person" size={54} />
        </View>

        <ProfileRow label={copy.name} value={displayedProfile.name || copy.notSet} />
        <ProfileRow
          label={copy.nationality}
          value={displayedProfile.nationalityCode || copy.notSet}
        />
        <ProfileRow
          label={copy.bio}
          value={displayedProfile.bio || copy.notSet}
          multiline
        />

        <View style={styles.managementSection}>
          <Text style={styles.managementTitle}>{copy.myRecruitments}</Text>
          <Text style={styles.managementDescription}>{copy.myRecruitmentsDescription}</Text>
          <Pressable
            accessibilityLabel={copy.myRecruitments}
            accessibilityRole="button"
            disabled={loggingOut || deleting || recoveryPreparing}
            onPress={() => router.push("/recruitments/mine")}
            style={({ pressed }) => [
              styles.managementButton,
              pressed && !loggingOut && !deleting && !recoveryPreparing && styles.pressed,
              (loggingOut || deleting || recoveryPreparing) && styles.disabledButton,
            ]}
          >
            <Text style={styles.managementButtonText}>{copy.myRecruitments}</Text>
            <MaterialIcons color={BLUE} name="chevron-right" size={21} />
          </Pressable>
          <Text style={styles.managementDescription}>{copy.myApplicationsDescription}</Text>
          <Pressable
            accessibilityLabel={copy.myApplications}
            accessibilityRole="button"
            disabled={loggingOut || deleting || recoveryPreparing}
            onPress={() => router.push({
              pathname: "/japanese/applications",
              params: { language },
            })}
            style={({ pressed }) => [
              styles.managementButton,
              pressed && !loggingOut && !deleting && !recoveryPreparing && styles.pressed,
              (loggingOut || deleting || recoveryPreparing) && styles.disabledButton,
            ]}
          >
            <Text style={styles.managementButtonText}>{copy.myApplications}</Text>
            <MaterialIcons color={BLUE} name="chevron-right" size={21} />
          </Pressable>
        </View>

        <View style={styles.recoverySection}>
          <Text style={styles.recoverySectionTitle}>{copy.regenerateRecoveryKey}</Text>
          <Text style={styles.recoveryDescription}>{copy.recoveryDescription}</Text>
          <Pressable
            accessibilityLabel={copy.regenerateRecoveryKey}
            accessibilityRole="button"
            disabled={loggingOut || deleting || recoveryPreparing}
            onPress={() => void handlePrepareRecoveryKey()}
            style={({ pressed }) => [
              styles.recoveryButton,
              pressed && !loggingOut && !deleting && !recoveryPreparing && styles.pressed,
              (loggingOut || deleting || recoveryPreparing) && styles.disabledButton,
            ]}
          >
            {recoveryPreparing ? (
              <ActivityIndicator color={YELLOW} />
            ) : (
              <Text style={styles.recoveryButtonText}>{copy.regenerateRecoveryKey}</Text>
            )}
          </Pressable>
          {recoveryPreparing && recoveryStage ? (
            <Text style={styles.recoveryProgressText}>
              {recoveryStage === "reauthenticating"
                ? copy.recoveryStageReauthenticating
                : recoveryStage === "loading_key_a"
                  ? copy.recoveryStageKeyA
                  : recoveryStage === "loading_envelope"
                    ? copy.recoveryStageEnvelope
                    : recoveryStage === "generating"
                      ? copy.recoveryStageGenerating
                      : copy.recoveryStageSaving}
            </Text>
          ) : null}
          {recoveryError ? <Text style={styles.errorText}>{recoveryError}</Text> : null}
        </View>

        <View style={styles.securityInfoSection}>
          <Text style={styles.securityInfoTitle}>{copy.securityInfoTitle}</Text>
          <Text style={styles.securityInfoDescription}>{copy.securityInfoDescription}</Text>
          <CopyableInfoRow label={copy.accountId} value={session.user_id} copyLabel={copy.copy} copiedLabel={copy.copied} errorLabel={copy.copyFailed} />
          <CopyableInfoRow
            label={copy.deviceId}
            value={deviceKeyMaterial?.deviceID ?? copy.deviceKeyBUnavailable}
            copyLabel={copy.copy}
            copiedLabel={copy.copied}
            errorLabel={copy.copyFailed}
          />
          {deviceInfoLoading ? (
            <Text style={styles.securityInfoMuted}>{copy.deviceInfoLoading}</Text>
          ) : deviceKeyMaterial ? (
            <View style={styles.deviceSecretBlock}>
              <Text style={styles.securityInfoLabel}>{copy.deviceKeyB}</Text>
              <Text style={styles.deviceSecretWarning}>{copy.deviceKeyBWarning}</Text>
              <Text selectable={showDeviceKeyB} style={styles.deviceSecretValue}>
                {showDeviceKeyB ? toBase64URL(deviceKeyMaterial.keyB) : copy.deviceKeyBMasked}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={deviceKeyBusy}
                onPress={() => void revealDeviceKeyB()}
                style={({ pressed }) => [styles.deviceSecretButton, deviceKeyBusy && styles.disabledButton, pressed && styles.pressed]}
              >
                {deviceKeyBusy ? (
                  <ActivityIndicator color={TEXT_GRAY} />
                ) : (
                  <Text style={styles.deviceSecretButtonText}>{showDeviceKeyB ? copy.hideDeviceKeyB : copy.showDeviceKeyB}</Text>
                )}
              </Pressable>
              {showDeviceKeyB ? (
                <CopyableInfoRow
                  label=""
                  value={toBase64URL(deviceKeyMaterial.keyB)}
                  copyLabel={copy.copy}
                  copiedLabel={copy.copied}
                  errorLabel={copy.copyFailed}
                  compact
                  hideValue
                />
              ) : null}
            </View>
          ) : (
            <Text style={styles.errorText}>{deviceInfoError ?? copy.deviceKeyBUnavailable}</Text>
          )}
          {deviceInfoError && deviceKeyMaterial ? <Text style={styles.errorText}>{deviceInfoError}</Text> : null}
          <Pressable
            accessibilityLabel={copy.resetDeviceData}
            accessibilityRole="button"
            disabled={loggingOut || deleting || recoveryPreparing || resettingDevice}
            onPress={() => {
              setDeviceResetConfirmation("");
              setDeviceResetFailed(false);
              setShowDeviceReset(true);
            }}
            style={({ pressed }) => [
              styles.resetDeviceButton,
              pressed && !resettingDevice && styles.pressed,
              (loggingOut || deleting || recoveryPreparing || resettingDevice) && styles.disabledButton,
            ]}
          >
            <Text style={styles.resetDeviceButtonText}>{copy.resetDeviceData}</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.errorText}>{copy.authError}</Text>}

        <Pressable
          accessibilityLabel={copy.logout}
          accessibilityRole="button"
          disabled={loggingOut}
          onPress={() => void handleLogout()}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && !loggingOut && styles.pressed,
            loggingOut && styles.disabledButton,
          ]}
        >
          {loggingOut ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.logoutText}>{copy.logout}</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityLabel={copy.deleteAccount}
          accessibilityRole="button"
          disabled={loggingOut || deleting || recoveryPreparing}
          onPress={() => {
            setDeleteFailed(false);
            setDeleteConfirmation("");
            setShowDeleteConfirmation(true);
          }}
          style={({ pressed }) => [
            styles.deleteButton,
            pressed && !loggingOut && !deleting && styles.pressed,
            (loggingOut || deleting || recoveryPreparing) && styles.disabledButton,
          ]}
        >
          <Text style={styles.deleteButtonText}>{copy.deleteAccount}</Text>
        </Pressable>

        <Modal
          animationType="fade"
          onRequestClose={() => {
            if (!deleting) setShowDeleteConfirmation(false);
          }}
          transparent
          visible={showDeleteConfirmation}
        >
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.modalBackdrop}
            keyboardShouldPersistTaps="handled"
            style={styles.modalScrollView}
          >
            <View style={styles.deletePanel}>
              <Text style={styles.deleteTitle}>{copy.deleteTitle}</Text>
              <Text style={styles.deleteDescription}>{copy.deleteWarning}</Text>
              <Text style={styles.deleteScope}>{copy.deleteScope}</Text>
              <Text style={styles.confirmDeleteInstruction}>{copy.confirmDeleteInstruction}</Text>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!deleting}
                onChangeText={(value) => {
                  setDeleteConfirmation(value);
                  setDeleteFailed(false);
                }}
                placeholder={copy.confirmDeletePlaceholder}
                placeholderTextColor="#a56d68"
                style={styles.deleteInput}
                value={deleteConfirmation}
              />
              {deleteFailed && <Text style={styles.errorText}>{copy.deleteError}</Text>}
              <View style={styles.deleteActions}>
                <Pressable
                  accessibilityLabel={copy.cancel}
                  accessibilityRole="button"
                  disabled={deleting}
                  onPress={() => {
                    setDeleteConfirmation("");
                    setShowDeleteConfirmation(false);
                  }}
                  style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                >
                  <Text style={styles.cancelText}>{copy.cancel}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={copy.deleteContinue}
                  accessibilityRole="button"
                  disabled={deleting || deleteConfirmation.trim().toUpperCase() !== expectedDeleteConfirmation}
                  onPress={() => void handleDeleteAccount()}
                  style={({ pressed }) => [
                    styles.confirmDeleteButton,
                    (deleting || deleteConfirmation.trim().toUpperCase() !== expectedDeleteConfirmation) && styles.disabledButton,
                    pressed && !deleting && styles.pressed,
                  ]}
                >
                  {deleting ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.confirmDeleteText}>{copy.deleteContinue}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </Modal>

        <Modal
          animationType="fade"
          onRequestClose={() => {
            if (!resettingDevice) setShowDeviceReset(false);
          }}
          transparent
          visible={showDeviceReset}
        >
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.modalBackdrop}
            keyboardShouldPersistTaps="handled"
            style={styles.modalScrollView}
          >
            <View style={styles.resetDevicePanel}>
              <Text style={styles.resetDeviceTitle}>{copy.resetDeviceTitle}</Text>
              <Text style={styles.resetDeviceDescription}>{copy.resetDeviceWarning}</Text>
              <Text style={styles.resetDeviceScope}>{copy.resetDeviceScope}</Text>
              <Text style={styles.resetDeviceInstruction}>{copy.resetDeviceInstruction}</Text>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!resettingDevice}
                onChangeText={(value) => {
                  setDeviceResetConfirmation(value);
                  setDeviceResetFailed(false);
                }}
                placeholder={copy.resetDevicePlaceholder}
                placeholderTextColor="#7a5a00"
                style={styles.resetDeviceInput}
                value={deviceResetConfirmation}
              />
              {deviceResetFailed ? <Text style={styles.errorText}>{copy.resetDeviceError}</Text> : null}
              <View style={styles.deleteActions}>
                <Pressable
                  accessibilityLabel={copy.cancel}
                  accessibilityRole="button"
                  disabled={resettingDevice}
                  onPress={() => {
                    setDeviceResetConfirmation("");
                    setShowDeviceReset(false);
                  }}
                  style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                >
                  <Text style={styles.cancelText}>{copy.cancel}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={copy.resetDeviceConfirm}
                  accessibilityRole="button"
                  disabled={resettingDevice || deviceResetConfirmation.trim().toUpperCase() !== expectedDeviceResetConfirmation}
                  onPress={() => void handleResetDevice()}
                  style={({ pressed }) => [
                    styles.resetDeviceConfirmButton,
                    (resettingDevice || deviceResetConfirmation.trim().toUpperCase() !== expectedDeviceResetConfirmation) && styles.disabledButton,
                    pressed && !resettingDevice && styles.pressed,
                  ]}
                >
                  {resettingDevice ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.resetDeviceConfirmText}>{copy.resetDeviceConfirm}</Text>}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </Modal>
      </ScrollView>
    </View>
  );
}

function CopyableInfoRow({
  compact = false,
  copyLabel,
  copiedLabel,
  errorLabel,
  hideValue = false,
  label,
  value,
}: {
  compact?: boolean;
  copyLabel: string;
  copiedLabel: string;
  errorLabel: string;
  hideValue?: boolean;
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copyValue = async () => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <View style={[styles.copyableInfoRow, compact && styles.compactCopyableInfoRow]}>
      {label ? <Text style={styles.securityInfoLabel}>{label}</Text> : null}
      <View
        style={[
          styles.copyableInfoValueRow,
          compact && styles.compactCopyableInfoValueRow,
        ]}
      >
        {!hideValue ? <Text selectable style={styles.copyableInfoValue}>{value}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => void copyValue()}
          style={({ pressed }) => [styles.copyableInfoButton, pressed && styles.pressed]}
        >
          <MaterialIcons color={BLUE} name={copied ? "check" : "content-copy"} size={18} />
          <Text style={styles.copyableInfoButtonText}>{copied ? copiedLabel : copyLabel}</Text>
        </Pressable>
      </View>
      {copyFailed ? <Text style={styles.errorText}>{errorLabel}</Text> : null}
    </View>
  );
}

function ProfileRow({
  label,
  multiline = false,
  value,
}: {
  label: string;
  multiline?: boolean;
  value: string;
}) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, multiline && styles.multilineValue]}>{value}</Text>
    </View>
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
    backgroundColor: "#ffffff",
    gap: 14,
  },
  loadingText: {
    color: MUTED_GRAY,
    fontSize: 15,
  },
  header: {
    minHeight: 104,
    paddingHorizontal: 20,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "flex-end",
    zIndex: 10,
    elevation: 4,
    backgroundColor: BLUE,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  backButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "700",
  },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 16,
  },
  profileScrollView: {
    flex: 1,
  },
  avatar: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 8,
    borderRadius: 48,
    backgroundColor: "#eaf8ff",
  },
  profileRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_GRAY,
  },
  recoverySection: {
    gap: 10,
    marginTop: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f0d28b",
    borderRadius: 16,
    backgroundColor: "#fffaf0",
  },
  managementSection: {
    gap: 10,
    marginTop: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: "#cfe9f7",
    borderRadius: 16,
    backgroundColor: "#f5fbff",
  },
  managementTitle: {
    color: TEXT_GRAY,
    fontSize: 17,
    fontWeight: "700",
  },
  managementDescription: {
    color: MUTED_GRAY,
    fontSize: 14,
    lineHeight: 21,
  },
  managementButton: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#b8dff1",
    borderRadius: 23,
    backgroundColor: "#ffffff",
  },
  managementButtonText: {
    color: BLUE,
    fontSize: 15,
    fontWeight: "700",
  },
  recoverySectionTitle: {
    color: TEXT_GRAY,
    fontSize: 17,
    fontWeight: "700",
  },
  recoveryDescription: {
    color: MUTED_GRAY,
    fontSize: 14,
    lineHeight: 21,
  },
  recoveryButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 23,
    backgroundColor: "#ffffff",
  },
  recoveryButtonText: {
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "700",
  },
  recoveryProgressText: {
    color: MUTED_GRAY,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  securityInfoSection: {
    gap: 10,
    marginTop: 4,
    padding: 16,
    borderWidth: 1,
    borderColor: "#cfe9f7",
    borderRadius: 16,
    backgroundColor: "#f5fbff",
  },
  securityInfoTitle: {
    color: TEXT_GRAY,
    fontSize: 17,
    fontWeight: "700",
  },
  securityInfoDescription: {
    color: MUTED_GRAY,
    fontSize: 14,
    lineHeight: 21,
  },
  securityInfoLabel: {
    color: MUTED_GRAY,
    fontSize: 13,
    fontWeight: "600",
  },
  securityInfoMuted: {
    color: MUTED_GRAY,
    fontSize: 13,
  },
  copyableInfoRow: {
    gap: 5,
  },
  compactCopyableInfoRow: {
    paddingTop: 2,
  },
  copyableInfoValueRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  compactCopyableInfoValueRow: {
    justifyContent: "flex-end",
  },
  copyableInfoValue: {
    flex: 1,
    color: TEXT_GRAY,
    fontSize: 13,
    lineHeight: 19,
  },
  copyableInfoButton: {
    minHeight: 38,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#b8dff1",
    borderRadius: 19,
    backgroundColor: "#ffffff",
  },
  copyableInfoButtonText: {
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
  },
  deviceSecretBlock: {
    gap: 8,
    paddingTop: 4,
  },
  deviceSecretWarning: {
    color: "#7a5a00",
    fontSize: 13,
    lineHeight: 19,
  },
  deviceSecretValue: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  deviceSecretButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 22,
    backgroundColor: "#ffffff",
  },
  deviceSecretButtonText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
  },
  resetDeviceButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 22,
    backgroundColor: "#fffaf0",
  },
  resetDeviceButtonText: {
    color: "#7a5a00",
    fontSize: 14,
    fontWeight: "700",
  },
  rowLabel: {
    marginBottom: 5,
    color: MUTED_GRAY,
    fontSize: 13,
    fontWeight: "600",
  },
  rowValue: {
    color: TEXT_GRAY,
    fontSize: 17,
  },
  multilineValue: {
    lineHeight: 24,
  },
  errorText: {
    color: "#b42318",
    fontSize: 14,
    lineHeight: 20,
  },
  logoutButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    borderRadius: 25,
    backgroundColor: YELLOW,
  },
  disabledButton: {
    opacity: 0.65,
  },
  logoutText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  deleteButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#d92d20",
    borderRadius: 24,
  },
  deleteButtonText: {
    color: "#b42318",
    fontSize: 15,
    fontWeight: "700",
  },
  deletePanel: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f3b5af",
    borderRadius: 16,
    backgroundColor: "#fff5f4",
  },
  resetDevicePanel: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f0d28b",
    borderRadius: 16,
    backgroundColor: "#fffaf0",
  },
  modalBackdrop: {
    flexGrow: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  modalScrollView: {
    flex: 1,
    width: "100%",
  },
  deleteTitle: {
    color: "#7a271a",
    fontSize: 17,
    fontWeight: "700",
  },
  deleteDescription: {
    color: "#7a271a",
    fontSize: 14,
    lineHeight: 21,
  },
  deleteScope: {
    color: "#7a271a",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  confirmDeleteInstruction: {
    color: "#7a271a",
    fontSize: 13,
    lineHeight: 19,
  },
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
  resetDeviceTitle: {
    color: "#7a5a00",
    fontSize: 17,
    fontWeight: "700",
  },
  resetDeviceDescription: {
    color: "#7a5a00",
    fontSize: 14,
    lineHeight: 21,
  },
  resetDeviceScope: {
    color: "#7a5a00",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  resetDeviceInstruction: {
    color: "#7a5a00",
    fontSize: 13,
    lineHeight: 19,
  },
  resetDeviceInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#d8b462",
    borderRadius: 10,
    color: "#7a5a00",
    backgroundColor: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1,
  },
  deleteActions: {
    gap: 10,
  },
  cancelButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 22,
    backgroundColor: "#ffffff",
  },
  cancelText: {
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "600",
  },
  confirmDeleteButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: "#d92d20",
  },
  confirmDeleteText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  resetDeviceConfirmButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: YELLOW,
  },
  resetDeviceConfirmText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});
