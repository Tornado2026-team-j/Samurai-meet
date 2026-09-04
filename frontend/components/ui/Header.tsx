import { MaterialIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ComponentProps, ReactNode } from "react";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, useThemeStyles } from "../../hooks/useTheme";
import { opacity, radius, spacing, typography, type ThemeColors } from "./tokens";

type HeaderVariant = "compact" | "default" | "hero";
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

type HeaderProps = {
  backAccessibilityLabel?: string;
  children?: ReactNode;
  iconName?: MaterialIconName;
  left?: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  subtitle?: string;
  subtitleStyle?: StyleProp<TextStyle>;
  title?: string;
  titleStyle?: StyleProp<TextStyle>;
  variant?: HeaderVariant;
};

export default function Header({
  backAccessibilityLabel = "Back",
  children,
  iconName,
  left,
  onBack,
  right,
  style,
  subtitle,
  subtitleStyle,
  title,
  titleStyle,
  variant = "default",
}: HeaderProps) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const insets = useSafeAreaInsets();
  const topPadding = variant === "compact"
    ? Math.max(insets.top, spacing.xl)
    : Math.max(insets.top, spacing["5xl"]);
  const actionTop = Math.max(
    insets.top + spacing.sm,
    variant === "hero" ? 49 : 45,
  );

  return (
    <View style={[styles.base, styles[variant], { paddingTop: topPadding }, style]}>
      <View style={[styles.actionLayer, { top: actionTop }]}>
        <View style={styles.sideSlot}>
          {left ?? (onBack ? (
            <Pressable
              accessibilityLabel={backAccessibilityLabel}
              accessibilityRole="button"
              hitSlop={10}
              onPress={onBack}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <MaterialIcons color={colors.text.onSky} name="chevron-left" size={30} />
            </Pressable>
          ) : null)}
        </View>
        <View style={styles.sideSlot}>{right}</View>
      </View>

      {iconName ? <MaterialIcons color={colors.text.onSky} name={iconName} size={42} /> : null}
      {title ? <Text accessibilityRole="header" style={[styles.title, titleStyle]}>{title}</Text> : null}
      {subtitle ? <Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  base: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: spacing["2xl"],
    paddingBottom: spacing["4xl"],
    borderBottomLeftRadius: radius.header,
    borderBottomRightRadius: radius.header,
    backgroundColor: colors.brand.sky,
  },
  compact: {
    minHeight: 104,
    paddingBottom: spacing.lg,
    alignItems: "flex-start",
  },
  default: {
    minHeight: 156,
  },
  hero: {
    minHeight: 214,
  },
  actionLayer: {
    position: "absolute",
    right: spacing.lg,
    left: spacing.lg,
    zIndex: 1,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sideSlot: {
    minWidth: 34,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...typography.hero,
    marginTop: spacing.xl,
    color: colors.text.onSky,
    textAlign: "center",
  },
  subtitle: {
    ...typography.caption,
    marginTop: spacing.sm,
    color: colors.text.onSky,
    textAlign: "center",
  },
  pressed: {
    opacity: opacity.pressed,
  },
  });
}
