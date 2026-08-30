import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";

export type SessionSummary = {
  id: string;
  device_name?: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  current: boolean;
};

export type PasskeySummary = {
  credential_id: string;
  created_at: string;
  last_used_at?: string;
};

type DataResponse<T> = { data?: T };

function requireArray<T>(response: DataResponse<T[]>, resource: string): T[] {
  if (!Array.isArray(response.data)) throw new Error(`${resource} response is invalid`);
  return response.data;
}

export async function listSessions(session: Session, signal?: AbortSignal): Promise<SessionSummary[]> {
  return requireArray(
    await requestAPI<DataResponse<SessionSummary[]>>("/me/sessions", session, { method: "GET", signal }),
    "session list",
  );
}

export async function revokeSession(sessionId: string, session: Session, signal?: AbortSignal): Promise<void> {
  await requestAPI<null>(`/me/sessions/${encodeURIComponent(sessionId)}`, session, { method: "DELETE", signal });
}

export async function listPasskeys(session: Session, signal?: AbortSignal): Promise<PasskeySummary[]> {
  return requireArray(
    await requestAPI<DataResponse<PasskeySummary[]>>("/auth/passkey", session, { method: "GET", signal }),
    "passkey list",
  );
}

export async function removePasskey(credentialId: string, session: Session, signal?: AbortSignal): Promise<void> {
  await requestAPI<null>(`/auth/passkey/${encodeURIComponent(credentialId)}`, session, { method: "DELETE", signal });
}
