import { fetchWithAutoRefresh } from "./authenticated-fetch";
import type { Session } from "./auth-contract";

export class APIError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`${status}: ${code}`);
    this.name = "APIError";
    this.status = status;
    this.code = code;
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
    throw new APIError(response.status, responseErrorCode(body));
  }

  return body as T;
}
