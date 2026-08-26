import { useEffect, useRef, useState, type ReactNode } from "react";
import { FontAwesome, MaterialIcons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import IdentityVerificationPrompt from "../components/IdentityVerificationPrompt";
import ProfileForm from "../components/ProfileForm";
import { RecoveryCompletion, RecoveryKeyDisplay, RecoveryKeyInput, SupportAccountID } from "../components/RecoveryFlow";
import { useAuth } from "../hooks/useAuth";
import {
  completeInitialKeySetup,
  completeRecoveryKeyRotation,
  createInitialKeyMaterial,
  ensureDeviceKeyB,
  listKeyEnvelopes,
  loadStoredKeyA,
  recoverWithSession,
  type GeneratedKeyMaterial,
} from "../services/key-management";
import { createRecoveryKeyMaterial, deriveDataKey, type KeyEnvelope } from "../services/crypto";
import {
  clearLanguage,
  loadLanguage,
  loadLocalProfile,
  saveLanguage,
  saveLocalProfile,
  type AppLanguage,
  type LocalProfile,
} from "../services/onboarding";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#7d7d7d";
const BORDER_GRAY = "#d4d4d4";

type ProgressProps = {
  activeStep: 1 | 2 | 3;
  language: AppLanguage;
};

function Progress({ activeStep, language }: ProgressProps) {
  return (
    <View
      accessibilityLabel={language === "ja" ? `全3ステップ中${activeStep}` : `Step ${activeStep} of 3`}
      style={styles.progress}
    >
      {[1, 2, 3].map((step) => (
        <View
          key={step}
          style={[styles.progressDot, step === activeStep && styles.progressDotActive]}
        />
      ))}
    </View>
  );
}

type HeroProps = {
  children: ReactNode;
  compact?: boolean;
  onBack?: () => void;
};

function Hero({ children, compact = false, onBack }: HeroProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.hero,
        compact ? styles.heroCompact : styles.heroDefault,
        { paddingTop: Math.max(insets.top, 20) },
      ]}
    >
      {onBack ? (
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="arrow-back-ios-new" size={21} />
        </Pressable>
      ) : null}
      {children}
    </View>
  );
}

type LanguageStepProps = {
  onContinue: (language: AppLanguage) => Promise<void>;
};

