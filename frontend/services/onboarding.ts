import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  parseIdentityVerificationChoice,
  parseAppMode,
  parseLanguage,
  parseLocalProfile,
  type AppMode,
  type AppLanguage,
  type IdentityVerificationChoice,
  type LocalProfile,
} from "./onboarding-contract";

export {
  parseIdentityVerificationChoice,
  parseAppMode,
  parseLanguage,
  parseLocalProfile,
} from "./onboarding-contract";
export type {
  AppMode,
  AppLanguage,
  IdentityVerificationChoice,
  LocalProfile,
} from "./onboarding-contract";

const LANGUAGE_KEY = "samurai_meet_language_v1";
const APP_MODE_KEY = "samurai_meet_app_mode_v1";
const PROFILE_KEY_PREFIX = "samurai_meet_profile_v1_";
const IDENTITY_VERIFICATION_CHOICE_KEY_PREFIX =
  "samurai_meet_identity_verification_choice_v1_";
const languageListeners = new Set<(language: AppLanguage | null) => void>();

function notifyLanguageListeners(language: AppLanguage | null): void {
  for (const listener of languageListeners) {
    listener(language);
  }
}

function profileKey(userID: string): string {
  return `${PROFILE_KEY_PREFIX}${userID.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

function identityVerificationChoiceKey(userID: string): string {
  return `${IDENTITY_VERIFICATION_CHOICE_KEY_PREFIX}${userID.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(key) ?? null;
  }

  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}

export async function loadLanguage(): Promise<AppLanguage | null> {
  return parseLanguage(await getItem(LANGUAGE_KEY));
}

export async function saveLanguage(language: AppLanguage): Promise<void> {
  await setItem(LANGUAGE_KEY, language);
  notifyLanguageListeners(language);
}

export async function clearLanguage(): Promise<void> {
  await deleteItem(LANGUAGE_KEY);
  notifyLanguageListeners(null);
}

export function subscribeLanguage(listener: (language: AppLanguage | null) => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

export async function loadAppMode(): Promise<AppMode | null> {
  return parseAppMode(await getItem(APP_MODE_KEY));
}

export async function saveAppMode(mode: AppMode): Promise<void> {
  await setItem(APP_MODE_KEY, mode);
}

export async function clearAppMode(): Promise<void> {
  await deleteItem(APP_MODE_KEY);
}

export async function loadLocalProfile(userID: string): Promise<LocalProfile | null> {
  return parseLocalProfile(await getItem(profileKey(userID)));
}

export async function loadIdentityVerificationChoice(
  userID: string,
): Promise<IdentityVerificationChoice> {
  return parseIdentityVerificationChoice(
    await getItem(identityVerificationChoiceKey(userID)),
  );
}

export async function saveIdentityVerificationChoice(
  userID: string,
  choice: Exclude<IdentityVerificationChoice, null>,
): Promise<void> {
  await setItem(identityVerificationChoiceKey(userID), choice);
}

export async function saveLocalProfile(
  userID: string,
  profile: LocalProfile,
): Promise<void> {
  await setItem(profileKey(userID), JSON.stringify(profile));
}

export async function clearLocalProfile(userID: string): Promise<void> {
  await deleteItem(profileKey(userID));
}

export async function clearIdentityVerificationChoice(userID: string): Promise<void> {
  await deleteItem(identityVerificationChoiceKey(userID));
}
