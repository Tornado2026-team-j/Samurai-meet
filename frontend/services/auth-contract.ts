export type Session = {
  user_id: string;
  session_id: string;
  access_token: string;
  refresh_token: string;
};

export type PreAuth = {
  user_id: string;
  pre_auth_token: string;
  passkey_required: boolean;
  passkey_registered: boolean;
  recovery_available?: boolean;
};

export type StoredSession = Pick<Session, "user_id" | "session_id" | "refresh_token">;

export function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredSession>;
  return typeof candidate.user_id === "string"
    && candidate.user_id.length > 0
    && typeof candidate.session_id === "string"
    && candidate.session_id.length > 0
    && typeof candidate.refresh_token === "string"
    && candidate.refresh_token.length > 0;
}

export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Session>;
  return typeof candidate.user_id === "string"
    && candidate.user_id.length > 0
    && typeof candidate.session_id === "string"
    && candidate.session_id.length > 0
    && typeof candidate.access_token === "string"
    && candidate.access_token.length > 0
    && typeof candidate.refresh_token === "string"
    && candidate.refresh_token.length > 0;
}
