import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  GestureResponderEvent,
  PressableProps,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import type { ReactNode } from "react";
import { colors, opacity, radius, shadows, spacing, typography } from "./tokens";

type PillVariant = "neutral" | "primary" | "accent" | "danger";

type PillProps = {
  accessibilityLabel?: string;
  accessibilityRole?: PressableProps["accessibilityRole"];
  accessibilityState?: PressableProps["accessibilityState"];
  children: ReactNode;
  disabled?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  variant?: PillVariant;
};

export default function Pill({
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  children,
  disabled = false,
  iconLeft,
  iconRight,
  onPress,
  selected = false,
  style,
  textStyle,
  variant = "neutral",
}: PillProps) {
  const content = (
    <>
      {iconLeft}
      {typeof children === "string" ? (
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          numberOfLines={1}
          style={[
            styles.text,
            styles[`${variant}Text`],
            selected && styles.selectedText,
            textStyle,
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
      {iconRight}
    </>
  );
  const pillStyle = [
    styles.base,
    styles[variant],
    style,
    selected && styles.selected,
    disabled && styles.disabled,
  ];

  if (!onPress) {
    return <View style={pillStyle}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pillStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.default,
  },
  neutral: {
    borderColor: colors.border.default,
  },
  primary: {
    borderColor: colors.brand.sky,
  },
  accent: {
    borderColor: colors.brand.gold,
  },
  danger: {
    borderColor: colors.border.danger,
    backgroundColor: colors.surface.dangerSoft,
  },
  selected: {
    borderColor: colors.brand.gold,
    backgroundColor: colors.brand.gold,
    ...shadows.action,
  },
  text: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  neutralText: {
    color: colors.text.secondary,
  },
  primaryText: {
    color: colors.text.secondary,
  },
  accentText: {
    color: colors.text.secondary,
  },
  dangerText: {
    color: colors.state.danger,
  },
  selectedText: {
    color: colors.text.inverse,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
