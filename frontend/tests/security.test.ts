import { afterEach, expect, test } from "bun:test";
import type { Session } from "../services/auth-contract";
import { listPasskeys, listSessions, removePasskey, revokeSession } from "../services/security";

const session: Session = {
  user_id: "user-1",
  session_id: "session-current",
  access_token: "access",
  refresh_token: "refresh",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("セッションとPasskeyの管理APIを呼び分ける", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ method: init?.method ?? "GET", url: String(input) });
    const data = String(input).endsWith("/me/sessions")
      ? [{ id: "session-current", created_at: "2026-08-30T00:00:00Z", last_seen_at: "2026-08-30T01:00:00Z", expires_at: "2026-09-30T00:00:00Z", current: true }]
      : String(input).endsWith("/auth/passkey")
        ? [{ credential_id: "credential-1", created_at: "2026-08-30T00:00:00Z" }]
        : undefined;
    return new Response(data ? JSON.stringify({ data }) : null, { status: data ? 200 : 204 });
  }) as typeof fetch;

  expect((await listSessions(session))[0]?.current).toBe(true);
  expect((await listPasskeys(session))[0]?.credential_id).toBe("credential-1");
  await revokeSession("session-other", session);
  await removePasskey("credential-1", session);

  expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "DELETE", "DELETE"]);
  expect(requests[2]?.url).toContain("/me/sessions/session-other");
  expect(requests[3]?.url).toContain("/auth/passkey/credential-1");
});
