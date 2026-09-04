import { useEffect, useRef, useState, type ReactNode } from "react";
import { FontAwesome, MaterialIcons } from "@expo/vector-icons";
import { getLocales } from "expo-localization";
import { Redirect } from "expo-router";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import IdentityVerificationPrompt from "../components/IdentityVerificationPrompt";
import ProfileForm from "../components/ProfileForm";
import { RecoveryAccountDeleteAction, RecoveryCompletion, RecoveryKeyDisplay, RecoveryKeyInput, SupportAccountID } from "../components/RecoveryFlow";
import DemoAccountEntry from "../components/DemoAccountEntry";
import { LoadingScreen, LoadingSpinner } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import {
  completeInitialKeySetup,
  completeRecoveryKeyRotation,
  createInitialKeyMaterial,
  ensureDeviceAgreementKey,
  isRecoveryKeyRotationPending,
  listKeyEnvelopes,
  loadStoredKeyEnvelope,
  loadStoredKeyA,
  loadPendingRecoveryKeyRotation,
  loadInitialKeyMaterialDraft,
  recoverWithSession,
  saveInitialKeyMaterialDraft,
  savePendingRecoveryKeyRotation,
  type GeneratedKeyMaterial,
} from "../services/key-management";
import { createRecoveryMaterial, deriveAccountDataKey, type KeyEnvelope } from "../services/crypto";
import { createDemoKeyMaterial, type DemoKeyMaterial } from "../services/demo-crypto";
import {
  loadDemoKeyMaterialDraft,
  loadStoredDemoAgreementPrivateKey,
  registerDemoDeviceKey,
  saveDemoKeyMaterial,
  saveDemoKeyMaterialDraft,
} from "../services/demo-key-management";
import { updateMyProfile } from "../services/profile";
import { resolveDefaultAppMode } from "../services/device-locale";
import {
  clearAppMode,
  clearLanguage,
  loadAppMode,
  loadIdentityVerificationChoice,
  loadLanguage,
  loadLocalProfile,
  saveAppMode,
  saveIdentityVerificationChoice,
  saveLanguage,
  saveLocalProfile,
  serializeMonsterSeedForLegacyBio,
  type AppMode,
  type AppLanguage,
  type IdentityVerificationChoice,
  type LocalProfile,
} from "../services/onboarding";

type LoadedUserOnboardingState = {
  profile: LocalProfile | null;
  identityVerificationChoice: IdentityVerificationChoice;
};

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#7d7d7d";
const BORDER_GRAY = "#d4d4d4";
const KEY_SETUP_TIMEOUT_MS = 45_000;
const KEY_SETUP_TIMEOUT_MESSAGE = "暗号鍵の準備に時間がかかっています。通信または端末の状態を確認して、もう一度お試しください。";

function defaultAppMode(language: AppLanguage): AppMode {
  try {
    return resolveDefaultAppMode(language, getLocales());
  } catch {
    return resolveDefaultAppMode(language, []);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMS: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutID = setTimeout(() => {
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMS);
    promise.then((value) => {
      if (settled) return;
      clearTimeout(timeoutID);
      settled = true;
      resolve(value);
    }, (reason) => {
      if (settled) return;
      clearTimeout(timeoutID);
      settled = true;
      reject(reason);
    });
  });
}

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
  appMode: AppMode;
  language: AppLanguage;
  onAuthenticated: () => void;
  onBack: () => Promise<void>;
};

