import { fetchWithAutoRefresh } from "./authenticated-fetch";
import type { Session } from "./auth-contract";

export class APIError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: unknown;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, data: unknown = null, retryAfterSeconds?: number) {
    super(`${status}: ${code}`);
    this.name = "APIError";
    this.status = status;
    this.code = code;
    this.data = data;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function responseErrorCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return "request_failed";
  }

  const code = (body as { error?: unknown }).error;
  return typeof code === "string" && code.length > 0 ? code : "request_failed";
}

export async function requestAPI<T>(
  path: string,
  session: Session,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchWithAutoRefresh(path, session, init);
  const text = await response.text();
  let body: unknown = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const data = body && typeof body === "object" && "data" in body
      ? (body as { data?: unknown }).data
      : undefined;
    const retryAfterHeader = response.headers.get("Retry-After")?.trim() ?? "";
    const parsedRetryAfter = /^\d+$/u.test(retryAfterHeader) ? Number(retryAfterHeader) : NaN;
    const retryAfterSeconds = Number.isSafeInteger(parsedRetryAfter) && parsedRetryAfter > 0
      ? parsedRetryAfter
      : undefined;
    throw new APIError(response.status, responseErrorCode(body), data, retryAfterSeconds);
  }

  return body as T;
}
