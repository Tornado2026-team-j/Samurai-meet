import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import type {
  GestureResponderEvent,
  PressableProps,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import type { ReactNode } from "react";
import { useTheme, useThemeStyles } from "../../hooks/useTheme";
import { opacity, radius, shadows, spacing, typography, type ThemeColors } from "./tokens";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = Omit<PressableProps, "children" | "onPress" | "style"> & {
  children: ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  size?: ButtonSize;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  variant?: ButtonVariant;
};

export default function Button({
  accessibilityRole = "button",
  children,
  disabled = false,
  fullWidth = false,
  iconLeft,
  iconRight,
  loading = false,
  onPress,
  size = "md",
  style,
  textStyle,
  variant = "primary",
  ...pressableProps
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const inactive = disabled || loading;
  const spinnerColor = variant === "primary" || variant === "danger"
    ? variant === "primary" ? colors.text.onGold : colors.text.inverse
    : colors.brand.gold;

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        styles[variant],
        fullWidth && styles.fullWidth,
        style,
        inactive && styles.disabled,
        pressed && styles.pressed,
      ]}
      {...pressableProps}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : (
        <>
          {iconLeft}
          {typeof children === "string" ? (
            <Text style={[styles.text, styles[`${variant}Text`], styles[`${size}Text`], textStyle]}>
              {children}
            </Text>
          ) : (
            children
          )}
          {iconRight}
        </>
      )}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  base: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    ...shadows.action,
  },
  sm: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  md: {
    minHeight: 46,
  },
  lg: {
    minHeight: 54,
    paddingHorizontal: spacing.xl,
  },
  primary: {
    backgroundColor: colors.brand.gold,
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.default,
  },
  ghost: {
    backgroundColor: "transparent",
    boxShadow: "none",
  },
  danger: {
    backgroundColor: colors.border.dangerStrong,
  },
  text: {
    ...typography.captionStrong,
    textAlign: "center",
  },
  smText: {
    ...typography.small,
  },
  mdText: {
    ...typography.captionStrong,
  },
  lgText: {
    ...typography.bodyStrong,
    fontWeight: "800",
  },
  primaryText: {
    color: colors.text.onGold,
  },
  secondaryText: {
    color: colors.text.secondary,
  },
  ghostText: {
    color: colors.text.secondary,
  },
  dangerText: {
    color: colors.text.inverse,
  },
  fullWidth: {
    width: "100%",
  },
  disabled: {
    opacity: opacity.disabled,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  });
}
