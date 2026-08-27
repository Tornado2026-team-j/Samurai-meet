import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Session } from "../services/auth-contract";
import { fetchWithAutoRefresh } from "../services/authenticated-fetch";

const originalFetch = globalThis.fetch;
function newSession(): Session {
  return {
    user_id: "user-1",
    session_id: "session-1",
    access_token: "expired-access-token",
    refresh_token: "refresh-token",
  };
}

mock.module("../services/auth", () => ({
  refreshSession: async (current: Session): Promise<Session> => ({
    ...current,
    access_token: "refreshed-access-token",
    refresh_token: "rotated-refresh-token",
  }),
}));

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("認証済みAPIのAccess Token更新", () => {
  it("期限切れ401だけをRefreshして元のリクエストを一度だけ再試行する", async () => {
    const session = newSession();
    let calls = 0;
    const accessTokens: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      accessTokens.push(new Headers(init?.headers).get("Authorization") ?? "");
      if (calls === 1) {
        return new Response(JSON.stringify({ error: "missing_or_invalid_access_token" }), { status: 401 });
      }
      return new Response(JSON.stringify({ data: "ok" }), { status: 200 });
    }) as typeof fetch;

    const response = await fetchWithAutoRefresh("/me", session);

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(accessTokens).toEqual([
      "Bearer expired-access-token",
      "Bearer refreshed-access-token",
    ]);
    expect(session.access_token).toBe("refreshed-access-token");
  });

  it("403の再認証要求をRefreshで迂回しない", async () => {
    const session = newSession();
    let calls = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      calls += 1;
      return new Response(JSON.stringify({ error: "recent_passkey_authentication_required" }), { status: 403 });
    }) as unknown as typeof fetch;

    const response = await fetchWithAutoRefresh("/me/key-envelopes", session);

    expect(response.status).toBe(403);
    expect(calls).toBe(1);
  });
});
