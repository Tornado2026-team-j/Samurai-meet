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
  MONSTER_GENERATION_RULES,
  MONSTER_INPUT_LIMITS,
  parseIdentityVerificationChoice,
  parseAppMode,
  parseLanguage,
  parseLocalProfile,
  serializeMonsterSeedForLegacyBio,
} from "./onboarding-contract";
export type {
  AppMode,
  AppLanguage,
  IdentityVerificationChoice,
  LocalProfile,
} from "./onboarding-contract";

const LANGUAGE_KEY = "samurai_meet_language_v1";
const APP_MODE_KEY = "samurai_meet_app_mode_v1";
const TRANSLATION_CONSENT_KEY_PREFIX = "samurai_meet_translation_consent_v1_";
const PROFILE_KEY_PREFIX = "samurai_meet_profile_v1_";
const IDENTITY_VERIFICATION_CHOICE_KEY_PREFIX =
  "samurai_meet_identity_verification_choice_v1_";
const languageListeners = new Set<(language: AppLanguage | null) => void>();
let cachedLanguage: AppLanguage | null = null;
let languageLoadPromise: Promise<AppLanguage | null> | null = null;
let languageRevision = 0;

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

function translationConsentKey(userID: string): string {
  return `${TRANSLATION_CONSENT_KEY_PREFIX}${userID.replace(/[^A-Za-z0-9._-]/g, "_")}`;
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

export function getCachedLanguage(): AppLanguage | null {
  return cachedLanguage;
}

export function loadLanguage(): Promise<AppLanguage | null> {
  if (languageLoadPromise) return languageLoadPromise;

  const revision = languageRevision;
  const request = getItem(LANGUAGE_KEY).then((value) => {
    const nextLanguage = parseLanguage(value);
    if (revision === languageRevision) {
      cachedLanguage = nextLanguage;
      return nextLanguage;
    }
    return cachedLanguage;
  });
  languageLoadPromise = request;
  return request.catch((error) => {
    if (languageLoadPromise === request) languageLoadPromise = null;
    throw error;
  });
}

export async function saveLanguage(language: AppLanguage): Promise<void> {
  const revision = ++languageRevision;
  await setItem(LANGUAGE_KEY, language);
  if (revision === languageRevision) {
    cachedLanguage = language;
    languageLoadPromise = Promise.resolve(language);
  }
  notifyLanguageListeners(language);
}

export async function clearLanguage(): Promise<void> {
  const revision = ++languageRevision;
  await deleteItem(LANGUAGE_KEY);
  if (revision === languageRevision) {
    cachedLanguage = null;
    languageLoadPromise = Promise.resolve(null);
  }
  notifyLanguageListeners(null);
}

// Screens keep their already-loaded data when the display language changes.
// This only updates copy and avoids a navigation-triggered list reload.
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

export type TranslationConsent = "granted" | "denied";

export async function loadTranslationConsent(userID: string): Promise<TranslationConsent | null> {
  const value = await getItem(translationConsentKey(userID));
  return value === "granted" || value === "denied" ? value : null;
}

export async function saveTranslationConsent(userID: string, consent: TranslationConsent): Promise<void> {
  await setItem(translationConsentKey(userID), consent);
}

export async function loadLocalProfile(userID: string): Promise<LocalProfile | null> {
  // Web is not a supported distribution target. Do not read legacy profile
  // PII from Web Storage; remove it when this module is exercised in web dev.
  if (Platform.OS === "web") {
    await deleteItem(profileKey(userID));
    return null;
  }

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
  // Web is not a supported distribution target, and Web Storage is readable
  // by page scripts. Keep profile persistence in native Secure Storage only.
  if (Platform.OS === "web") {
    await deleteItem(profileKey(userID));
    return;
  }

  await SecureStore.setItemAsync(profileKey(userID), JSON.stringify(profile));
}

export async function clearLocalProfile(userID: string): Promise<void> {
  await deleteItem(profileKey(userID));
}

export async function clearIdentityVerificationChoice(userID: string): Promise<void> {
  await deleteItem(identityVerificationChoiceKey(userID));
}
