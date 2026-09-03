import { StyleSheet, View } from "react-native";
import LoadingSpinner, { LOADING_SPINNER_SPEED_MS } from "./LoadingSpinner";

type RefreshLoadingIndicatorProps = {
  color?: string;
  size?: number;
  top?: number;
};

/** A quiet, fixed indicator for pull-to-refresh without replacing visible content. */
export default function RefreshLoadingIndicator({
  color = "#5EC5F5",
  size = 24,
  top = 0,
}: RefreshLoadingIndicatorProps) {
  return (
    <View pointerEvents="none" style={[styles.container, { top }]}>
      <LoadingSpinner color={color} size={size} speedMs={LOADING_SPINNER_SPEED_MS} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 0,
    left: 0,
    zIndex: 10,
    alignItems: "center",
  },
});
