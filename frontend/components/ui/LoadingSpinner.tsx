import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

type LoadingSpinnerProps = {
  color: string;
  trackColor?: string;
  size?: number;
  speedMs?: number;
  style?: StyleProp<ViewStyle>;
};

/** A small, native-driven spinner that starts smoothly and feels responsive. */
export default function LoadingSpinner({
  color,
  trackColor = "rgba(31, 45, 61, 0.12)",
  size = 24,
  speedMs = 720,
  style,
}: LoadingSpinnerProps) {
  const rotation = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    rotation.setValue(0);
    opacity.setValue(0);
    const loop = Animated.loop(
      Animated.timing(rotation, {
        duration: Math.max(360, speedMs),
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    const entrance = Animated.timing(opacity, {
      duration: 160,
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