function AuthStep({ appMode, language, onAuthenticated, onBack }: AuthStepProps) {
  const { busy, continuePasskey, deleteAccount, error, login, logout, preAuth, recoverWithRecoveryKey, recoveryVerified, session, startDemoAccount, status } = useAuth();
  const [showRecovery, setShowRecovery] = useState(false);
  const demoEntryEnabled = process.env.EXPO_PUBLIC_DEMO_ACCOUNT_ENABLED === "true";
  const googleLoginEnabled = process.env.EXPO_PUBLIC_GOOGLE_LOGIN_ENABLED === "true"
    || (process.env.EXPO_PUBLIC_GOOGLE_LOGIN_ENABLED !== "false" && !demoEntryEnabled);
  const passkeyReady = status === "pre_auth" && preAuth !== null;
  const signedIn = status === "signed_in";
  const signedInDemo = signedIn && session?.account_type === "demo";
  const leaveAuthentication = async () => {
    if (busy) return;
    await logout();
    await onBack();
  };
  const startAuthentication = async () => {
    try {
      if (signedIn) {
        onAuthenticated();
      } else if (passkeyReady) {
        if (await continuePasskey(language)) onAuthenticated();
      } else if (googleLoginEnabled) {
        await login();
      }
    } catch {
      // useAuth exposes the handled error through its error state.
    }
  };
  const deleteRecoveredAccount = async () => {
    if (await deleteAccount()) return;
    throw new Error(language === "ja" ? "アカウント削除に失敗しました。" : "Account deletion failed.");
  };
  const startDemo = async () => {
    try {
      if (await startDemoAccount(language, appMode)) onAuthenticated();
    } catch {
      // useAuth exposes the handled error through its error state.
    }
  };
  const copy = language === "ja"
    ? {
        title: signedIn
          ? "アカウント登録完了"
          : passkeyReady
            ? "Passkeyを設定"
            : "アカウントを作成",
        subtitle: signedIn
          ? signedInDemo
            ? "審査用Demoアカウントを作成しました。次にプロフィールへ進みます。"
            : "Googleアカウントの確認が完了しました。次に本人確認へ進みます。"
          : passkeyReady
            ? recoveryVerified
              ? (preAuth?.passkey_registered
                ? "Recovery Phraseを確認しました。続けてPasskeyで本人確認します。"
                : "Recovery Phraseを確認しました。続けてこの端末のPasskeyを登録します。")
              : "Google認証が完了しました。続けてこの端末を保護します。"
          : googleLoginEnabled
            ? "Googleアカウントで安全に登録・ログインできます。"
            : "登録不要の審査用Demoアカウントで体験できます。",
        continue: "次へ",
        google: "Googleで続ける",
        passkey: preAuth?.passkey_registered ? "Passkeyで本人確認" : "Passkeyを登録",
        recovery: "Recovery Phraseで復旧",
        logout: "ログアウト",
        verificationDone: signedInDemo ? "Demoアカウント作成済み" : recoveryVerified ? "Recovery Phrase確認済み" : "Google認証済み",
        privacy: "メールアドレスは本人確認のためにのみ使用します",
        passkeyNote: "Passkeyはパスワードを保存せず、この端末の画面ロックで本人確認します",
      }
    : {
        title: signedIn
          ? "Account ready"
          : passkeyReady
            ? "Set up a passkey"
            : "Create your account",
        subtitle: signedIn
          ? signedInDemo
            ? "Your review demo account is ready. Continue to your profile."
            : "Your Google account is verified. Next, review identity verification."
          : passkeyReady
            ? recoveryVerified
                ? (preAuth?.passkey_registered
                ? "Your Recovery Phrase was verified. Continue with Passkey verification."
                : "Your Recovery Phrase was verified. Continue by creating a Passkey for this device.")
              : "Google verification is complete. Now protect this device."
          : googleLoginEnabled
            ? "Sign up or sign in securely with your Google account."
            : "Try the app with a review demo account. No sign-up required.",
        continue: "Continue",
        google: "Continue with Google",
        passkey: preAuth?.passkey_registered ? "Verify with passkey" : "Create a passkey",
        recovery: "Recover with Recovery Phrase",
        logout: "Log out",
        verificationDone: signedInDemo ? "Demo account ready" : recoveryVerified ? "Recovery Phrase verified" : "Google verified",
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
        <Hero onBack={() => void leaveAuthentication()}>
          <View style={styles.authIllustration}>
            <MaterialIcons
              color="#ffffff"
              name={signedIn ? "check-circle" : passkeyReady ? "key" : "person-outline"}
              size={64}
            />
          </View>
          <Text style={styles.heroTitle}>{copy.title}</Text>
          <Text style={[styles.heroSubtitle, styles.authSubtitle]}>{copy.subtitle}</Text>
        </Hero>

        <View style={styles.content}>
          <View style={styles.authActions}>
            {passkeyReady || signedIn ? (
              <View style={styles.completedRow}>
                {signedInDemo ? (
                  <MaterialIcons color={YELLOW} name="play-circle-outline" size={22} />
                ) : recoveryVerified ? (
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

            {passkeyReady || signedIn || googleLoginEnabled ? (
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
                ) : signedIn ? (
                  <MaterialIcons color={YELLOW} name="arrow-forward" size={26} />
                ) : passkeyReady ? (
                  <MaterialIcons color={YELLOW} name="key" size={26} />
                ) : (
                  <FontAwesome color="#4285f4" name="google" size={23} />
                )}
                {!busy ? (
                  <Text style={styles.authButtonText}>
                    {signedIn ? copy.continue : passkeyReady ? copy.passkey : copy.google}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}

            {!signedIn && demoEntryEnabled ? (
              <DemoAccountEntry
                disabled={busy}
                language={language}
                onPress={() => void startDemo()}
              />
            ) : null}

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
                {passkeyReady || signedIn ? copy.passkeyNote : copy.privacy}
              </Text>
            </View>

            {error ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {error}
              </Text>
            ) : null}

            {recoveryVerified ? (
              <RecoveryAccountDeleteAction
                busy={busy}
                language={language}
                onDelete={deleteRecoveredAccount}
              />
            ) : null}

            {passkeyReady ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void leaveAuthentication()}
                style={({ pressed }) => [
                  styles.authLogoutButton,
                  busy && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.authLogoutButtonText}>{copy.logout}</Text>
              </Pressable>
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
  | { status: "demo-create"; material: DemoKeyMaterial }
  | { status: "recover"; envelope: KeyEnvelope; error?: string }
  | { status: "rotate"; material: GeneratedKeyMaterial; error?: string }
  | { status: "complete"; mode: "initial" | "recovery" }
  | { status: "ready" }
  | { status: "error"; message: string };

type KeySetupStage = "loading_local" | "loading_envelopes" | "generating";

function keyEnvelopeMatches(left: KeyEnvelope, right: KeyEnvelope): boolean {
  return left.key_version === right.key_version
    && left.encrypted_key_a === right.encrypted_key_a
    && left.nonce === right.nonce
    && left.kdf_params.algorithm === right.kdf_params.algorithm
    && left.kdf_params.salt === right.kdf_params.salt
    && left.kdf_params.info === right.kdf_params.info
    && left.kdf_params.data_salt === right.kdf_params.data_salt
    && left.kdf_params.argon2id.memory_kib === right.kdf_params.argon2id.memory_kib
    && left.kdf_params.argon2id.iterations === right.kdf_params.argon2id.iterations
    && left.kdf_params.argon2id.parallelism === right.kdf_params.argon2id.parallelism
    && left.recovery_public_key === right.recovery_public_key;
}

function describeKeySetupError(reason: unknown, language: AppLanguage): string {
  const raw = reason instanceof Error ? reason.message : "";
  if (raw === "403: recent_passkey_authentication_required") {
    return language === "ja"
      ? "暗号鍵を扱うにはPasskeyでの再認証が必要です。再認証して続けてください。"
      : "Re-authenticate with your Passkey to access the encryption keys, then continue.";
  }
  if (raw === "401: missing_or_invalid_access_token" || /^4\d\d:/.test(raw)) {
    return language === "ja"
      ? "認証情報を更新できませんでした。Passkeyで再認証して続けてください。"
      : "The sign-in session could not be refreshed. Re-authenticate with your Passkey and continue.";
  }
  return raw || (language === "ja" ? "暗号鍵の準備に失敗しました。" : "The encryption keys could not be prepared.");
}

function KeySetupError({
  accountID,
  demo = false,
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
  demo?: boolean;
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
  const copy = demo
    ? language === "ja"
      ? {
          title: "Demo鍵を準備できません",
          description: "Demo用の通信または鍵登録に失敗しました。再試行するか、Demoアカウントを終了してください。",
          reauthenticate: "",
          retry: "もう一度試す",
          logout: "Demoを終了",
          deleteAccount: "",
          deleteTitle: "",
          deleteWarning: "",
          deleteScope: "",
          deleteConfirmation: "",
          confirmDeleteInstruction: "",
          confirmDeletePlaceholder: "",
          deleteConfirm: "",
          cancel: "",
        }
      : {
          title: "Demo keys are not ready",
          description: "The Demo key registration failed. Try again or end this Demo account.",
          reauthenticate: "",
          retry: "Try again",
          logout: "End Demo",
          deleteAccount: "",
          deleteTitle: "",
          deleteWarning: "",
          deleteScope: "",
          deleteConfirmation: "",
          confirmDeleteInstruction: "",
          confirmDeletePlaceholder: "",
          deleteConfirm: "",
          cancel: "",
        }
    : language === "ja"
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
        deleteConfirmation: "削除",
        confirmDeleteInstruction: "確認のため「削除」と入力してください。",
        confirmDeletePlaceholder: "削除 と入力",
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
        deleteConfirmation: "DELETE",
        confirmDeleteInstruction: "Type DELETE to confirm.",
        confirmDeletePlaceholder: "Type DELETE",
        deleteConfirm: "Re-authenticate with Passkey and delete",
        cancel: "Cancel",
      };
  const expectedDeleteConfirmation = copy.deleteConfirmation;

  return (
    <View style={styles.keySetupErrorScreen}>
      <StatusBar style="dark" />
      <MaterialIcons color="#b42318" name="error-outline" size={58} />
      <Text style={styles.keySetupErrorTitle}>{copy.title}</Text>
      <Text style={styles.keySetupErrorDescription}>{copy.description}</Text>
      <Text style={styles.keySetupErrorMessage}>{message}</Text>
      {actionError ? <Text style={styles.keySetupErrorMessage}>{actionError}</Text> : null}
      <SupportAccountID accountID={accountID} language={language} />
      {!demo ? (
        <Pressable disabled={actionBusy} onPress={() => void onReauthenticate()} style={[styles.primaryButton, actionBusy && styles.disabled]}>
          {actionBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>{copy.reauthenticate}</Text>}
        </Pressable>
      ) : null}
      <Pressable disabled={actionBusy} onPress={onRetry} style={[styles.secondaryButton, actionBusy && styles.disabled]}>
        <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
      </Pressable>
      {!demo ? (
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
      ) : null}
      {!demo ? <Modal
        animationType="fade"
        onRequestClose={() => {
          if (!actionBusy) setConfirmDelete(false);
        }}
        transparent
        visible={confirmDelete}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.keySetupModalBackdrop}
          keyboardShouldPersistTaps="handled"
          style={styles.keySetupModalScrollView}
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
              disabled={actionBusy || deleteConfirmation.trim().toUpperCase() !== expectedDeleteConfirmation}
              onPress={() => void onDeleteAccount().catch(() => undefined)}
              style={[styles.keySetupDeleteConfirm, (actionBusy || deleteConfirmation.trim().toUpperCase() !== expectedDeleteConfirmation) && styles.disabled]}
            >
              {actionBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>{copy.deleteConfirm}</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </Modal> : null}
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
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        automaticallyAdjustKeyboardInsets
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
    </View>
  );
}

export default function OnboardingScreen() {
  const {
    continuePasskey,
    deleteAccount,
    error: authError,
    getCurrentSession,
    logout,
    refresh,
    retryRestore,
    session,
    status,
  } = useAuth();
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [appMode, setAppMode] = useState<AppMode | null>(null);
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [identityVerificationChoice, setIdentityVerificationChoice] =
    useState<IdentityVerificationChoice>(null);
  const [accountStepCompleted, setAccountStepCompleted] = useState(false);
  const [languageLoaded, setLanguageLoaded] = useState(false);
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);
  const [keySetupFor, setKeySetupFor] = useState<string | null>(null);
  const [keySetupAttempt, setKeySetupAttempt] = useState(0);
  const [keySetupBusy, setKeySetupBusy] = useState(false);
  const [keySetupActionBusy, setKeySetupActionBusy] = useState(false);
  const [keySetupActionError, setKeySetupActionError] = useState<string | null>(null);
  const [keySetupState, setKeySetupState] = useState<KeySetupState>({ status: "loading" });
  const [keySetupStage, setKeySetupStage] = useState<KeySetupStage>("loading_local");
  const [restoreRetrying, setRestoreRetrying] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const languageRef = useRef(language);
  languageRef.current = language;
  const previousStatusRef = useRef(status);
  const [identityVerificationChoiceLoadedFor, setIdentityVerificationChoiceLoadedFor] =
    useState<string | null>(null);

  const reauthenticateKeySetup = async () => {
    if (keySetupActionBusy) return;
    setKeySetupActionBusy(true);
    setKeySetupActionError(null);
    try {
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

  const retryAuthRestore = async () => {
    if (restoreRetrying) return;
    setRestoreRetrying(true);
    try {
      await retryRestore();
    } finally {
      setRestoreRetrying(false);
    }
  };

  const clearBlockedAuth = async () => {
    if (restoreRetrying) return;
    setRestoreRetrying(true);
    try {
      await logout();
      setLanguage(null);
      setAppMode(null);
      setAccountStepCompleted(false);
    } finally {
      setRestoreRetrying(false);
    }
  };

  const deleteBlockedAccount = async () => {
    if (keySetupActionBusy) return;
    setKeySetupActionBusy(true);
    setKeySetupActionError(null);
    try {
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
    void Promise.all([loadLanguage(), loadAppMode()]).then(([storedLanguage, storedMode]) => {
      // Existing installs used display language as their home-mode selector.
      // Keep that one-time default, then persist an independent mode value.
      const defaultMode = storedLanguage === "en" ? "traveler" : storedLanguage === "ja" ? "local" : null;
      const resolvedMode = storedMode ?? defaultMode;
      if (!storedMode && resolvedMode) void saveAppMode(resolvedMode);
      if (active) {
        setLanguage(storedLanguage);
        setAppMode(resolvedMode);
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
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    if (
      status !== "signed_out"
      || (previousStatus !== "signed_in" && previousStatus !== "pre_auth")
    ) {
      return;
    }

    // A completed logout must start from the same language screen as a new
    // install, including when logout was initiated from key setup on `/`.
    setLanguage(null);
    setAppMode(null);
    setAccountStepCompleted(false);
  }, [status]);

  useEffect(() => {
    if (!session?.user_id) {
      setProfile(null);
      setIdentityVerificationChoice(null);
      setAccountStepCompleted(false);
      setProfileLoadedFor(null);
      setIdentityVerificationChoiceLoadedFor(null);
      return;
    }

    let active = true;
    const userID = session.user_id;
    const loadUserOnboardingState =
      async (): Promise<LoadedUserOnboardingState> => {
        const storedProfile = await loadLocalProfile(userID);
        const storedIdentityVerificationChoice =
          await loadIdentityVerificationChoice(userID);

        return {
          profile: storedProfile,
          identityVerificationChoice:
            storedIdentityVerificationChoice ??
            storedProfile?.identityVerificationChoice ??
            null,
        };
      };

    void loadUserOnboardingState().then((storedState) => {
      if (active) {
        setProfile(storedState.profile);
        setIdentityVerificationChoice(storedState.identityVerificationChoice);
        setProfileLoadedFor(userID);
        setIdentityVerificationChoiceLoadedFor(userID);
      }
    }).catch(() => {
      if (active) {
        setProfileLoadedFor(userID);
        setIdentityVerificationChoiceLoadedFor(userID);
      }
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
      setKeySetupStage("loading_local");
      return;
    }
    // Wait until the persisted language lookup has completed. Starting the
    // Argon2id setup before that state update would clean up this effect and
    // start a second expensive KDF when the language state changes.
    if (!languageLoaded) return;

    let active = true;
    const userID = activeSession.user_id;
    setKeySetupFor(null);
    setKeySetupBusy(false);
    setKeySetupState({ status: "loading" });
    setKeySetupStage("loading_local");
    void (async () => {
      try {
        await withTimeout((async () => {
          if (activeSession.account_type === "demo") {
            setKeySetupStage("generating");
            const storedAgreementPrivateKey = await loadStoredDemoAgreementPrivateKey(userID);
            if (storedAgreementPrivateKey) {
              storedAgreementPrivateKey.fill(0);
              if (!active) return;
              setKeySetupState({ status: "ready" });
              setKeySetupFor(userID);
              return;
            }
            const demoDraft = await loadDemoKeyMaterialDraft(userID);
            const material = demoDraft ?? await createDemoKeyMaterial();
            if (!active) return;
            if (!demoDraft) await saveDemoKeyMaterialDraft(userID, material);
            if (!active) return;
            setKeySetupState({ status: "demo-create", material });
            setKeySetupFor(userID);
            return;
          }
          const [pendingRotation, initialDraft, storedKeyA, storedEnvelope] = await Promise.all([
            loadPendingRecoveryKeyRotation(userID),
            loadInitialKeyMaterialDraft(userID),
            loadStoredKeyA(userID),
            loadStoredKeyEnvelope(userID),
          ]);
          const localKeyA = storedKeyA ?? pendingRotation?.keyA ?? null;
          if (!active) return;
          if (localKeyA) {
            // A local Key-A means this device has already completed setup.
            // Use the securely cached envelope for ordinary startup; fetching
            // the server envelope is a recent-Passkey-gated operation.
            const envelope = pendingRotation?.envelope ?? storedEnvelope;
            if (!envelope) {
              setKeySetupState({ status: "ready" });
              setKeySetupFor(userID);
              return;
            }
            // Device registration is needed for protected photo requests, but
            // it is not needed to verify the local root key or open onboarding.
            // Do not make the whole app wait for this network round-trip.
            deriveAccountDataKey(localKeyA, envelope.kdf_params.data_salt);
            if (!active) return;
            if (pendingRotation || await isRecoveryKeyRotationPending(userID)) {
              if (!active) return;
              setKeySetupStage("generating");
              const usePendingRotation = pendingRotation !== null
                && pendingRotation.envelope.key_version === envelope.key_version
                && pendingRotation.envelope.encrypted_key_a === envelope.encrypted_key_a
                && pendingRotation.envelope.nonce === envelope.nonce
                && pendingRotation.envelope.kdf_params.algorithm === envelope.kdf_params.algorithm
                && pendingRotation.envelope.kdf_params.salt === envelope.kdf_params.salt
                && pendingRotation.envelope.kdf_params.info === envelope.kdf_params.info
                && pendingRotation.envelope.kdf_params.data_salt === envelope.kdf_params.data_salt
                && pendingRotation.envelope.recovery_public_key === envelope.recovery_public_key;
              const material = usePendingRotation && pendingRotation
                ? pendingRotation
                : await createRecoveryMaterial(localKeyA, envelope);
              if (!usePendingRotation) await savePendingRecoveryKeyRotation(userID, material);
              if (!active) return;
              setKeySetupState({ status: "rotate", material });
              setKeySetupFor(userID);
              return;
            }
            setKeySetupState({ status: "ready" });
            setKeySetupFor(userID);
            return;
          }

          setKeySetupStage("loading_envelopes");
          const envelopes = await listKeyEnvelopes(activeSession);
          if (!active) return;
          const recoverableEnvelope = envelopes.find((envelope) => envelope.recovery_public_key.length > 0);
          if (recoverableEnvelope) {
            if (initialDraft && keyEnvelopeMatches(initialDraft.envelope, recoverableEnvelope)) {
              setKeySetupState({ status: "create", material: initialDraft });
            } else {
              setKeySetupState({ status: "recover", envelope: recoverableEnvelope });
            }
          } else {
            setKeySetupStage("generating");
            const material = initialDraft ?? await (async () => {
              return createInitialKeyMaterial();
            })();
            if (!material || !active) return;
            if (!initialDraft) await saveInitialKeyMaterialDraft(userID, material);
            if (!active) return;
            setKeySetupState({ status: "create", material });
          }
          setKeySetupFor(userID);
        })(), KEY_SETUP_TIMEOUT_MS, KEY_SETUP_TIMEOUT_MESSAGE);
      } catch (reason) {
        if (!active) return;
        active = false;
        setKeySetupState({
          status: "error",
          message: describeKeySetupError(reason, languageRef.current ?? "ja"),
        });
        setKeySetupFor(userID);
      }
    })();

    return () => {
      active = false;
    };
  }, [keySetupAttempt, languageLoaded, session?.session_id, session?.user_id]);

  if (!languageLoaded || status === "loading") {
    if (!authError) return <LoadingScreen />;

    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <MaterialIcons color={YELLOW} name="cloud-off" size={42} />
        <Text accessibilityRole="alert" style={styles.loadingText}>{authError}</Text>
        <Text style={styles.loadingHint}>
          接続を確認してから再試行してください。 / Check the connection and retry.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={restoreRetrying}
          onPress={() => void retryAuthRestore()}
          style={({ pressed }) => [
            styles.restoreRetryButton,
            restoreRetrying && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {restoreRetrying ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.restoreRetryButtonText}>再試行 / Retry</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={restoreRetrying}
          onPress={() => void clearBlockedAuth()}
          style={({ pressed }) => [
            styles.restoreSignOutButton,
            restoreRetrying && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.restoreSignOutButtonText}>ログアウト / Sign out</Text>
        </Pressable>
      </View>
    );
  }

  if (!language || !appMode) {
    return (
      <LanguageStep
        onContinue={async (selectedLanguage) => {
          const defaultMode = defaultAppMode(selectedLanguage);
          await saveLanguage(selectedLanguage);
          await saveAppMode(defaultMode);
          setLanguage(selectedLanguage);
          setAppMode(defaultMode);
          setAccountStepCompleted(false);
        }}
      />
    );
  }

  if (status !== "signed_in" || !session) {
    return (
      <AuthStep
        appMode={appMode}
        language={language}
        onAuthenticated={() => setAccountStepCompleted(true)}
        onBack={async () => {
          await clearLanguage();
          await clearAppMode();
          setLanguage(null);
          setAppMode(null);
          setAccountStepCompleted(false);
        }}
      />
    );
  }

  if (keySetupFor !== session.user_id || keySetupState.status === "loading") {
    const loadingText = language === "ja"
      ? keySetupStage === "loading_local"
        ? "端末の暗号鍵を確認しています…"
        : keySetupStage === "loading_envelopes"
          ? "サーバーの暗号鍵情報を確認しています…"
          : "暗号鍵を生成しています…"
      : keySetupStage === "loading_local"
        ? "Checking local encryption keys…"
        : keySetupStage === "loading_envelopes"
          ? "Checking server key information…"
          : "Generating encryption keys…";
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <LoadingSpinner color={BLUE} size={28} />
        <Text style={styles.loadingText}>
          {loadingText}
        </Text>
        {keySetupStage === "generating" ? (
          <Text style={styles.loadingHint}>
            {language === "ja" ? "端末によっては少し時間がかかります。" : "This may take a little longer on some devices."}
          </Text>
        ) : null}
      </View>
    );
  }

  if (keySetupState.status === "error") {
    return (
      <KeySetupError
        accountID={session.user_id}
        actionBusy={keySetupActionBusy}
        actionError={keySetupActionError}
        demo={session.account_type === "demo"}
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

  if (keySetupState.status === "demo-create") {
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
            // Demo registration is deliberately a different endpoint and a
            // different local storage namespace. It never creates a normal
            // /me/devices record or uploads a production Key-B envelope.
            await registerDemoDeviceKey(session, keySetupState.material);
            await saveDemoKeyMaterial(session.user_id, keySetupState.material);
            setKeySetupState({ status: "complete", mode: "initial" });
          } catch (reason) {
            setKeySetupState({
              status: "error",
              message: reason instanceof Error ? reason.message : "demo key setup failed",
            });
          } finally {
            setKeySetupBusy(false);
          }
        }}
        onDeleteAccount={session.account_type === "demo" ? undefined : deleteBlockedAccount}
        recoveryKey={keySetupState.material.recoveryKey}
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
            await ensureDeviceAgreementKey(session);
            deriveAccountDataKey(keySetupState.material.keyA, keySetupState.material.envelope.kdf_params.data_salt);
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
            deriveAccountDataKey(keyA, keySetupState.envelope.kdf_params.data_salt);
            const material = await createRecoveryMaterial(keyA, keySetupState.envelope);
            await savePendingRecoveryKeyRotation(session.user_id, material);
            setKeySetupState({ status: "rotate", material });
          } catch (reason) {
            setKeySetupState((current) => current.status === "recover"
              ? { ...current, error: reason instanceof Error ? reason.message : "Recovery Phraseの確認に失敗しました。" }
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
            await ensureDeviceAgreementKey(session);
            await completeRecoveryKeyRotation(session, keySetupState.material);
            setKeySetupState({ status: "complete", mode: "recovery" });
          } catch (reason) {
            setKeySetupState((current) => current.status === "rotate"
              ? { ...current, error: reason instanceof Error ? reason.message : "Recovery Phraseの更新に失敗しました。" }
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

  if (
    profileLoadedFor !== session.user_id ||
    identityVerificationChoiceLoadedFor !== session.user_id
  ) {
    return <LoadingScreen />;
  }

  if (!profile?.completed && !accountStepCompleted) {
    return (
      <AuthStep
        appMode={appMode}
        language={language}
        onAuthenticated={() => setAccountStepCompleted(true)}
        onBack={async () => {
          await clearLanguage();
          await clearAppMode();
          setLanguage(null);
          setAppMode(null);
          setAccountStepCompleted(false);
        }}
      />
    );
  }

  if (identityVerificationChoice === null) {
    const saveChoice = async (choice: Exclude<IdentityVerificationChoice, null>) => {
      await saveIdentityVerificationChoice(session.user_id, choice);
      setIdentityVerificationChoice(choice);

      if (profile) {
        const nextProfile = {
          ...profile,
          identityVerificationChoice: choice,
        };
        await saveLocalProfile(session.user_id, nextProfile);
        setProfile(nextProfile);
      }
    };

    return (
      <IdentityVerificationPrompt
        language={language}
        onLater={() => saveChoice("later")}
        onProceed={() => saveChoice("proceed")}
      />
    );
  }

  if (profile?.completed) {
    return <Redirect href={appMode === "local" ? "/japanese" : "/foreigner"} />;
  }

  return (
    <ProfileStep
      initialProfile={profile}
      language={language}
      onBack={async () => {
        await clearLanguage();
        await clearAppMode();
        setLanguage(null);
        setAppMode(null);
      }}
      onSubmit={async (nextProfile) => {
        const profileWithIdentityVerificationChoice = {
          ...nextProfile,
          identityVerificationChoice,
        };
        await refresh();
        const activeSession = getCurrentSession();
        if (!activeSession) {
          throw new Error("ログイン状態を確認できません。もう一度お試しください。");
        }
        await updateMyProfile(activeSession, {
          name: profileWithIdentityVerificationChoice.name,
          nationality_code: profileWithIdentityVerificationChoice.nationalityCode,
          bio: serializeMonsterSeedForLegacyBio(profileWithIdentityVerificationChoice),
        });
        await saveLocalProfile(
          activeSession.user_id,
          profileWithIdentityVerificationChoice,
        );
        setProfile(profileWithIdentityVerificationChoice);
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
  loadingHint: {
    marginTop: 6,
    color: MUTED_GRAY,
    fontSize: 12,
  },
  restoreRetryButton: {
    minWidth: 132,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: YELLOW,
  },
  restoreRetryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  restoreSignOutButton: {
    minWidth: 132,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 19,
    backgroundColor: "#ffffff",
  },
  restoreSignOutButtonText: {
    color: MUTED_GRAY,
    fontSize: 13,
    fontWeight: "800",
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
    width: "100%",
    height: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
  authLogoutButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 22,
    backgroundColor: "#ffffff",
  },
  authLogoutButtonText: {
    color: MUTED_GRAY,
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
    flexGrow: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  keySetupModalScrollView: {
    flex: 1,
    width: "100%",
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
