import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Header, radius } from "../components/ui";
import type { ThemeColors } from "../components/ui/tokens";
import { useAuth } from "../hooks/useAuth";
import { useTheme, useThemeStyles } from "../hooks/useTheme";
import { createIdentityVerificationSession } from "../services/identity";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../services/onboarding";
import { getMyProfile } from "../services/profile";

const COPY: Record<AppLanguage, {
  title: string;
  heading: string;
  body: string;
  status: string;
  verified: string;
  pending: string;
  rejected: string;
  unverified: string;
  preparing: string;
  start: string;
  caution: string;
  error: string;
}> = {
  ja: {
    title: "本人確認",
    heading: "安心して会うための本人確認",
    body: "公的な本人確認書類と顔写真をStripe Identityで確認します。書類や正確な住所は他のユーザーに公開されません。",
    status: "現在の状態",
    verified: "確認済み",
    pending: "確認中",
    rejected: "再確認が必要",
    unverified: "未確認",
    preparing: "準備中...",
    start: "Stripeで本人確認を始める",
    caution: "本人確認済み表示は、相手の安全性を保証するものではありません。",
    error: "本人確認を開始できませんでした。サーバーのStripe設定を確認してください。",
  },
  en: {
    title: "Identity verification",
    heading: "Verify your identity for safer meetings",
    body: "Stripe Identity checks your government-issued ID and selfie. Your documents and precise address are not shown to other users.",
    status: "Current status",
    verified: "Verified",
    pending: "Pending",
    rejected: "Verification required again",
    unverified: "Not verified",
    preparing: "Preparing...",
    start: "Start verification with Stripe",
    caution: "A verification badge does not guarantee another person's safety.",
    error: "Identity verification could not be started. Check the server's Stripe configuration.",
  },
};

export default function IdentityVerificationScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const { getCurrentSession, session } = useAuth();
  const [identityStatus, setIdentityStatus] = useState("unverified");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const copy = COPY[language];

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
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;
    void getMyProfile(activeSession).then((profile) => setIdentityStatus(profile.identity_status)).catch(() => undefined);
  }, [getCurrentSession, session]);

  const begin = async () => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || loading) return;
    setLoading(true);
    setError(null);
    try {
      const url = await createIdentityVerificationSession(activeSession);
      await Linking.openURL(url);
    } catch {
      setError(copy.error);
    } finally {
      setLoading(false);
    }
  };

  const statusLabel = identityStatus === "verified" ? copy.verified : identityStatus === "pending" ? copy.pending : identityStatus === "rejected" ? copy.rejected : copy.unverified;
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="verified-user" onBack={() => router.back()} title={copy.title} variant="hero" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.icon}><MaterialIcons color={colors.brand.sky} name="verified-user" size={54} /></View>
        <Text style={styles.title}>{copy.heading}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        <View style={styles.statusRow}><Text style={styles.statusLabel}>{copy.status}</Text><Text style={styles.status}>{statusLabel}</Text></View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {identityStatus !== "verified" ? <Pressable disabled={loading} onPress={() => void begin()} style={[styles.button, loading && styles.disabled]}><Text style={styles.buttonText}>{loading ? copy.preparing : copy.start}</Text></Pressable> : null}
        <Text style={styles.caution}>{copy.caution}</Text>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { alignItems: "center", padding: 24, paddingBottom: 48 },
  icon: { width: 96, height: 96, alignItems: "center", justifyContent: "center", borderRadius: 48, backgroundColor: colors.surface.blueSoft },
  title: { marginTop: 20, color: colors.text.primary, fontSize: 21, fontWeight: "900", textAlign: "center" },
  body: { marginTop: 10, color: colors.text.secondary, fontSize: 14, lineHeight: 22, textAlign: "center" },
  statusRow: { width: "100%", marginTop: 24, flexDirection: "row", justifyContent: "space-between", padding: 16, borderRadius: radius.md, backgroundColor: colors.surface.subtle },
  statusLabel: { color: colors.text.secondary, fontSize: 14, fontWeight: "700" },
  status: { color: colors.brand.sky, fontSize: 14, fontWeight: "900" },
  button: { width: "100%", minHeight: 50, marginTop: 18, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.brand.sky },
  buttonText: { color: colors.text.inverse, fontSize: 15, fontWeight: "900" },
  caution: { marginTop: 16, color: colors.text.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  error: { marginTop: 14, color: colors.state.danger, fontSize: 13, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.5 },
  });
}
