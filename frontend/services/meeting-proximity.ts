import type { Platform } from "react-native";

export type MeetingProximityUnavailableReason =
  | "expo_go"
  | "unsupported_platform"
  | "feature_disabled"
  | "native_module_unavailable"
  | "native_adapter_unavailable";

export type MeetingProximityCapability = {
  enabled: false;
  reason: MeetingProximityUnavailableReason;
};

type ConstantsLike = {
  appOwnership?: string;
};

function runtimePlatform(): typeof Platform.OS | undefined {
  try {
    // Evaluate the core platform module only when the optional capability is
    // queried, so a missing native runtime cannot crash route loading.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require("react-native") as { Platform?: typeof Platform };
    return native.Platform?.OS;
  } catch {
    return undefined;
  }
}

function readAppOwnership(): string | undefined {
  try {
    // Constants is only needed when this optional capability is queried. Keep
    // it out of the module-evaluation path so Expo Go can boot without it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require("expo-constants") as { default?: ConstantsLike } & ConstantsLike;
    return loaded.default?.appOwnership ?? loaded.appOwnership;
  } catch {
    return undefined;
  }
}

// Native BLE is intentionally not emulated in Expo Go. It must be supplied
// by a development/production build containing an audited native adapter.
// Returning a reason lets the UI explain why the optional feature is absent.
export function meetingProximityCapability(): MeetingProximityCapability {
  if (process.env.EXPO_PUBLIC_MEETING_PROXIMITY_ENABLED !== "true") {
    return { enabled: false, reason: "feature_disabled" };
  }
  if (runtimePlatform() !== "ios" && runtimePlatform() !== "android") {
    return { enabled: false, reason: "unsupported_platform" };
  }

  const appOwnership = readAppOwnership();
  if (appOwnership === "expo") return { enabled: false, reason: "expo_go" };
  if (!appOwnership) return { enabled: false, reason: "native_module_unavailable" };
  return { enabled: false, reason: "native_adapter_unavailable" };
}
