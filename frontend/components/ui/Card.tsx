import { Pressable, StyleSheet, View } from "react-native";
import type {
  GestureResponderEvent,
  PressableProps,
  StyleProp,
  ViewProps,
  ViewStyle,
} from "react-native";
import type { ReactNode } from "react";
import { colors, opacity, radius, shadows, spacing } from "./tokens";

type CardVariant = "default" | "soft" | "warning" | "danger";

type CardProps = {
  accessibilityLabel?: string;
  accessibilityRole?: PressableProps["accessibilityRole"];
  children: ReactNode;
  disabled?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  variant?: CardVariant;
} & Pick<ViewProps, "accessibilityState" | "testID">;

export default function Card({
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  children,
  disabled = false,
  onPress,
  style,
  testID,
  variant = "default",
}: CardProps) {
  const cardStyle = [styles.base, styles[variant], style];

  if (!onPress) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        style={cardStyle}
        testID={testID}
      >
        {children}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        cardStyle,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface.default,
    ...shadows.card,
  },
  default: {
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.default,
  },
  soft: {
    borderColor: colors.border.blue,
    backgroundColor: colors.surface.blueSoft,
  },
  warning: {
    borderColor: colors.border.gold,
    backgroundColor: colors.surface.warningSoft,
  },
  danger: {
    borderColor: colors.border.danger,
    backgroundColor: colors.surface.dangerSoft,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
