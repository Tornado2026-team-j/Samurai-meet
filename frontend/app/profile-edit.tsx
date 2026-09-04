import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import ProfileForm from "../components/ProfileForm";
import { Header, spacing, typography } from "../components/ui";
import type { ThemeColors } from "../components/ui/tokens";
import { useAuth } from "../hooks/useAuth";
import { useThemeStyles } from "../hooks/useTheme";
import {
  loadLanguage,
  loadLocalProfile,
  saveLocalProfile,
  serializeMonsterSeedForLegacyBio,
  subscribeLanguage,
  type AppLanguage,
  type LocalProfile,
} from "../services/onboarding";
import { updateMyProfile } from "../services/profile";

const COPY = {
  ja: {
    title: "プロフィール編集",
    description: "表示名、国籍、好きなこと・得意なことを更新できます。思い出キャラクターは案内終了後に作成します。",
    save: "変更を保存",
    saved: "プロフィールを更新しました。",
  },
  en: {
    title: "Edit profile",
    description: "Update your display name, nationality, interests, and skills.",
    save: "Save changes",
    saved: "Your profile was updated.",
  },
} as const;

export default function ProfileEditScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const { getCurrentSession, session } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const copy = COPY[language];

  useEffect(() => {
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (nextLanguage) setLanguage(nextLanguage);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;
    void Promise.all([loadLanguage(), loadLocalProfile(activeSession.user_id)]).then(([storedLanguage, storedProfile]) => {
      setLanguage(storedLanguage ?? "ja");
      setProfile(storedProfile);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [getCurrentSession, session]);

  const save = async (nextProfile: LocalProfile) => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) throw new Error("session is missing");
    await updateMyProfile(activeSession, {
      name: nextProfile.name,
      nationality_code: nextProfile.nationalityCode,
      bio: serializeMonsterSeedForLegacyBio(nextProfile),
    });
    await saveLocalProfile(activeSession.user_id, nextProfile);
    setProfile(nextProfile);
    setSaved(true);
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="manage-accounts" onBack={() => router.back()} title={copy.title} variant="hero" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.description}>{copy.description}</Text>
        {saved ? <Text accessibilityLiveRegion="polite" style={styles.saved}>{copy.saved}</Text> : null}
        {loaded ? <ProfileForm initialProfile={profile} language={language} onSubmit={save} submitLabel={copy.save} /> : null}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { padding: spacing.xl, paddingBottom: 110, gap: spacing.lg },
  description: { color: colors.text.secondary, ...typography.body, lineHeight: 23 },
  saved: { color: colors.state.success, ...typography.caption, textAlign: "center" },
  });
}
