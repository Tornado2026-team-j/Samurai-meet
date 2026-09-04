import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const REVIEW_LATER_KEY_PREFIX = "samurai_meet_review_later_v1_";

function storageKey(userID: string): string {
  return `${REVIEW_LATER_KEY_PREFIX}${userID.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
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

export async function loadDeferredReviewMatchIDs(userID: string): Promise<Set<string>> {
  try {
    const stored = await getItem(storageKey(userID));
    if (!stored) return new Set<string>();
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((value): value is string => typeof value === "string" && value.length > 0));
  } catch {
    // A local preference must not block the plans screen.
    return new Set<string>();
  }
}

export async function deferReviewForMatch(userID: string, matchID: string): Promise<void> {
  const deferred = await loadDeferredReviewMatchIDs(userID);
  deferred.add(matchID);
  await setItem(storageKey(userID), JSON.stringify([...deferred]));
}

export async function clearReviewDeferral(userID: string, matchID: string): Promise<void> {
  const deferred = await loadDeferredReviewMatchIDs(userID);
  deferred.delete(matchID);
  if (deferred.size === 0) {
    await deleteItem(storageKey(userID));
    return;
  }
  await setItem(storageKey(userID), JSON.stringify([...deferred]));
}
