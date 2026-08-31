import { afterEach, describe, expect, it } from "bun:test";
import {
  parseChatLocationPayload,
  blockUser,
  chatWebSocketURL,
  createSafetyReport,
  decryptChatMessage,
  encryptChatPlaintext,
  filterChatsByStatus,
  issueChatTransportToken,
  listChatMessages,
  listChats,
  markChatRead,
  moderateChatText,
  sendChatMessage,
  sendChatLocation,
  toChatMessageView,
  validateChatDraft,
  type EncryptedChatMessage,
  type ChatSummary,
} from "../services/chat";

const originalFetch = globalThis.fetch;
const session = {
  user_id: "user-1",
  session_id: "session-1",
  access_token: "access-token",
  refresh_token: "refresh-token",
};

const fixedRandom = async (length: number) => new Uint8Array(Array.from({ length }, (_, index) => index + 1));

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("チャットAPIクライアント", () => {
  it("チャット一覧とメッセージ履歴のREST契約を呼び出す", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/messages")) {
        return new Response(JSON.stringify({
          data: { items: [], has_more: false },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: [{
          id: "chat-1",
          match_id: "match-1",
          status: "accepted",
          other_user_id: "user-2",
          other_user_name: "Sofia",
          unread_count: 1,
          updated_at: "2026-08-30T00:00:00Z",
        }],
      }), { status: 200 });
    }) as typeof fetch;

    const chats = await listChats(session);
    expect(chats).toHaveLength(1);
    expect(chats).toMatchObject([{ status: "accepted" }]);
    await expect(listChatMessages("chat-1", session, { after: 3, limit: 50 })).resolves.toMatchObject({
      items: [],
      has_more: false,
    });

    expect(requests[0]).toContain("/chats");
    expect(requests[1]).toContain("/chats/chat-1/messages");
    expect(requests[1]).toContain("after=3");
    expect(requests[1]).toContain("limit=50");
  });

  it("チャット一覧の絞り込みはAPIのstatusだけを根拠にする", () => {
    const chats: ChatSummary[] = [
      {
        id: "chat-active",
        match_id: "match-active",
        status: "accepted",
        other_user_id: "user-2",
        other_user_name: "Sofia",
        unread_count: 0,
        updated_at: "2026-08-30T00:00:00Z",
      },
      {
        id: "chat-completed",
        match_id: "match-completed",
        status: "completed",
        other_user_id: "user-3",
        other_user_name: "Haruto",
        unread_count: 2,
        updated_at: "2026-08-30T00:00:00Z",
      },
    ];

    expect(filterChatsByStatus(chats, "all").map((chat) => chat.id)).toEqual([
      "chat-active",
      "chat-completed",
    ]);
    expect(filterChatsByStatus(chats, "active").map((chat) => chat.id)).toEqual(["chat-active"]);
    expect(filterChatsByStatus(chats, "completed").map((chat) => chat.id)).toEqual(["chat-completed"]);
  });

  it("WebSocket用Chat Tokenを発行し、URL queryへ載せない接続先を作る", async () => {
    let requestedBody = "";
    globalThis.fetch = (async (_input, init) => {
      requestedBody = String(init?.body);
      return new Response(JSON.stringify({
        data: {
          chat_token: "chat-jws",
          expires_at: "2026-08-30T00:02:00Z",
          transport: "websocket",
        },
      }), { status: 200 });
    }) as typeof fetch;

    await expect(issueChatTransportToken("chat-1", session)).resolves.toMatchObject({
      chat_token: "chat-jws",
      transport: "websocket",
    });

    expect(JSON.parse(requestedBody)).toEqual({ transport: "websocket" });
    expect(chatWebSocketURL("chat-1", "https://example.com/api/v1")).toBe("wss://example.com/api/v1/ws/chats/chat-1");
    expect(chatWebSocketURL("chat 1", "http://127.0.0.1:8080/api/v1")).toBe("ws://127.0.0.1:8080/api/v1/ws/chats/chat%201");
  });

  it("通報とブロックは#27の安全API契約を呼び出す", async () => {
    const requests: { url: string; method: string; body: unknown }[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: String(init?.method),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.includes("/reports")) {
        return new Response(JSON.stringify({
          data: {
            id: "report-1",
            target_type: "message",
            target_id: "message-1",
            reason: "harassment",
            comment: "",
            status: "received",
            created_at: "2026-08-30T00:00:00Z",
          },
        }), { status: 201 });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await expect(createSafetyReport(session, {
      target_type: "message",
      target_id: "message-1",
      reason: "harassment",
    })).resolves.toMatchObject({ id: "report-1" });
    await expect(blockUser("user-2", session)).resolves.toBeUndefined();

    expect(requests[0]).toMatchObject({
      method: "POST",
      body: {
        target_type: "message",
        target_id: "message-1",
        reason: "harassment",
        comment: "",
      },
    });
    expect(requests[1]).toMatchObject({
      method: "POST",
      body: { user_id: "user-2" },
    });
  });

  it("既読更新はlast_message_sequenceをPOSTする", async () => {
    let requestedBody = "";
    let requestedMethod = "";
    globalThis.fetch = (async (_input, init) => {
      requestedMethod = String(init?.method);
      requestedBody = String(init?.body);
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await markChatRead("chat-1", 12, session);

    expect(requestedMethod).toBe("POST");
    expect(JSON.parse(requestedBody)).toEqual({ last_message_sequence: 12 });
  });

  it("本文を暗号化してから送信し、平文をAPI bodyへ入れない", async () => {
    let requestedBody = "";
    globalThis.fetch = (async (_input, init) => {
      requestedBody = String(init?.body);
      const body = JSON.parse(requestedBody) as Partial<EncryptedChatMessage>;
      return new Response(JSON.stringify({
        data: {
          ...body,
          id: "message-1",
          chat_id: "chat-1",
          sender_user_id: "user-1",
          sequence: 1,
          created_at: "2026-08-30T00:00:00Z",
        },
      }), { status: 201 });
    }) as typeof fetch;

    const message = await sendChatMessage(
      "chat-1",
      "改札前で待ち合わせしましょう。",
      session,
      "client-1",
      undefined,
      fixedRandom,
    );
    const parsed = JSON.parse(requestedBody) as Record<string, unknown>;

    expect(parsed.client_message_id).toBe("client-1");
    expect(parsed.algorithm).toBe("AES-256-GCM");
    expect(requestedBody).not.toContain("改札前");
    expect(decryptChatMessage("chat-1", message)).toBe("改札前で待ち合わせしましょう。");
  });

  it("位置共有も座標を平文API bodyへ入れず、期限付き型付きメッセージとして送る", async () => {
    let requestedBody = "";
    globalThis.fetch = (async (_input, init) => {
      requestedBody = String(init?.body);
      const body = JSON.parse(requestedBody) as Partial<EncryptedChatMessage>;
      return new Response(JSON.stringify({ data: { ...body, id: "location-1", chat_id: "chat-1", sender_user_id: "user-1", sequence: 2, created_at: "2026-08-30T00:00:00Z" } }), { status: 201 });
    }) as typeof fetch;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const message = await sendChatLocation("chat-1", { latitude: 35.681236, longitude: 139.767125, display_name: "Tokyo Station", accuracy_m: 20 }, session, expiresAt, "location-client-1", undefined, fixedRandom);
    expect(JSON.parse(requestedBody)).toMatchObject({ content_type: "location", expires_at: expiresAt });
    expect(requestedBody).not.toContain("35.681236");
    expect(toChatMessageView("chat-1", message, "user-1").location).toMatchObject({ latitude: 35.681236, longitude: 139.767125, display_name: "Tokyo Station" });
  });

  it("期限切れの位置共有は座標を画面用データとして返さない", () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const payload = JSON.stringify({
      type: "location",
      latitude: 35.681236,
      longitude: 139.767125,
      display_name: "Tokyo Station",
      expires_at: expiredAt,
    });
    expect(parseChatLocationPayload(payload, expiredAt)).toBeNull();

    const message: EncryptedChatMessage = {
      id: "location-expired",
      chat_id: "chat-1",
      sender_user_id: "user-2",
      client_message_id: "location-expired-client",
      sequence: 3,
      ciphertext: "",
      nonce: "",
      algorithm: "AES-256-GCM",
      key_version: "v1",
      content_type: "location",
      expires_at: expiredAt,
      created_at: "2026-08-30T00:00:00Z",
    };
    const view = toChatMessageView("chat-1", message, "user-1");
    expect(view.location).toBeNull();
    expect(view.locationExpired).toBe(true);
  });

  it("暗号化メッセージを画面用に復号し、自分の送信か判定する", async () => {
    const encrypted = await encryptChatPlaintext("chat-1", "Hello", fixedRandom);
    const message: EncryptedChatMessage = {
      id: "message-1",
      chat_id: "chat-1",
      sender_user_id: "user-1",
      client_message_id: "client-1",
      sequence: 1,
      created_at: "2026-08-30T00:00:00Z",
      ...encrypted,
    };

    expect(toChatMessageView("chat-1", message, "user-1")).toMatchObject({
      plaintext: "Hello",
      mine: true,
    });
  });

  it("外部連絡先と個人情報らしい文面は送信ブロック対象にする", () => {
    expect(moderateChatText("LINEを教えてください").severity).toBe("block");
    expect(moderateChatText("電話番号は090-1234-5678です").categories).toContain("external_contact");
    expect(moderateChatText("パスポートを送ってください").categories).toContain("personal_info");
    expect(moderateChatText("チップを先に払って").severity).toBe("warn");
  });

  it("空文と長すぎる文を送信前に検証する", () => {
    expect(validateChatDraft("   ")).toBe("empty");
    expect(validateChatDraft("a".repeat(2001))).toBe("too_long");
    expect(validateChatDraft("集合場所を確認したいです")).toBeNull();
  });
});
