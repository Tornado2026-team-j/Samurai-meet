import { afterEach, describe, expect, it } from "bun:test";
import { requestAPI } from "../services/api-client";

const originalFetch = globalThis.fetch;
const session = {
  user_id: "user-1",
  session_id: "session-1",
  access_token: "access-token",
  refresh_token: "refresh-token",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("API client retry metadata", () => {
  it("keeps Retry-After from an account translation rate limit", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "chat_translation_rate_limited" }), {
      status: 429,
      headers: { "Retry-After": "7" },
    })) as unknown as typeof fetch;

    await expect(requestAPI("/chats/chat-1/translate", session, { method: "POST" })).rejects.toMatchObject({
      status: 429,
      code: "chat_translation_rate_limited",
      retryAfterSeconds: 7,
    });
  });
});
