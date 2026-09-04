import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Header } from "../components/ui";
import { useTheme } from "../hooks/useTheme";
import {
  loadLanguage,
  subscribeLanguage,
  type AppLanguage,
} from "../services/onboarding";
import type { ThemePreference } from "../services/theme";

const COPY = {
  ja: {
    title: "テーマ",
    back: "戻る",
    description: "アプリの表示テーマを選べます。初期設定では端末の設定に合わせます。",
    system: "端末の設定",
    systemDescription: "端末のダークモード設定に合わせる",
    light: "ライト",
    lightDescription: "常に明るい配色を使う",
    dark: "ダーク",
    darkDescription: "常に暗い配色を使う",
    saveError: "テーマ設定を保存できませんでした。もう一度お試しください。",
  },
  en: {
    title: "Theme",
    back: "Back",
    description: "Choose how the app looks. The default follows your device setting.",
    system: "Device setting",
    systemDescription: "Follow your device's dark mode setting",
    light: "Light",
    lightDescription: "Always use the light theme",
    dark: "Dark",
    darkDescription: "Always use the dark theme",
    saveError: "The theme setting could not be saved. Please try again.",
  },
} as const;

const OPTIONS: {
  key: ThemePreference;
  icon: "brightness-auto" | "light-mode" | "dark-mode";
}[] = [
  { key: "system", icon: "brightness-auto" },
  { key: "light", icon: "light-mode" },
  { key: "dark", icon: "dark-mode" },
];

export default function ThemeSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isLoading, preference, setPreference } = useTheme();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const copy = COPY[language];

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active && nextLanguage) setLanguage(nextLanguage);
    });
    void loadLanguage().then((storedLanguage) => {
      if (active && storedLanguage) setLanguage(storedLanguage);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const labels: Record<ThemePreference, { title: string; description: string }> = {
    system: { title: copy.system, description: copy.systemDescription },
    light: { title: copy.light, description: copy.lightDescription },
    dark: { title: copy.dark, description: copy.darkDescription },
  };

  const handleSelect = async (nextPreference: ThemePreference) => {
    if (nextPreference === preference || saving || isLoading) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await setPreference(nextPreference);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.screen }]}>
      <StatusBar style="light" />
      <Header
        backAccessibilityLabel={copy.back}
        iconName="brightness-6"
        onBack={() => router.back()}
        style={{ backgroundColor: colors.brand.sky }}
        title={copy.title}
        variant="compact"
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 24, 40) },
        ]}
      >
        <Text style={[styles.description, { color: colors.text.secondary }]}>{copy.description}</Text>
        <View style={styles.options}>
          {OPTIONS.map(({ icon, key }) => {
            const selected = key === preference;
            const label = labels[key];
            return (
              <Pressable
                key={key}
                accessibilityLabel={label.title}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: saving || isLoading }}
                disabled={saving || isLoading}
                onPress={() => void handleSelect(key)}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: selected ? colors.surface.blueSoft : colors.surface.default,
                    borderColor: selected ? colors.brand.sky : colors.border.subtle,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.icon, { backgroundColor: selected ? colors.brand.sky : colors.surface.subtle }]}>
                  <MaterialIcons color={selected ? colors.text.inverse : colors.text.secondary} name={icon} size={22} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={[styles.optionTitle, { color: colors.text.primary }]}>{label.title}</Text>
                  <Text style={[styles.optionDescription, { color: colors.text.secondary }]}>{label.description}</Text>
                </View>
                <MaterialIcons
                  color={selected ? colors.brand.sky : colors.text.muted}
                  name={selected ? "radio-button-checked" : "radio-button-unchecked"}
                  size={23}
                />
              </Pressable>
            );
          })}
        </View>
        {saveFailed ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.state.danger }]}>{copy.saveError}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 22,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
  },
  options: {
    gap: 12,
  },
  option: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: 16,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  optionCopy: {
    flex: 1,
    gap: 3,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  optionDescription: {
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.72,
  },
});
