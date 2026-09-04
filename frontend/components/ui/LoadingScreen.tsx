import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, type StyleProp, type ViewStyle, View } from "react-native";
import { useTheme, useThemeStyles } from "../../hooks/useTheme";
import LoadingSpinner, { LOADING_SPINNER_SPEED_MS } from "./LoadingSpinner";
import type { ThemeColors } from "./tokens";

type LoadingScreenProps = {
  color?: string;
  label?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/** A quiet full-screen loading state shared by screen transitions and first loads. */
export default function LoadingScreen({
  color: colorProp,
  label,
  size = 28,
  style,
}: LoadingScreenProps) {
  const { colors, scheme } = useTheme();
  const color = colorProp ?? colors.brand.sky;
  const styles = useThemeStyles(createStyles);
  return (
    <View style={[styles.screen, style]}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <LoadingSpinner color={color} size={size} speedMs={LOADING_SPINNER_SPEED_MS} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface.screen,
  },
  label: {
    marginTop: 12,
    color: colors.text.subtle,
    fontSize: 13,
    fontWeight: "600",
  },
  });
}
