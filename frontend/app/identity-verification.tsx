import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Header, colors, radius } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { createIdentityVerificationSession } from "../services/identity";
import { getMyProfile } from "../services/profile";

export default function IdentityVerificationScreen() {
  const router = useRouter();
  const { getCurrentSession, session } = useAuth();
  const [identityStatus, setIdentityStatus] = useState("unverified");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError("本人確認を開始できませんでした。サーバーのStripe設定を確認してください。");
    } finally {
      setLoading(false);
    }
  };

  const statusLabel = identityStatus === "verified" ? "確認済み" : identityStatus === "pending" ? "確認中" : identityStatus === "rejected" ? "再確認が必要" : "未確認";
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="verified-user" onBack={() => router.back()} title="本人確認" variant="hero" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.icon}><MaterialIcons color={colors.brand.sky} name="verified-user" size={54} /></View>
        <Text style={styles.title}>安心して会うための本人確認</Text>
        <Text style={styles.body}>公的な本人確認書類と顔写真をStripe Identityで確認します。書類や正確な住所は他のユーザーに公開されません。</Text>
        <View style={styles.statusRow}><Text style={styles.statusLabel}>現在の状態</Text><Text style={styles.status}>{statusLabel}</Text></View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {identityStatus !== "verified" ? <Pressable disabled={loading} onPress={() => void begin()} style={[styles.button, loading && styles.disabled]}><Text style={styles.buttonText}>{loading ? "準備中..." : "Stripeで本人確認を始める"}</Text></Pressable> : null}
        <Text style={styles.caution}>本人確認済み表示は、相手の安全性を保証するものではありません。</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
