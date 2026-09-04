import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Header, LoadingSpinner, colors, radius } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../services/onboarding";
import { listBlockedUsers, unblockUser, type BlockedUser } from "../services/safety";

const COPY: Record<AppLanguage, {
  title: string;
  empty: string;
  user: string;
  unblock: string;
  unblocking: string;
  loadError: string;
  unblockError: string;
}> = {
  ja: {
    title: "ブロック中のユーザー",
    empty: "ブロック中のユーザーはいません",
    user: "ユーザー",
    unblock: "解除",
    unblocking: "解除中",
    loadError: "ブロック一覧を読み込めませんでした。",
    unblockError: "ブロックを解除できませんでした。",
  },
  en: {
    title: "Blocked users",
    empty: "No blocked users",
    user: "User",
    unblock: "Unblock",
    unblocking: "Unblocking",
    loadError: "The blocked-user list could not be loaded.",
    unblockError: "The user could not be unblocked.",
  },
};

export default function BlockedUsersScreen() {
  const router = useRouter();
  const { getCurrentSession, session } = useAuth();
  const [items, setItems] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await listBlockedUsers(activeSession));
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, getCurrentSession, session]);

  useEffect(() => { void load(); }, [load]);

  const unblock = async (item: BlockedUser) => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || busyId) return;
    setBusyId(item.user_id);
    try {
      await unblockUser(item.user_id, activeSession);
      setItems((current) => current.filter((candidate) => candidate.user_id !== item.user_id));
    } catch {
      setError(copy.unblockError);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="block" onBack={() => router.back()} title={copy.title} variant="hero" />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <LoadingSpinner color={colors.brand.sky} size={24} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loading && items.length === 0 ? <Text style={styles.empty}>{copy.empty}</Text> : null}
        {items.map((item) => (
          <View key={item.user_id} style={styles.row}>
            <MaterialIcons color={colors.text.muted} name="account-circle" size={40} />
            <Text style={styles.name}>{item.name || copy.user}</Text>
            <Pressable disabled={busyId === item.user_id} onPress={() => void unblock(item)} style={styles.unblock}>
              <Text style={styles.unblockText}>{busyId === item.user_id ? copy.unblocking : copy.unblock}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { padding: 20, gap: 10 },
  row: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.md, backgroundColor: colors.surface.default },
  name: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: "800" },
  unblock: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border.default, borderRadius: radius.pill },
  unblockText: { color: colors.brand.sky, fontSize: 13, fontWeight: "800" },
  empty: { marginTop: 80, color: colors.text.muted, fontSize: 14, textAlign: "center" },
  error: { color: colors.state.danger, fontSize: 13, fontWeight: "700", textAlign: "center" },
});
