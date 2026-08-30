import { API_BASE_URL } from "./api-config";
import type { Session, StoredSession } from "./auth-contract";
import { isStoredSession, isSession } from "./auth-contract";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_KEY = "samurai_meet_session_v1";

export type { Session, StoredSession } from "./auth-contract";
export { isStoredSession, isSession } from "./auth-contract";

const sessionListeners = new Set<(session: Session | null) => void>();

export function subscribeSessionChanges(listener: (session: Session | null) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function notifySessionChanges(session: Session | null): void {
  for (const listener of sessionListeners) listener(session);
}

async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.sessionStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStoredItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.sessionStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function clearAuthStorage(): Promise<void> {
  await deleteStoredItem(SESSION_KEY);
  notifySessionChanges(null);
}

export async function restoreAuth(): Promise<{ session: Session | null }> {
  const stored = await getStoredItem(SESSION_KEY);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (!isStoredSession(parsed)) throw new SyntaxError("stored session shape is invalid");
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: parsed.refresh_token, request_id: crypto.randomUUID() }),
      });
      if (!response.ok) {
        await clearAuthStorage();
        return { session: null };
      }
      const body = await response.json() as { data?: unknown };
      if (!isSession(body.data)) {
        await clearAuthStorage();
        return { session: null };
      }
      const session = body.data as Session;
      await setStoredItem(SESSION_KEY, JSON.stringify({
        user_id: session.user_id,
        session_id: session.session_id,
        refresh_token: session.refresh_token,
      }));
      notifySessionChanges(session);
      return { session };
    } catch {
      await clearAuthStorage();
      return { session: null };
    }
  }
  return { session: null };
}

export async function refreshSession(session: Session): Promise<Session> {
  const storedValue = await getStoredItem(SESSION_KEY);
  if (!storedValue) throw new Error("session storage is missing");
  const parsed: unknown = JSON.parse(storedValue);
  if (!isStoredSession(parsed) || parsed.user_id !== session.user_id) {
    throw new Error("session storage is no longer current");
  }
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: parsed.refresh_token, request_id: crypto.randomUUID() }),
  });
  if (!response.ok) throw new Error(`refresh failed: ${response.status}`);
  const body = await response.json() as { data?: unknown };
  if (!isSession(body.data)) throw new Error("refresh response is invalid");
  const next = body.data as Session;
  await setStoredItem(SESSION_KEY, JSON.stringify({
    user_id: next.user_id,
    session_id: next.session_id,
    refresh_token: next.refresh_token,
  }));
  Object.assign(session, next);
  notifySessionChanges(next);
  return next;
}

export async function logout(): Promise<void> {
  await clearAuthStorage();
}
