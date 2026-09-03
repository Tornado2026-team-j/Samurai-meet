import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

type LoadingSpinnerProps = {
  color: string;
  size?: number;
  speedMs?: number;
  style?: StyleProp<ViewStyle>;
};

/** A small, native-driven spinner that starts smoothly and feels responsive. */
export default function LoadingSpinner({
  color,
  size = 24,
  speedMs = 720,
  style,
}: LoadingSpinnerProps) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        duration: Math.max(360, speedMs),
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotation, speedMs]);

  return (
    <Animated.View
      accessibilityLabel="Loading"
      style={[
        styles.spinner,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: Math.max(2, Math.round(size / 8)),
          borderTopColor: color,
          borderRightColor: color,
        },
        {
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
