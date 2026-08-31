import Constants from "expo-constants";
import { Platform } from "react-native";

// Native BLE is intentionally not emulated in Expo Go.  It must be supplied
// by a development/production build containing an audited native module.
export function meetingProximityCapability(): { enabled: boolean; reason: "expo_go" | "disabled" | "native_module_required" } {
  if (Constants.appOwnership === "expo") return { enabled: false, reason: "expo_go" };
  if (Platform.OS === "web" || process.env.EXPO_PUBLIC_MEETING_PROXIMITY_ENABLED !== "true") return { enabled: false, reason: "disabled" };
  return { enabled: false, reason: "native_module_required" };
}
