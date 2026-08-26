import { useEffect, useState, type ReactNode } from "react";
import { FontAwesome, MaterialIcons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import IdentityVerificationPrompt from "../components/IdentityVerificationPrompt";
import ProfileForm from "../components/ProfileForm";
import { useAuth } from "../hooks/useAuth";
import {
  clearLanguage,
  loadIdentityVerificationChoice,
  loadLanguage,
  loadLocalProfile,
  saveIdentityVerificationChoice,
  saveLanguage,
  saveLocalProfile,
  type AppLanguage,
  type IdentityVerificationChoice,
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
  onAuthenticated: () => void;
  onBack: () => Promise<void>;
};

function AuthStep({ language, onAuthenticated, onBack }: AuthStepProps) {
  const { continuePasskey, error, login, preAuth, status } = useAuth();
  const passkeyReady = status === "pre_auth" && preAuth !== null;
  const signedIn = status === "signed_in";
  const busy = status === "loading";
  const copy = language === "ja"
    ? {
        title: signedIn
          ? "アカウント登録完了"
          : passkeyReady
            ? "Passkeyを設定"
            : "アカウントを作成",
        subtitle: signedIn
          ? "Googleアカウントの確認が完了しました。次に本人確認へ進みます。"
          : passkeyReady
          ? "Google認証が完了しました。続けてこの端末を保護します。"
          : "Googleアカウントで安全に登録・ログインできます。",
        continue: "次へ",
        google: "Googleで続ける",
        passkey: preAuth?.passkey_registered ? "Passkeyで本人確認" : "Passkeyを登録",
        googleDone: "Google認証済み",
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
          ? "Your Google account is verified. Next, review identity verification."
          : passkeyReady
          ? "Google verification is complete. Now protect this device."
          : "Sign up or sign in securely with your Google account.",
        continue: "Continue",
        google: "Continue with Google",
        passkey: preAuth?.passkey_registered ? "Verify with passkey" : "Create a passkey",
        googleDone: "Google verified",
        privacy: "Your email is used only to verify your account",
        passkeyNote: "Passkeys use your device screen lock, so there is no password to store",
      };
  const runPrimaryAction = async () => {
    if (signedIn) {
      onAuthenticated();
      return;
    }

    if (passkeyReady) {
      await continuePasskey();
    } else {
      await login();
    }

    onAuthenticated();
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.stepScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Hero onBack={() => void onBack()}>
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
                <View style={styles.googleMarkSmall}>
                  <FontAwesome color="#4285f4" name="google" size={19} />
                </View>
                <Text style={styles.completedText}>{copy.googleDone}</Text>
                <MaterialIcons color="#3d9a68" name="check-circle" size={22} />
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void runPrimaryAction()}
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
  const { session, status } = useAuth();
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [identityVerificationChoice, setIdentityVerificationChoice] =
    useState<IdentityVerificationChoice>(null);
  const [accountStepCompleted, setAccountStepCompleted] = useState(false);
  const [languageLoaded, setLanguageLoaded] = useState(false);
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);
  const [identityVerificationChoiceLoadedFor, setIdentityVerificationChoiceLoadedFor] =
    useState<string | null>(null);

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
    void Promise.all([
      loadLocalProfile(userID),
      loadIdentityVerificationChoice(userID),
    ]).then(([storedProfile, storedIdentityVerificationChoice]) => {
      if (active) {
        setProfile(storedProfile);
        setIdentityVerificationChoice(
          storedIdentityVerificationChoice ??
            storedProfile?.identityVerificationChoice ??
            null,
        );
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
          setAccountStepCompleted(false);
        }}
      />
    );
  }

  if (status !== "signed_in" || !session) {
    return (
      <AuthStep
        language={language}
        onAuthenticated={() => setAccountStepCompleted(true)}
        onBack={async () => {
          await clearLanguage();
          setLanguage(null);
          setAccountStepCompleted(false);
        }}
      />
    );
  }

  if (
    profileLoadedFor !== session.user_id ||
    identityVerificationChoiceLoadedFor !== session.user_id
  ) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={BLUE} size="large" />
      </View>
    );
  }

  if (!profile?.completed && !accountStepCompleted) {
    return (
      <AuthStep
        language={language}
        onAuthenticated={() => setAccountStepCompleted(true)}
        onBack={async () => {
          await clearLanguage();
          setLanguage(null);
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
        const profileWithIdentityVerificationChoice = {
          ...nextProfile,
          identityVerificationChoice,
        };
        await saveLocalProfile(
          session.user_id,
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
