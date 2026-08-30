import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Header, colors, opacity, radius, spacing, typography } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../services/onboarding";
import {
  listPasskeys,
  listSessions,
  removePasskey,
  revokeOtherSessions,
  revokeSession,
  type PasskeySummary,
  type SessionSummary,
} from "../services/security";

const COPY = {
  ja: {
    title: "セキュリティ",
    description: "ログイン中の端末とPasskeyを管理できます。心当たりのない端末はログアウトしてください。",
    sessions: "ログイン中の端末",
    passkeys: "Passkey",
    current: "この端末",
    unnamedDevice: "端末名なし",
    lastSeen: "最終利用",
    created: "登録日",
    revoke: "ログアウト",
    remove: "削除",
    lastPasskey: "アカウントへ入れなくなるため、最後のPasskeyは削除できません。",
    removeTitle: "このPasskeyを削除しますか？",
    removeMessage: "Passkeyで本人確認した後に削除します。",
    cancel: "キャンセル",
    confirm: "削除する",
    loading: "セキュリティ情報を読み込み中...",
    empty: "登録情報はありません",
    loadError: "セキュリティ情報を読み込めませんでした。",
    actionError: "操作を完了できませんでした。もう一度お試しください。",
    retry: "再試行",
    revokeOthers: "この端末以外を一斉ログアウト",
    revokeOthersTitle: "この端末以外をログアウトしますか？",
    revokeOthersMessage: "現在の端末はログインしたまま、他のすべての端末をログアウトします。",
    revokeOthersConfirm: "ログアウトする",
    revokeOthersDone: "この端末以外をログアウトしました。",
  },
  en: {
    title: "Security",
    description: "Manage signed-in devices and Passkeys. Sign out any device you do not recognize.",
    sessions: "Signed-in devices",
    passkeys: "Passkeys",
    current: "This device",
    unnamedDevice: "Unnamed device",
    lastSeen: "Last active",
    created: "Added",
    revoke: "Sign out",
    remove: "Remove",
    lastPasskey: "The last Passkey cannot be removed because it is required to access your account.",
    removeTitle: "Remove this Passkey?",
    removeMessage: "You will confirm with a Passkey before it is removed.",
    cancel: "Cancel",
    confirm: "Remove",
    loading: "Loading security details...",
    empty: "No registrations found",
    loadError: "Security details could not be loaded.",
    actionError: "The action could not be completed. Please try again.",
    retry: "Retry",
    revokeOthers: "Sign out all other devices",
    revokeOthersTitle: "Sign out all other devices?",
    revokeOthersMessage: "This keeps the current device signed in and signs out every other device.",
    revokeOthersConfirm: "Sign out devices",
    revokeOthersDone: "All other devices were signed out.",
  },
} as const;