function LanguageStep({ onContinue }: LanguageStepProps) {
  const [selection, setSelection] = useState<AppLanguage>("ja");
  const [saving, setSaving] = useState(false);

  const continueToAuth = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onContinue(selection);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.stepScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Hero>
          <View style={styles.heroIconCircle}>
            <MaterialIcons color="#ffffff" name="language" size={54} />
          </View>
          <Text style={styles.heroTitle}>表示言語を選択</Text>
          <Text style={styles.heroSubtitle}>Choose your language</Text>
        </Hero>

        <View style={styles.content}>
          <View style={styles.languageOptions}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selection === "ja" }}
              onPress={() => setSelection("ja")}
              style={({ pressed }) => [
                styles.languageOption,
                selection === "ja" && styles.languageOptionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View>
                <Text style={styles.languageName}>日本語</Text>
                <Text style={styles.languageCaption}>Japanese</Text>
              </View>
              <MaterialIcons
                color={selection === "ja" ? YELLOW : BORDER_GRAY}
                name={selection === "ja" ? "check-circle" : "radio-button-unchecked"}
                size={25}
              />
            </Pressable>

            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selection === "en" }}
              onPress={() => setSelection("en")}
              style={({ pressed }) => [
                styles.languageOption,
                selection === "en" && styles.languageOptionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View>
                <Text style={styles.languageName}>English</Text>
                <Text style={styles.languageCaption}>英語</Text>
              </View>
              <MaterialIcons
                color={selection === "en" ? YELLOW : BORDER_GRAY}
                name={selection === "en" ? "check-circle" : "radio-button-unchecked"}
                size={25}
              />
            </Pressable>
          </View>

          <View style={styles.bottomActions}>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => void continueToAuth()}
              style={({ pressed }) => [
                styles.primaryButton,
                saving && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>
                    {selection === "ja" ? "次へ" : "Continue"}
                  </Text>
                  <MaterialIcons color="#ffffff" name="arrow-forward" size={20} />
                </>
              )}
            </Pressable>
            <Progress activeStep={1} language={selection} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

type AuthStepProps = {
  language: AppLanguage;
  onBack: () => Promise<void>;
};

function AuthStep({ language, onBack }: AuthStepProps) {
  const { busy, continuePasskey, error, login, preAuth, recoverWithRecoveryKey, recoveryVerified, status } = useAuth();
  const [showRecovery, setShowRecovery] = useState(false);
  const passkeyReady = status === "pre_auth" && preAuth !== null;
  const startAuthentication = async () => {
    try {
      if (passkeyReady) {
        await continuePasskey(language);
      } else {
        await login();
      }
    } catch {
      // useAuth exposes the handled error through its error state.
      return;
    }
  };
  const copy = language === "ja"
    ? {
        title: passkeyReady ? "Passkeyを設定" : "アカウントを作成",
        subtitle: passkeyReady
          ? recoveryVerified
            ? (preAuth?.passkey_registered
              ? "Recovery Keyを確認しました。続けてPasskeyで本人確認します。"
              : "Recovery Keyを確認しました。続けてこの端末のPasskeyを登録します。")
            : "Google認証が完了しました。続けてこの端末を保護します。"
          : "Googleアカウントで安全に登録・ログインできます。",
        google: "Googleで続ける",
        passkey: preAuth?.passkey_registered ? "Passkeyで本人確認" : "Passkeyを登録",
        recovery: "Recovery Keyで復旧",
        verificationDone: recoveryVerified ? "Recovery Key確認済み" : "Google認証済み",
        privacy: "メールアドレスは本人確認のためにのみ使用します",
        passkeyNote: "Passkeyはパスワードを保存せず、この端末の画面ロックで本人確認します",
      }
    : {
        title: passkeyReady ? "Set up a passkey" : "Create your account",
        subtitle: passkeyReady
          ? recoveryVerified
            ? (preAuth?.passkey_registered
              ? "Your Recovery Key was verified. Continue with Passkey verification."
              : "Your Recovery Key was verified. Continue by creating a Passkey for this device.")
            : "Google verification is complete. Now protect this device."
          : "Sign up or sign in securely with your Google account.",
        google: "Continue with Google",
        passkey: preAuth?.passkey_registered ? "Verify with passkey" : "Create a passkey",
        recovery: "Recover with Recovery Key",
        verificationDone: recoveryVerified ? "Recovery Key verified" : "Google verified",
        privacy: "Your email is used only to verify your account",
        passkeyNote: "Passkeys use your device screen lock, so there is no password to store",
      };

  if (showRecovery && passkeyReady && preAuth?.passkey_registered && preAuth.recovery_available === true) {
    return (
      <RecoveryKeyInput
        accountID={preAuth.user_id}
        busy={busy}
        error={error}
        language={language}
        onBack={() => setShowRecovery(false)}
        onSubmit={async (recoveryKey) => {
          await recoverWithRecoveryKey(recoveryKey);
        }}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.stepScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Hero onBack={() => void onBack()}>
          <View style={styles.authIllustration}>
            <MaterialIcons color="#ffffff" name={passkeyReady ? "key" : "person-outline"} size={64} />
          </View>
          <Text style={styles.heroTitle}>{copy.title}</Text>
          <Text style={[styles.heroSubtitle, styles.authSubtitle]}>{copy.subtitle}</Text>
        </Hero>

        <View style={styles.content}>
          <View style={styles.authActions}>
            {passkeyReady ? (
              <View style={styles.completedRow}>
                {recoveryVerified ? (
                  <MaterialIcons color={YELLOW} name="vpn-key" size={22} />
                ) : (
                  <View style={styles.googleMarkSmall}>
                    <FontAwesome color="#4285f4" name="google" size={19} />
                  </View>
                )}
                <Text style={styles.completedText}>{copy.verificationDone}</Text>
                <MaterialIcons color="#3d9a68" name="check-circle" size={22} />
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void startAuthentication()}
              style={({ pressed }) => [
                styles.authButton,
                busy && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={TEXT_GRAY} />
              ) : passkeyReady ? (
                <MaterialIcons color={YELLOW} name="key" size={26} />
              ) : (
                <FontAwesome color="#4285f4" name="google" size={23} />
              )}
              {!busy ? (
                <Text style={styles.authButtonText}>
                  {passkeyReady ? copy.passkey : copy.google}
                </Text>
              ) : null}
            </Pressable>

            {passkeyReady && preAuth?.passkey_registered && preAuth.recovery_available === true ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setShowRecovery(true)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  busy && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialIcons color={YELLOW} name="vpn-key" size={22} />
                <Text style={styles.secondaryButtonText}>{copy.recovery}</Text>
              </Pressable>
            ) : null}

            <View style={styles.securityNote}>
              <MaterialIcons color={MUTED_GRAY} name="lock-outline" size={16} />
              <Text style={styles.securityNoteText}>
                {passkeyReady ? copy.passkeyNote : copy.privacy}
              </Text>
            </View>

            {error ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {error}
              </Text>
            ) : null}
          </View>

          <View style={styles.bottomActions}>
            <Progress activeStep={2} language={language} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

type ProfileStepProps = {
  initialProfile: LocalProfile | null;
  language: AppLanguage;
  onBack: () => Promise<void>;
  onSubmit: (profile: LocalProfile) => Promise<void>;
};

type KeySetupState =
  | { status: "loading" }
  | { status: "create"; material: GeneratedKeyMaterial }
  | { status: "recover"; envelope: KeyEnvelope; error?: string }
  | { status: "rotate"; material: GeneratedKeyMaterial; error?: string }
  | { status: "complete"; mode: "initial" | "recovery" }
  | { status: "ready" }
  | { status: "error"; message: string };

function KeySetupError({
  accountID,
  actionError,
  actionBusy,
  language,
  message,
  onDeleteAccount,
  onReauthenticate,
  onLogout,
  onRetry,
}: {
  accountID: string;
  actionError: string | null;
  actionBusy: boolean;
  language: AppLanguage;
  message: string;
  onDeleteAccount: () => Promise<void>;
  onReauthenticate: () => Promise<void>;
  onLogout: () => void;
  onRetry: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const copy = language === "ja"
    ? {
        title: "暗号鍵を準備できません",
        description: "通信またはサーバー設定を確認してから、もう一度お試しください。暗号鍵を登録するまでアプリは先へ進みません。",
        reauthenticate: "Passkeyで再認証して続ける",
        retry: "もう一度試す",
        logout: "ログアウト",
        deleteAccount: "アカウント削除",
        deleteTitle: "このアカウントを削除しますか？",
        deleteWarning: "この操作は取り消せません。アカウント、端末鍵、保存データを削除します。",
        deleteScope: "削除対象: アカウント、全セッション、端末鍵、暗号化データ",
        confirmDeleteInstruction: "確認のため DELETE と入力してください。",
        confirmDeletePlaceholder: "DELETE と入力",
        deleteConfirm: "Passkeyで再認証して削除",
        cancel: "キャンセル",
      }
    : {
        title: "Encryption keys are not ready",
        description: "Check the connection or server configuration and try again. The app will not continue until the encryption key is ready.",
        reauthenticate: "Re-authenticate with Passkey and continue",
        retry: "Try again",
        logout: "Log out",
        deleteAccount: "Delete account",
        deleteTitle: "Delete this account?",
        deleteWarning: "This cannot be undone. Your account, device keys, and stored data will be deleted.",
        deleteScope: "This deletes your account, all sessions, device keys, and encrypted data.",
        confirmDeleteInstruction: "Type DELETE to confirm.",
        confirmDeletePlaceholder: "Type DELETE",
        deleteConfirm: "Re-authenticate with Passkey and delete",
        cancel: "Cancel",
      };

  return (
    <View style={styles.keySetupErrorScreen}>
      <StatusBar style="dark" />
      <MaterialIcons color="#b42318" name="error-outline" size={58} />
      <Text style={styles.keySetupErrorTitle}>{copy.title}</Text>
      <Text style={styles.keySetupErrorDescription}>{copy.description}</Text>
      <Text style={styles.keySetupErrorMessage}>{message}</Text>
      {actionError ? <Text style={styles.keySetupErrorMessage}>{actionError}</Text> : null}
      <SupportAccountID accountID={accountID} language={language} />
      <Pressable disabled={actionBusy} onPress={() => void onReauthenticate()} style={[styles.primaryButton, actionBusy && styles.disabled]}>
        {actionBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>{copy.reauthenticate}</Text>}
      </Pressable>
      <Pressable disabled={actionBusy} onPress={onRetry} style={[styles.secondaryButton, actionBusy && styles.disabled]}>
        <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
      </Pressable>
      <Pressable
        disabled={actionBusy}
        onPress={() => {
          setDeleteConfirmation("");
          setConfirmDelete(true);
        }}
        style={[styles.deleteAccountButton, actionBusy && styles.disabled]}
      >
        <Text style={styles.deleteAccountButtonText}>{copy.deleteAccount}</Text>
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => {
          if (!actionBusy) setConfirmDelete(false);
        }}
        transparent
        visible={confirmDelete}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keySetupModalBackdrop}
        >
          <View style={styles.keySetupDeletePanel}>
            <Text style={styles.keySetupDeleteTitle}>{copy.deleteTitle}</Text>
            <Text style={styles.keySetupDeleteDescription}>{copy.deleteWarning}</Text>
            <Text style={styles.keySetupDeleteDescription}>{copy.deleteScope}</Text>
            <Text style={styles.keySetupDeleteDescription}>{copy.confirmDeleteInstruction}</Text>
            {actionError ? <Text style={styles.keySetupErrorMessage}>{actionError}</Text> : null}
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!actionBusy}
              onChangeText={setDeleteConfirmation}
              placeholder={copy.confirmDeletePlaceholder}
              placeholderTextColor="#a56d68"
              style={styles.keySetupDeleteInput}
              value={deleteConfirmation}
            />
            <Pressable
              disabled={actionBusy}
              onPress={() => {
                setDeleteConfirmation("");
                setConfirmDelete(false);
              }}
              style={[styles.secondaryButton, actionBusy && styles.disabled]}
            >
              <Text style={styles.secondaryButtonText}>{copy.cancel}</Text>
            </Pressable>
            <Pressable
              disabled={actionBusy || deleteConfirmation.trim().toUpperCase() !== "DELETE"}
              onPress={() => void onDeleteAccount().catch(() => undefined)}
              style={[styles.keySetupDeleteConfirm, (actionBusy || deleteConfirmation.trim().toUpperCase() !== "DELETE") && styles.disabled]}
            >
              {actionBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>{copy.deleteConfirm}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Pressable disabled={actionBusy} onPress={onLogout} style={[styles.secondaryButton, actionBusy && styles.disabled]}>
        <Text style={styles.secondaryButtonText}>{copy.logout}</Text>
      </Pressable>
    </View>
  );
}

function ProfileStep({ initialProfile, language, onBack, onSubmit }: ProfileStepProps) {
  const copy = language === "ja"
    ? {
        title: "プロフィールを設定",
        subtitle: "あなたらしさが伝わる情報を登録しましょう",
      }
    : {
        title: "Set up your profile",
        subtitle: "Add a few details to introduce yourself",
      };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.profileScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Hero compact onBack={() => void onBack()}>
          <View style={styles.avatar}>
            <MaterialIcons color="#ffffff" name="person" size={58} />
          </View>
          <Text style={[styles.heroTitle, styles.profileTitle]}>{copy.title}</Text>
          <Text style={styles.heroSubtitle}>{copy.subtitle}</Text>
        </Hero>

        <View style={[styles.content, styles.profileContent]}>
          <ProfileForm
            initialProfile={initialProfile}
            language={language}
            onSubmit={onSubmit}
          />
          <Progress activeStep={3} language={language} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function OnboardingScreen() {
  const {
    continuePasskey,
    deleteAccount,
    logout,
    refresh,
    session,
    status,
  } = useAuth();
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [languageLoaded, setLanguageLoaded] = useState(false);
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);
  const [keySetupFor, setKeySetupFor] = useState<string | null>(null);
  const [keySetupAttempt, setKeySetupAttempt] = useState(0);
  const [keySetupBusy, setKeySetupBusy] = useState(false);
  const [keySetupActionBusy, setKeySetupActionBusy] = useState(false);
  const [keySetupActionError, setKeySetupActionError] = useState<string | null>(null);
  const [keySetupState, setKeySetupState] = useState<KeySetupState>({ status: "loading" });
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const reauthenticateKeySetup = async () => {
    if (keySetupActionBusy) return;
    setKeySetupActionBusy(true);
    setKeySetupActionError(null);
    try {
      await refresh();
      const reauthenticated = await continuePasskey(language ?? "ja");
      if (!reauthenticated) {
        throw new Error(language === "ja"
          ? "Passkey再認証後にアプリへ戻れませんでした。もう一度お試しください。"
          : "The app did not receive the Passkey result. Please try again.");
      }
      setKeySetupAttempt((attempt) => attempt + 1);
    } catch (reason) {
      setKeySetupActionError(reason instanceof Error ? reason.message : language === "ja"
        ? "Passkey再認証に失敗しました。"
        : "Passkey re-authentication failed.");
    } finally {
      setKeySetupActionBusy(false);
    }
  };

  const deleteBlockedAccount = async () => {
    if (keySetupActionBusy) return;
    setKeySetupActionBusy(true);
    setKeySetupActionError(null);
    try {
      await refresh();
      const reauthenticated = await continuePasskey(language ?? "ja");
      if (!reauthenticated) {
        throw new Error(language === "ja"
          ? "Passkey再認証後にアプリへ戻れませんでした。"
          : "The app did not receive the Passkey result.");
      }
      const deleted = await deleteAccount();
      if (!deleted) {
        throw new Error(language === "ja"
          ? "アカウント削除に失敗しました。再認証後にもう一度お試しください。"
          : "Account deletion failed. Please re-authenticate and try again.");
      }
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error(language === "ja"
        ? "アカウント削除に失敗しました。"
        : "Account deletion failed.");
      setKeySetupActionError(error.message);
      throw error;
    } finally {
      setKeySetupActionBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    void loadLanguage().then((storedLanguage) => {
      if (active) {
        setLanguage(storedLanguage);
        setLanguageLoaded(true);
      }
    }).catch(() => {
      if (active) setLanguageLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!session?.user_id) return;

    let active = true;
    const userID = session.user_id;
    void loadLocalProfile(userID).then((storedProfile) => {
      if (active) {
        setProfile(storedProfile);
        setProfileLoadedFor(userID);
      }
    }).catch(() => {
      if (active) setProfileLoadedFor(userID);
    });
    return () => {
      active = false;
    };
  }, [session?.user_id]);

  useEffect(() => {
    const activeSession = sessionRef.current;
    if (!activeSession?.user_id) {
      setKeySetupFor(null);
      setKeySetupState({ status: "loading" });
      return;
    }

    let active = true;
    const userID = activeSession.user_id;
    setKeySetupFor(null);
    setKeySetupBusy(false);
    setKeySetupState({ status: "loading" });
    void (async () => {
      try {
        const localKeyA = await loadStoredKeyA(userID);
        if (!active) return;
        if (localKeyA) {
          const envelopes = await listKeyEnvelopes(activeSession);
          const envelope = envelopes.find((item) => item.kdf_params.data_salt.length > 0);
          if (!envelope) {
            throw new Error("このアカウントの暗号鍵情報を確認できません。Recovery Keyで復旧してください。");
          }
          const keyB = await ensureDeviceKeyB(activeSession);
          deriveDataKey(localKeyA, keyB.keyB, envelope.kdf_params.data_salt);
          if (!active) return;
          setKeySetupState({ status: "ready" });
          setKeySetupFor(userID);
          return;
        }

        const envelopes = await listKeyEnvelopes(activeSession);
        if (!active) return;
        const recoverableEnvelope = envelopes.find((envelope) => envelope.recovery_public_key.length > 0);
        if (recoverableEnvelope) {
          setKeySetupState({ status: "recover", envelope: recoverableEnvelope });
        } else {
          setKeySetupState({ status: "create", material: await createInitialKeyMaterial() });
        }
        setKeySetupFor(userID);
      } catch (reason) {
        if (!active) return;
        setKeySetupState({
          status: "error",
          message: reason instanceof Error ? reason.message : "key setup failed",
        });
        setKeySetupFor(userID);
      }
    })();

    return () => {
      active = false;
    };
  }, [keySetupAttempt, session?.session_id, session?.user_id]);

  if (!languageLoaded || status === "loading") {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator color={BLUE} size="large" />
      </View>
    );
  }

  if (!language) {
    return (
      <LanguageStep
        onContinue={async (selectedLanguage) => {
          await saveLanguage(selectedLanguage);
          setLanguage(selectedLanguage);
        }}
      />
    );
  }

  if (status !== "signed_in" || !session) {
    return (
      <AuthStep
        language={language}
        onBack={async () => {
          await clearLanguage();
          setLanguage(null);
        }}
      />
    );
  }

  if (keySetupFor !== session.user_id || keySetupState.status === "loading") {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator color={BLUE} size="large" />
        <Text style={styles.loadingText}>
          {language === "ja" ? "暗号鍵を確認しています…" : "Checking encryption keys…"}
        </Text>
      </View>
    );
  }

  if (keySetupState.status === "error") {
    return (
      <KeySetupError
        accountID={session.user_id}
        actionBusy={keySetupActionBusy}
        actionError={keySetupActionError}
        language={language}
        message={keySetupState.message}
        onDeleteAccount={deleteBlockedAccount}
        onReauthenticate={reauthenticateKeySetup}
        onLogout={() => void logout()}
        onRetry={() => setKeySetupAttempt((attempt) => attempt + 1)}
      />
    );
  }

  if (keySetupState.status === "complete") {
    return (
      <RecoveryCompletion
        accountID={session.user_id}
        language={language}
        mode={keySetupState.mode}
        onContinue={() => setKeySetupState({ status: "ready" })}
      />
    );
  }

  if (keySetupState.status === "create") {
    return (
      <RecoveryKeyDisplay
        accountID={session.user_id}
        busy={keySetupBusy || keySetupActionBusy}
        error={null}
        language={language}
        onBack={() => void logout()}
        onConfirm={async () => {
          setKeySetupBusy(true);
          try {
            const keyB = await ensureDeviceKeyB(session);
            deriveDataKey(keySetupState.material.keyA, keyB.keyB, keySetupState.material.envelope.kdf_params.data_salt);
            await completeInitialKeySetup(session, keySetupState.material);
            setKeySetupState({ status: "complete", mode: "initial" });
          } catch (reason) {
            setKeySetupState({
              status: "error",
              message: reason instanceof Error ? reason.message : "key setup failed",
            });
          } finally {
            setKeySetupBusy(false);
          }
        }}
        onDeleteAccount={deleteBlockedAccount}
        recoveryKey={keySetupState.material.recoveryKey}
      />
    );
  }

  if (keySetupState.status === "recover") {
    return (
      <RecoveryKeyInput
        accountID={session.user_id}
        busy={keySetupBusy || keySetupActionBusy}
        error={keySetupState.error ?? null}
        language={language}
        onBack={() => void logout()}
        onSubmit={async (recoveryKey) => {
          setKeySetupBusy(true);
          setKeySetupState((current) => current.status === "recover" ? { ...current, error: undefined } : current);
          try {
            await recoverWithSession(session, recoveryKey);
            const keyA = await loadStoredKeyA(session.user_id);
            if (!keyA) throw new Error("Recovered Key-A was not saved");
            const keyB = await ensureDeviceKeyB(session);
            deriveDataKey(keyA, keyB.keyB, keySetupState.envelope.kdf_params.data_salt);
            const material = await createRecoveryKeyMaterial(keyA, keySetupState.envelope);
            setKeySetupState({ status: "rotate", material });
          } catch (reason) {
            setKeySetupState((current) => current.status === "recover"
              ? { ...current, error: reason instanceof Error ? reason.message : "Recovery Keyの確認に失敗しました。" }
              : current);
          } finally {
            setKeySetupBusy(false);
          }
        }}
        onDeleteAccount={deleteBlockedAccount}
      />
    );
  }

  if (keySetupState.status === "rotate") {
    return (
      <RecoveryKeyDisplay
        accountID={session.user_id}
        busy={keySetupBusy || keySetupActionBusy}
        error={keySetupState.error ?? null}
        language={language}
        mode="rotate"
        onBack={() => void logout()}
        onConfirm={async () => {
          setKeySetupBusy(true);
          setKeySetupState((current) => current.status === "rotate" ? { ...current, error: undefined } : current);
          try {
            await completeRecoveryKeyRotation(session, keySetupState.material);
            setKeySetupState({ status: "complete", mode: "recovery" });
          } catch (reason) {
            setKeySetupState((current) => current.status === "rotate"
              ? { ...current, error: reason instanceof Error ? reason.message : "Recovery Keyの更新に失敗しました。" }
              : current);
          } finally {
            setKeySetupBusy(false);
          }
        }}
        onDeleteAccount={deleteBlockedAccount}
        recoveryKey={keySetupState.material.recoveryKey}
      />
    );
  }

  if (profileLoadedFor !== session.user_id) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={BLUE} size="large" />
      </View>
    );
  }

  if (profile?.completed) {
    if (profile.identityVerificationChoice === null) {
      const saveChoice = async (choice: "proceed" | "later") => {
        const nextProfile = {
          ...profile,
          identityVerificationChoice: choice,
        };
        await saveLocalProfile(session.user_id, nextProfile);
        setProfile(nextProfile);
      };

      return (
        <IdentityVerificationPrompt
          language={language}
          onLater={() => saveChoice("later")}
          onProceed={() => saveChoice("proceed")}
        />
      );
    }

    return <Redirect href={language === "ja" ? "/japanese" : "/foreigner"} />;
  }

  return (
    <ProfileStep
      initialProfile={profile}
      language={language}
      onBack={async () => {
        await clearLanguage();
        setLanguage(null);
      }}
      onSubmit={async (nextProfile) => {
        await saveLocalProfile(session.user_id, nextProfile);
        setProfile(nextProfile);
      }}
    />
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
  },
  loadingText: {
    marginTop: 12,
    color: MUTED_GRAY,
    fontSize: 14,
  },
  keySetupErrorScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 16,
    backgroundColor: "#ffffff",
  },
  keySetupErrorTitle: {
    color: TEXT_GRAY,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  keySetupErrorDescription: {
    color: MUTED_GRAY,
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
  keySetupErrorMessage: {
    color: "#b42318",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  hero: {
    width: "100%",
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderBottomLeftRadius: 44,
    borderBottomRightRadius: 44,
    backgroundColor: BLUE,
  },
  heroDefault: {
    minHeight: 350,
    paddingBottom: 34,
  },
  heroCompact: {
    minHeight: 270,
    paddingBottom: 27,
  },
  backButton: {
    position: "absolute",
    top: 54,
    left: 20,
    width: 42,
    height: 42,
    paddingLeft: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 21,
  },
  heroIconCircle: {
    width: 100,
    height: 100,
    marginBottom: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.8)",
    borderRadius: 50,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 27,
    fontWeight: "900",
    lineHeight: 34,
    letterSpacing: 0,
    textAlign: "center",
  },
  heroSubtitle: {
    maxWidth: 340,
    marginTop: 8,
    color: "rgba(255, 255, 255, 0.94)",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    letterSpacing: 0,
    textAlign: "center",
  },
  authSubtitle: {
    minHeight: 42,
  },
  content: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    paddingTop: 30,
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignSelf: "center",
    justifyContent: "space-between",
  },
  languageOptions: {
    width: "100%",
    gap: 12,
  },
  languageOption: {
    minHeight: 72,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  languageOptionSelected: {
    borderWidth: 2,
    borderColor: YELLOW,
    backgroundColor: "#fffaf0",
  },
  languageName: {
    color: TEXT_GRAY,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0,
  },
  languageCaption: {
    marginTop: 2,
    color: MUTED_GRAY,
    fontSize: 12,
    letterSpacing: 0,
  },
  bottomActions: {
    width: "100%",
    marginTop: 28,
    alignItems: "center",
    gap: 23,
  },
  primaryButton: {
    width: "100%",
    minHeight: 54,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 8,
    backgroundColor: YELLOW,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
  },
  progress: {
    height: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#d9e6ec",
  },
  progressDotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: BLUE,
  },
  authIllustration: {
    width: 112,
    height: 112,
    marginBottom: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.78)",
    borderRadius: 56,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  authActions: {
    width: "100%",
    gap: 15,
  },
  authButton: {
    width: "100%",
    minHeight: 58,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 13,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  authButtonText: {
    color: TEXT_GRAY,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
    textAlign: "center",
  },
  secondaryButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 24,
    backgroundColor: "#fffaf0",
  },
  secondaryButtonText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
  },
  deleteAccountButton: {
    width: "100%",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d92d20",
    borderRadius: 24,
    backgroundColor: "#fff5f4",
  },
  deleteAccountButtonText: {
    color: "#b42318",
    fontSize: 14,
    fontWeight: "700",
  },
  keySetupDeletePanel: {
    width: "100%",
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f3b5af",
    borderRadius: 16,
    backgroundColor: "#fff5f4",
  },
  keySetupModalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  keySetupDeleteTitle: {
    color: "#7a271a",
    fontSize: 17,
    fontWeight: "700",
  },
  keySetupDeleteDescription: {
    color: "#7a271a",
    fontSize: 14,
    lineHeight: 21,
  },
  keySetupDeleteInput: {
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
  keySetupDeleteConfirm: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: "#d92d20",
  },
  completedRow: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 8,
    backgroundColor: "#eef8f2",
  },
  googleMarkSmall: {
    width: 28,
    alignItems: "center",
  },
  completedText: {
    flex: 1,
    color: "#357a55",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0,
  },
  securityNote: {
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 7,
  },
  securityNoteText: {
    flexShrink: 1,
    color: MUTED_GRAY,
    fontSize: 11,
    lineHeight: 17,
    letterSpacing: 0,
    textAlign: "center",
  },
  errorText: {
    color: "#b42318",
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
    textAlign: "center",
  },
  avatar: {
    width: 96,
    height: 96,
    marginBottom: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
    borderRadius: 48,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  profileTitle: {
    fontSize: 24,
    lineHeight: 30,
  },
  profileScrollContent: {
    flexGrow: 1,
  },
  stepScrollContent: {
    flexGrow: 1,
  },
  profileContent: {
    flex: 0,
    paddingTop: 25,
    paddingBottom: 28,
    justifyContent: "flex-start",
    gap: 23,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.72,
  },
});
