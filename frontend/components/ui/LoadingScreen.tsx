import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, type StyleProp, type ViewStyle, View } from "react-native";
import LoadingSpinner, { LOADING_SPINNER_SPEED_MS } from "./LoadingSpinner";

type LoadingScreenProps = {
  color?: string;
  label?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/** A quiet full-screen loading state shared by screen transitions and first loads. */
export default function LoadingScreen({
  color = "#5EC5F5",
  label,
  size = 28,
  style,
}: LoadingScreenProps) {
  return (
    <View style={[styles.screen, style]}>
      <StatusBar style="dark" />
      <LoadingSpinner color={color} size={size} speedMs={LOADING_SPINNER_SPEED_MS} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  label: {
    marginTop: 12,
    color: "#8A8A8A",
    fontSize: 13,
    fontWeight: "600",
  },
});