function formatDate(value: string, language: AppLanguage): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === "ja" ? "ja-JP" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function SecurityScreen() {
  const router = useRouter();
  const { continuePasskey, getCurrentSession, session } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const copy = COPY[language];

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => { if (active) setLanguage(nextLanguage ?? "ja"); });
    void loadLanguage().then((value) => { if (active) setLanguage(value ?? "ja"); }).catch(() => { if (active) setLanguage("ja"); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [nextSessions, nextPasskeys] = await Promise.all([
        listSessions(activeSession),
        listPasskeys(activeSession),
      ]);
      setSessions(nextSessions);
      setPasskeys(nextPasskeys);
    } catch {
      setError(COPY[language].loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getCurrentSession, language, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (item: SessionSummary) => {
    if (item.current || busyId) return;
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;
    setBusyId(item.id);
    setError(null);
    try {
      await revokeSession(item.id, activeSession);
      setSessions((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch {
      setError(copy.actionError);
    } finally {
      setBusyId(null);
    }
  };

  const confirmRevokeOtherSessions = () => {
    if (busyId) return;
    Alert.alert(copy.revokeOthersTitle, copy.revokeOthersMessage, [
      { text: copy.cancel, style: "cancel" },
      { text: copy.revokeOthersConfirm, style: "destructive", onPress: () => void revokeOtherSessionsNow() },
    ]);
  };

  const revokeOtherSessionsNow = async () => {
    if (busyId) return;
    setBusyId("other-sessions");
    setError(null);
    setNotice(null);
    try {
      const verified = await continuePasskey(language);
      const activeSession = getCurrentSession() ?? session;
      if (!verified || !activeSession) throw new Error("passkey reauthentication failed");
      await revokeOtherSessions(activeSession);
      setSessions((current) => current.filter((item) => item.current));
      setNotice(copy.revokeOthersDone);
    } catch {
      setError(copy.actionError);
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemovePasskey = (item: PasskeySummary) => {
    if (passkeys.length <= 1 || busyId) return;
    Alert.alert(copy.removeTitle, copy.removeMessage, [
      { text: copy.cancel, style: "cancel" },
      { text: copy.confirm, style: "destructive", onPress: () => void remove(item) },
    ]);
  };

  const remove = async (item: PasskeySummary) => {
    setBusyId(item.credential_id);
    setError(null);
    try {
      const verified = await continuePasskey(language);
      const activeSession = getCurrentSession() ?? session;
      if (!verified || !activeSession) throw new Error("passkey reauthentication failed");
      await removePasskey(item.credential_id, activeSession);
      setPasskeys((current) => current.filter((candidate) => candidate.credential_id !== item.credential_id));
    } catch {
      setError(copy.actionError);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="security" onBack={() => router.back()} title={copy.title} variant="hero" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.brand.sky} />}
      >
        <Text style={styles.description}>{copy.description}</Text>
        {loading ? <View style={styles.state}><ActivityIndicator color={colors.brand.sky} /><Text style={styles.stateText}>{copy.loading}</Text></View> : null}
        {!loading ? (
          <>
            <SectionTitle icon="devices" title={copy.sessions} />
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(busyId)}
              onPress={confirmRevokeOtherSessions}
              style={({ pressed }) => [styles.bulkAction, Boolean(busyId) && styles.disabled, pressed && !busyId && styles.pressed]}
            >
              {busyId === "other-sessions" ? <ActivityIndicator color={colors.state.danger} size="small" /> : <Text style={styles.bulkActionText}>{copy.revokeOthers}</Text>}
            </Pressable>
            {sessions.length === 0 ? <Text style={styles.empty}>{copy.empty}</Text> : sessions.map((item) => (
              <View key={item.id} style={styles.item}>
                <View style={styles.itemBody}>
                  <View style={styles.itemTitleRow}>
                    <Text style={styles.itemTitle}>{item.device_name || copy.unnamedDevice}</Text>
                    {item.current ? <Text style={styles.currentBadge}>{copy.current}</Text> : null}
                  </View>
                  <Text style={styles.meta}>{copy.lastSeen}: {formatDate(item.last_seen_at, language)}</Text>
                  <Text numberOfLines={1} style={styles.id}>{item.id}</Text>
                </View>
                {!item.current ? <ActionButton busy={busyId === item.id} label={copy.revoke} onPress={() => void revoke(item)} /> : null}
              </View>
            ))}

            <SectionTitle icon="key" title={copy.passkeys} />
            {passkeys.length === 0 ? <Text style={styles.empty}>{copy.empty}</Text> : passkeys.map((item, index) => (
              <View key={item.credential_id} style={styles.item}>
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle}>Passkey {index + 1}</Text>
                  <Text style={styles.meta}>{copy.created}: {formatDate(item.created_at, language)}</Text>
                  <Text numberOfLines={1} style={styles.id}>{item.credential_id}</Text>
                </View>
                <ActionButton
                  busy={busyId === item.credential_id}
                  disabled={passkeys.length <= 1}
                  label={copy.remove}
                  onPress={() => confirmRemovePasskey(item)}
                />
              </View>
            ))}
            {passkeys.length === 1 ? <Text style={styles.note}>{copy.lastPasskey}</Text> : null}
          </>
        ) : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {error && !loading ? <Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{copy.retry}</Text></Pressable> : null}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ icon, title }: { icon: "devices" | "key"; title: string }) {
  return <View style={styles.sectionTitle}><MaterialIcons color={colors.brand.sky} name={icon} size={22} /><Text style={styles.sectionTitleText}>{title}</Text></View>;
}

function ActionButton({ busy, disabled = false, label, onPress }: { busy: boolean; disabled?: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable disabled={busy || disabled} onPress={onPress} style={({ pressed }) => [styles.action, (busy || disabled) && styles.disabled, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={colors.state.danger} size="small" /> : <Text style={styles.actionText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { padding: spacing.xl, paddingBottom: 130, gap: spacing.md },
  description: { color: colors.text.secondary, ...typography.body, lineHeight: 23 },
  state: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.md },
  stateText: { color: colors.text.subtle, ...typography.caption },
  sectionTitle: { marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitleText: { color: colors.text.primary, ...typography.heading },
  item: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  itemBody: { flex: 1, gap: spacing.xs },
  itemTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  itemTitle: { flexShrink: 1, color: colors.text.primary, ...typography.bodyStrong },
  currentBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radius.pill, backgroundColor: colors.surface.blueSoft, color: colors.brand.sky, ...typography.smallStrong },
  meta: { color: colors.text.subtle, ...typography.small },
  id: { color: colors.text.muted, ...typography.micro },
  action: { minWidth: 78, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border.danger, borderRadius: radius.pill, backgroundColor: colors.surface.default },
  actionText: { color: colors.state.danger, ...typography.captionStrong },
  bulkAction: { minHeight: 46, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border.danger, borderRadius: radius.pill, backgroundColor: colors.surface.default },
  bulkActionText: { color: colors.state.danger, ...typography.captionStrong },
  note: { color: colors.text.subtle, ...typography.small, lineHeight: 18 },
  empty: { paddingVertical: spacing.xl, color: colors.text.muted, ...typography.caption, textAlign: "center" },
  error: { color: colors.state.danger, ...typography.caption, textAlign: "center" },
  notice: { color: colors.state.success, ...typography.caption, textAlign: "center" },
  retry: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.brand.sky },
  retryText: { color: colors.text.inverse, ...typography.captionStrong },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: opacity.pressed },
});
