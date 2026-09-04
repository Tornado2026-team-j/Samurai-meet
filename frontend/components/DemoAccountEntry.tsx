import { MaterialIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppLanguage } from "../services/onboarding";
import { useTheme, useThemeStyles } from "../hooks/useTheme";
import { opacity, radius, spacing, typography, type ThemeColors } from "./ui/tokens";

type DemoAccountEntryProps = {
  language: AppLanguage;
  onPress: () => void;
  disabled?: boolean;
};

/**
 * Presentation-only entry for the review/demo account flow.
 * The caller owns account creation; this component has no mock state or API
 * fallback so it can be reused when the real temporary-account flow is wired.
 */
export default function DemoAccountEntry({ language, onPress, disabled = false }: DemoAccountEntryProps) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const copy = language === "ja"
    ? { title: "デモを体験する", note: "登録不要・24時間の審査用アカウント" }
    : { title: "Try the demo", note: "No sign-up · 24-hour review account" };

  return (
    <Pressable
      accessibilityLabel={copy.title}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.entry,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID="demo-account-entry"
    >
      <View style={styles.icon}>
        <MaterialIcons color={colors.brand.sky} name="play-arrow" size={23} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.note}>{copy.note}</Text>
      </View>
      <MaterialIcons color={colors.text.muted} name="chevron-right" size={22} />
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  entry: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 3,
    borderWidth: 1,
    borderColor: colors.border.blue,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.blueSoft,
  },
  icon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surface.default,
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    color: colors.text.primary,
    ...typography.captionStrong,
  },
  note: {
    color: colors.text.muted,
    ...typography.micro,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  });
}
