import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";

export type PushSettings = {
  token: string;
  platform: "ios" | "android";
  enabled: boolean;
  chat_enabled: boolean;
  match_enabled: boolean;
  reminder_enabled: boolean;
};

type DataResponse<T> = { data?: T };

export async function getPushSettings(session: Session, signal?: AbortSignal): Promise<PushSettings> {
  const response = await requestAPI<DataResponse<PushSettings>>("/me/push-settings", session, { method: "GET", signal });
  return response.data ?? {
    token: "",
    platform: Platform.OS === "android" ? "android" : "ios",
    enabled: true,
    chat_enabled: true,
    match_enabled: true,
    reminder_enabled: true,
  };
}

export async function requestPushToken(): Promise<string> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") throw new Error("push_not_supported");
  if (!Device.isDevice) throw new Error("physical_device_required");
  const Notifications = await import("expo-notifications");
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Samurai Meet",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("notification_permission_denied");
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  const result = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return result.data;
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
