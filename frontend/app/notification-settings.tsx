import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Header, radius } from "../components/ui";
import type { ThemeColors } from "../components/ui/tokens";
import { useAuth } from "../hooks/useAuth";
import { useTheme, useThemeStyles } from "../hooks/useTheme";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../services/onboarding";
import { getPushSettings, requestPushToken, savePushSettings, type PushSettings } from "../services/push-notifications";

const DEFAULTS: PushSettings = {
  token: "",
  platform: Platform.OS === "android" ? "android" : "ios",
  enabled: true,
  chat_enabled: true,
  match_enabled: true,
  reminder_enabled: true,
};

const COPY: Record<AppLanguage, {
  title: string;
  description: string;
  push: string;
  chat: string;
  match: string;
  reminder: string;
  saving: string;
  permissionDenied: string;
  saveError: string;
  openSettings: string;
}> = {
  ja: {
    title: "通知設定",
    description: "チャットや承認、当日の予定を見逃さないよう、端末のプッシュ通知を設定できます。",
    push: "プッシュ通知",
    chat: "新着チャット",
    match: "応募・承認結果",
    reminder: "案内予定のリマインド",
    saving: "保存中...",
    permissionDenied: "通知が許可されていません。iOSの設定から通知を許可してください。",
    saveError: "通知設定を保存できませんでした。実機とサーバー設定を確認してください。",
    openSettings: "端末の設定を開く",
  },
  en: {
    title: "Notification settings",
    description: "Configure push notifications so you do not miss chats, application results, or upcoming plans.",
    push: "Push notifications",
    chat: "New chats",
    match: "Applications and decisions",
    reminder: "Plan reminders",
    saving: "Saving...",
    permissionDenied: "Notifications are not allowed. Enable them in your iOS settings.",
    saveError: "Notification settings could not be saved. Check the device and server settings.",
    openSettings: "Open device settings",
  },
};

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const { getCurrentSession, session } = useAuth();
  const [settings, setSettings] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
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
    void getPushSettings(activeSession).then(setSettings).catch(() => undefined);
  }, [getCurrentSession, session]);

  const update = async (patch: Partial<PushSettings>) => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || saving) return;
    setSaving(true);
    setError(null);
    try {
      let token = settings.token;
      if ((patch.enabled ?? settings.enabled) && !token) token = await requestPushToken();
      const next = { ...settings, ...patch, token };
      setSettings(await savePushSettings(activeSession, next));
    } catch (updateError) {
      const message = updateError instanceof Error && updateError.message === "notification_permission_denied"
        ? copy.permissionDenied
        : copy.saveError;
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="notifications-none" onBack={() => router.back()} title={copy.title} variant="hero" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.description}>{copy.description}</Text>
        <SettingRow label={copy.push} onValueChange={(value) => void update({ enabled: value })} value={settings.enabled} />
        <SettingRow disabled={!settings.enabled} label={copy.chat} onValueChange={(value) => void update({ chat_enabled: value })} value={settings.chat_enabled} />
        <SettingRow disabled={!settings.enabled} label={copy.match} onValueChange={(value) => void update({ match_enabled: value })} value={settings.match_enabled} />
        <SettingRow disabled={!settings.enabled} label={copy.reminder} onValueChange={(value) => void update({ reminder_enabled: value })} value={settings.reminder_enabled} />
        {saving ? <Text style={styles.saving}>{copy.saving}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {error ? <Pressable onPress={() => Linking.openSettings()} style={styles.settingsButton}><MaterialIcons color={colors.brand.sky} name="settings" size={19} /><Text style={styles.settingsButtonText}>{copy.openSettings}</Text></Pressable> : null}
      </ScrollView>
    </View>
  );
}

function SettingRow({ disabled = false, label, onValueChange, value }: { disabled?: boolean; label: string; onValueChange: (value: boolean) => void; value: boolean }) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <Text style={styles.label}>{label}</Text>
      <Switch disabled={disabled} onValueChange={onValueChange} trackColor={{ false: colors.border.default, true: colors.brand.sky }} value={value} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { padding: 22, gap: 10 },
  description: { marginBottom: 8, color: colors.text.secondary, fontSize: 14, lineHeight: 22 },
  row: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.md, backgroundColor: colors.surface.default },
  label: { flex: 1, color: colors.text.secondary, fontSize: 14, fontWeight: "800" },
  saving: { color: colors.text.muted, fontSize: 12, textAlign: "center" },
  error: { color: colors.state.danger, fontSize: 13, fontWeight: "700", lineHeight: 19, textAlign: "center" },
  settingsButton: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: colors.border.blue, borderRadius: radius.md },
  settingsButtonText: { color: colors.brand.sky, fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  });
}
