import { API_BASE_URL } from "./api-config";
import type { Session } from "./auth-contract";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

async function fetchOnce(
  path: string,
  session: Session,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeoutID = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = init.signal;
  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutID);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

async function isExpiredAccessTokenResponse(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = await response.clone().json() as { error?: unknown };
    return body.error === "missing_or_invalid_access_token";
  } catch {
    return false;
  }
}

/**
 * Sends an authenticated request, refreshing a rotating access token once
 * when the server explicitly reports that the access token is invalid.
 *
 * The caller's Session object is updated before the retry so device-proof
 * requests and the AuthProvider keep using the same current credentials.
 */
export async function fetchWithAutoRefresh(
  path: string,
  session: Session,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const response = await fetchOnce(path, session, init, timeoutMs);
  if (init.signal?.aborted || !(await isExpiredAccessTokenResponse(response))) {
    return response;
  }

  // Keep the ordinary API client free of React Native auth module loading on
  // startup. The auth module is needed only after an expired access token.
  const { refreshSession } = await import("./auth");
  const next = await refreshSession(session);
  if (next.user_id !== session.user_id) {
    throw new Error("認証情報が別のアカウントに切り替わりました。");
  }
  Object.assign(session, next);
  return fetchOnce(path, session, init, timeoutMs);
}
