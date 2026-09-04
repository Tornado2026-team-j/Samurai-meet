import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type ThemePreference = "system" | "light" | "dark";

const THEME_PREFERENCE_KEY = "samurai_meet_theme_preference_v1";

function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

async function getStoredThemePreference(): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(THEME_PREFERENCE_KEY) ?? null;
  }

  return SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
}

async function setStoredThemePreference(value: ThemePreference): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(THEME_PREFERENCE_KEY, value);
    return;
  }

  await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, value);
}

export async function loadThemePreference(): Promise<ThemePreference> {
  return parseThemePreference(await getStoredThemePreference());
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  await setStoredThemePreference(preference);
}

export async function clearThemePreference(): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(THEME_PREFERENCE_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(THEME_PREFERENCE_KEY);
}
