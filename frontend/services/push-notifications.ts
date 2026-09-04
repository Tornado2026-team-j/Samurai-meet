import type { Platform } from "react-native";
import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";

type ConstantsModule = typeof import("expo-constants");
type DeviceModule = typeof import("expo-device");
type NotificationsModule = typeof import("expo-notifications");

export type PushUnavailableReason =
  | "unsupported_platform"
  | "expo_go"
  | "physical_device_required"
  | "native_module_unavailable"
  | "permission_denied"
  | "token_unavailable";

export type PushCapability =
  | { available: true }
  | { available: false; reason: PushUnavailableReason };

export type PushTokenResult =
  | { available: true; token: string }
  | { available: false; reason: PushUnavailableReason };

export type PushSettings = {
  token: string;
  platform: "ios" | "android";
  enabled: boolean;
  chat_enabled: boolean;
  match_enabled: boolean;
  reminder_enabled: boolean;
};

type DataResponse<T> = { data?: T };

function runtimePlatform(): typeof Platform.OS | undefined {
  try {
    // Push is optional; do not evaluate the native platform module until a
    // push capability is explicitly requested.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require("react-native") as { Platform?: typeof Platform };
    return native.Platform?.OS;
  } catch {
    return undefined;
  }
}

type PushModules = {
  Constants: ConstantsModule;
  Device: DeviceModule;
  Notifications: NotificationsModule;
};

type PushModulesResult =
  | { available: true; modules: PushModules }
  | { available: false; reason: PushUnavailableReason };

function isExpoGo(Constants: ConstantsModule): boolean {
  // appOwnership is deprecated and can be null in newer SDKs. Expo Go reports
  // storeClient through executionEnvironment instead; check both before the
  // optional notifications module is evaluated.
  return Constants.default?.executionEnvironment === "storeClient"
    || Constants.default?.appOwnership === "expo";
}

function loadNotificationsModule(): NotificationsModule | null {
  try {
    // Dynamic import is implemented as Metro's `importAll`, which enumerates
    // React Native's legacy exports while loading expo-notifications. On SDK
    // 57 that touches PushNotificationIOS before this optional module can
    // report its availability. A delayed CommonJS require keeps evaluation
    // behind the capability checks without enumerating those exports.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-notifications") as NotificationsModule;
  } catch {
    return null;
  }
}

async function loadPushModules(): Promise<PushModulesResult> {
  const platform = runtimePlatform();
  if (platform !== "ios" && platform !== "android") {
    return { available: false, reason: "unsupported_platform" };
  }

  const Constants = await import("expo-constants").catch(() => null);
  if (!Constants) return { available: false, reason: "native_module_unavailable" };

  if (isExpoGo(Constants)) {
    return { available: false, reason: "expo_go" };
  }

  const Device = await import("expo-device").catch(() => null);
  if (!Device) return { available: false, reason: "native_module_unavailable" };
  if (!Device.isDevice) return { available: false, reason: "physical_device_required" };

  const Notifications = loadNotificationsModule();
  if (!Notifications
    || typeof Notifications.getPermissionsAsync !== "function"
    || typeof Notifications.requestPermissionsAsync !== "function"
    || typeof Notifications.getExpoPushTokenAsync !== "function") {
    return { available: false, reason: "native_module_unavailable" };
  }

  return { available: true, modules: { Constants, Device, Notifications } };
}

export async function getPushSettings(session: Session, signal?: AbortSignal): Promise<PushSettings> {
  const response = await requestAPI<DataResponse<PushSettings>>("/me/push-settings", session, { method: "GET", signal });
  return response.data ?? {
    token: "",
    platform: runtimePlatform() === "android" ? "android" : "ios",
    enabled: true,
    chat_enabled: true,
    match_enabled: true,
    reminder_enabled: true,
  };
}

export async function getPushCapability(): Promise<PushCapability> {
  const result = await loadPushModules();
  return result.available
    ? { available: true }
    : { available: false, reason: result.reason };
}

export async function requestPushTokenResult(): Promise<PushTokenResult> {
  const loaded = await loadPushModules();
  if (!loaded.available) return loaded;

  const { Constants, Notifications } = loaded.modules;
  try {
    if (runtimePlatform() === "android" && typeof Notifications.setNotificationChannelAsync === "function") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Samurai Meet",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const permission = current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
    if (permission.status !== "granted") {
      return { available: false, reason: "permission_denied" };
    }
    const projectId = Constants.default?.easConfig?.projectId ?? Constants.default?.expoConfig?.extra?.eas?.projectId;
    const result = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!result.data) return { available: false, reason: "token_unavailable" };
    return { available: true, token: result.data };
  } catch {
    return { available: false, reason: "native_module_unavailable" };
  }
}

// Preserve the existing string API for screens that already handle a failed
// request. Native import failures are converted to a stable reason first.
export async function requestPushToken(): Promise<string> {
  const result = await requestPushTokenResult();
  if (!result.available) throw new Error(result.reason);
  return result.token;
}

export async function savePushSettings(session: Session, settings: PushSettings, signal?: AbortSignal): Promise<PushSettings> {
  const response = await requestAPI<DataResponse<PushSettings>>("/me/push-settings", session, {
    method: "POST",
    body: JSON.stringify(settings),
    signal,
  });
  if (!response.data) throw new Error("push settings response is empty");
  return response.data;
}
