import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../hooks/useTheme";

type LoadingSpinnerProps = {
  color: string;
  trackColor?: string;
  size?: number;
  speedMs?: number;
  style?: StyleProp<ViewStyle>;
};

export const LOADING_SPINNER_SPEED_MS = 500;

/** A small, native-driven spinner that starts smoothly and feels responsive. */
export default function LoadingSpinner({
  color,
  trackColor: trackColorProp,
  size = 24,
  speedMs = LOADING_SPINNER_SPEED_MS,
  style,
}: LoadingSpinnerProps) {
  const { colors } = useTheme();
  const trackColor = trackColorProp ?? colors.border.subtle;
  const rotation = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    rotation.setValue(0);
    opacity.setValue(0);
    const duration = Math.max(360, speedMs);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(rotation, {
          duration,
          easing: Easing.inOut(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.delay(Math.min(45, Math.max(24, Math.round(duration * 0.08)))),
      ]),
      { resetBeforeIteration: true },
    );
    const entrance = Animated.timing(opacity, {
      duration: 120,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    loop.start();
    entrance.start();
    return () => {
      loop.stop();
      entrance.stop();
    };
  }, [opacity, rotation, speedMs]);

  return (
    <Animated.View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={[
        styles.spinner,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: Math.max(1, Math.round(size / 14)),
          borderColor: trackColor,
          borderTopColor: color,
        },
        {
          opacity,
          transform: [
            {
              rotate: rotation.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "360deg"],
              }),
            },
          ],
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  spinner: {
    borderColor: "rgba(94, 197, 245, 0.18)",
  },
});
