import { afterEach, describe, expect, it } from "bun:test";
import {
  parseChatLocationPayload,
  blockUser,
  chatRealtimeMode,
  chatWebTransportURL,
  connectChatWebTransport,
  createSafetyReport,
  decryptChatMessage,
  decryptChatTranslation,
  deleteChatMessage,
  encryptChatTranslation,
  encryptChatPlaintext,
  filterChatsByStatus,
  issueChatTransportToken,
  registerChatWebTransportAdapter,
  listChatMessages,
  listChats,
  markChatRead,
  moderateAndSendChatMessage,
  moderateChatMessage,
  moderateChatText,
  parseChatAttachmentRecipients,
  sendChatMessage,
  sendChatLocation,
  toChatMessageView,
  translateChatMessage,
  updateChatMessage,
  validateChatDraft,
  type EncryptedChatMessage,
  type ChatSummary,
} from "../services/chat";
import { toBase64URL } from "../services/crypto";

const originalFetch = globalThis.fetch;
const session = {
  user_id: "user-1",
  session_id: "session-1",
  access_token: "access-token",
  refresh_token: "refresh-token",
};

const fixedRandom = async (length: number) => new Uint8Array(Array.from({ length }, (_, index) => index + 1));
const fixedKeyB = new Uint8Array(32).fill(9);

afterEach(() => {
  globalThis.fetch = originalFetch;
  registerChatWebTransportAdapter(null);
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

  it("WebTransport用Chat Tokenだけを要求し、ネイティブ未対応時はREST同期を使う", async () => {
    let requestedBody = "";
    globalThis.fetch = (async (_input, init) => {
      requestedBody = String(init?.body);
      return new Response(JSON.stringify({
        data: {
          chat_token: "chat-jws",
          expires_at: "2026-08-30T00:02:00Z",
          transport: "webtransport",
        },
      }), { status: 200 });
    }) as typeof fetch;

    await expect(issueChatTransportToken("chat-1", session)).resolves.toMatchObject({
      chat_token: "chat-jws",
      transport: "webtransport",
    });

    expect(JSON.parse(requestedBody)).toEqual({ transport: "webtransport" });
    expect(chatRealtimeMode()).toBe("rest_sync");
  });

  it("Development BuildのアダプタにはWebTransport URLとAuthorizationヘッダーだけを渡す", async () => {
    const captured = {
      value: undefined as {
      url: string;
      headers: Record<string, string>;
      } | undefined,
    };
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      data: {
        chat_token: "short-lived-chat-token",
        expires_at: "2026-08-30T00:02:00Z",
        transport: "webtransport",
      },
    }), { status: 200 })) as unknown as typeof fetch;
    registerChatWebTransportAdapter({
      connect: async (input) => {
        captured.value = { url: input.url, headers: input.headers };
        return { close: () => undefined };
      },
    });

    const transport = await connectChatWebTransport("chat 1", session, {
      onFrame: () => undefined,
      onClose: () => undefined,
    });

    expect(chatRealtimeMode()).toBe("webtransport");
    expect(chatWebTransportURL("chat 1", "https://example.com/api/v1")).toBe("https://example.com/api/v1/wt/chats/chat%201");
    const actualAdapterInput = captured.value;
    if (!actualAdapterInput) throw new Error("adapter did not receive a connection request");
    expect(actualAdapterInput).toEqual({
      url: expect.stringContaining("/wt/chats/chat%201"),
      headers: { Authorization: "Bearer short-lived-chat-token" },
    });
    expect(actualAdapterInput.url).not.toContain("short-lived-chat-token");
    expect(transport.expiresAt).toBe("2026-08-30T00:02:00Z");
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
      fixedKeyB,
    );
    const parsed = JSON.parse(requestedBody) as Record<string, unknown>;

    expect(parsed.client_message_id).toBe("client-1");
    expect(parsed.algorithm).toBe("AES-256-GCM");
    expect(requestedBody).not.toContain("改札前");
    expect(decryptChatMessage("chat-1", message, fixedKeyB)).toBe("改札前で待ち合わせしましょう。");
  });

  it("送信前Moderationは平文を専用endpointだけへ送り、blocked時は暗号文送信を開始しない", async () => {
    const requests: { url: string; body: string }[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      requests.push({ url, body });
      if (url.includes("/moderation")) {
        return new Response(JSON.stringify({ data: { decision: "blocked" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 201 });
    }) as typeof fetch;

    const result = await moderateAndSendChatMessage("chat-1", "危険な本文", session);
    expect(result).toEqual({ decision: "blocked" });
    // The helper is the UI's send gate. Its request trace proves blocked text
    // never reaches encryption-backed /messages delivery.
    expect(requests).toEqual([{ url: expect.stringContaining("/chats/chat-1/moderation"), body: JSON.stringify({ text: "危険な本文" }) }]);
    expect(requests[0]?.body).not.toContain("ciphertext");
  });

  it("moderation_unavailableでは暗号文送信を中断する", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: { decision: "unavailable", code: "moderation_unavailable" },
    }), { status: 200 })) as unknown as typeof fetch;

    await expect(moderateChatMessage("chat-1", "確認したいです", session)).resolves.toBe("unavailable");
    globalThis.fetch = (async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ data: { decision: "unavailable", code: "moderation_unavailable" } }), { status: 200 });
    }) as typeof fetch;
    await expect(moderateAndSendChatMessage("chat-1", "確認したいです", session)).resolves.toEqual({ decision: "unavailable" });
    expect(requests).toEqual([expect.stringContaining("/chats/chat-1/moderation")]);
  });

  it("moderation endpointの5xxでは暗号文送信を開始しない", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ error: "moderation_unavailable" }), { status: 503 });
    }) as typeof fetch;

    await expect(moderateAndSendChatMessage("chat-1", "確認したいです", session)).rejects.toMatchObject({ status: 503 });
    expect(requests).toEqual([expect.stringContaining("/chats/chat-1/moderation")]);
  });

  it("位置共有も座標を平文API bodyへ入れず、期限付き型付きメッセージとして送る", async () => {
    let requestedBody = "";
    globalThis.fetch = (async (_input, init) => {
      requestedBody = String(init?.body);
      const body = JSON.parse(requestedBody) as Partial<EncryptedChatMessage>;
      return new Response(JSON.stringify({ data: { ...body, id: "location-1", chat_id: "chat-1", sender_user_id: "user-1", sequence: 2, created_at: "2026-08-30T00:00:00Z" } }), { status: 201 });
    }) as typeof fetch;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const message = await sendChatLocation("chat-1", { latitude: 35.681236, longitude: 139.767125, display_name: "Tokyo Station", accuracy_m: 20 }, session, expiresAt, "location-client-1", undefined, fixedRandom, fixedKeyB);
    expect(JSON.parse(requestedBody)).toMatchObject({ content_type: "location", expires_at: expiresAt });
    expect(requestedBody).not.toContain("35.681236");
    expect(toChatMessageView("chat-1", message, "user-1", fixedKeyB).location).toMatchObject({ latitude: 35.681236, longitude: 139.767125, display_name: "Tokyo Station" });
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
    const encrypted = await encryptChatPlaintext("chat-1", "Hello", fixedKeyB, fixedRandom);
    const message: EncryptedChatMessage = {
      id: "message-1",
      chat_id: "chat-1",
      sender_user_id: "user-1",
      client_message_id: "client-1",
      sequence: 1,
      created_at: "2026-08-30T00:00:00Z",
      ...encrypted,
    };

    expect(toChatMessageView("chat-1", message, "user-1", fixedKeyB)).toMatchObject({
      plaintext: "Hello",
      mine: true,
    });
  });

  it("新しいチャット本文はKey-Bを秘密入力にし、chat_idだけでは復号できない", async () => {
    const encrypted = await encryptChatPlaintext("chat-1", "Key-B protected", fixedKeyB, fixedRandom);
    const message: EncryptedChatMessage = {
      id: "keyb-message-1",
      chat_id: "chat-1",
      sender_user_id: "user-1",
      client_message_id: "keyb-client-1",
      sequence: 5,
      created_at: "2026-08-30T00:00:00Z",
      ...encrypted,
    };

    expect(message.key_version).toBe("chat-keyb-v1");
    expect(decryptChatMessage("chat-1", message)).toBeNull();
    expect(decryptChatMessage("chat-1", message, new Uint8Array(32).fill(8))).toBeNull();
    expect(decryptChatMessage("other-chat", message, fixedKeyB)).toBeNull();
    expect(decryptChatMessage("chat-1", message, fixedKeyB)).toBe("Key-B protected");
  });

  it("本文の翻訳、編集、削除APIをそれぞれの契約で呼び出す", async () => {
    const requests: { url: string; method: string; body: string }[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      const body = String(init?.body ?? "");
      requests.push({ url, method, body });
      if (url.endsWith("/translate")) {
        return new Response(JSON.stringify({ data: { cached: false, source_language: "en", translated_text: "こんにちは", target_language: "ja", message_revision: "2026-08-30T00:00:00Z" } }), { status: 200 });
      }
      if (method === "PUT") {
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") {
        const encrypted = JSON.parse(body) as Record<string, unknown>;
        return new Response(JSON.stringify({ data: {
          ...encrypted,
          id: "message-1",
          chat_id: "chat-1",
          sender_user_id: "user-1",
          client_message_id: "client-1",
          sequence: 1,
          content_type: "text",
          created_at: "2026-08-30T00:00:00Z",
          edited_at: "2026-08-30T00:01:00Z",
        } }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const translationRevision = "2026-08-30T00:00:00Z";
    await expect(translateChatMessage("chat-1", "message-1", translationRevision, "Hello", "ja", session, undefined, fixedKeyB, fixedRandom)).resolves.toMatchObject({
      source_language: "en",
      translated_text: "こんにちは",
      target_language: "ja",
    });
    const updated = await updateChatMessage("chat-1", "message-1", "Updated", session, undefined, fixedRandom, fixedKeyB);
    await deleteChatMessage("chat-1", "message-1", session);

    expect(requests.map((request) => request.method)).toEqual(["POST", "PUT", "PATCH", "DELETE"]);
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ message_id: "message-1", text: "Hello", target_language: "ja" });
    const savedTranslation = JSON.parse(requests[1]?.body ?? "{}");
    expect(savedTranslation).not.toHaveProperty("translated_text");
    expect(decryptChatTranslation("chat-1", "message-1", translationRevision, savedTranslation, fixedKeyB)).toMatchObject({
      source_language: "en",
      translated_text: "こんにちは",
      target_language: "ja",
    });
    expect(requests[2]?.body).not.toContain("Updated");
    expect(updated.key_version).toBe("chat-keyb-v1");
    expect(requests[2]?.url).toContain("/chats/chat-1/messages/message-1");
  });

  it("保存済み翻訳はKey-Bで復号し、再度保存しない", async () => {
    const revision = "2026-08-30T00:00:00Z";
    const cached = await encryptChatTranslation("chat-1", "message-1", revision, {
      source_language: "en",
      translated_text: "こんにちは",
      target_language: "ja",
    }, fixedKeyB, fixedRandom);
    const requests: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      requests.push(String(init?.method ?? "GET"));
      return new Response(JSON.stringify({ data: {
        cached: true,
        ...cached,
      } }), { status: 200 });
    }) as typeof fetch;

    await expect(translateChatMessage("chat-1", "message-1", revision, "Hello", "ja", session, undefined, fixedKeyB)).resolves.toMatchObject({
      source_language: "en",
      translated_text: "こんにちは",
      target_language: "ja",
    });
    expect(requests).toEqual(["POST"]);
  });

  it("画像メッセージは暗号化マーカーを本文として表示せず、recipientはuser_id+device_idを必須にする", () => {
    const publicKey = toBase64URL(new Uint8Array(32).fill(7));
    const recipients = parseChatAttachmentRecipients([{
      user_id: "user-1",
      device_id: "device-1",
      key_version: "x25519-v1",
      public_key: publicKey,
    }]);
    expect(recipients[0]).toMatchObject({ user_id: "user-1", device_id: "device-1" });
    expect(() => parseChatAttachmentRecipients([{
      device_id: "device-1",
      key_version: "x25519-v1",
      public_key: publicKey,
    }])).toThrow();

    const imageMessage: EncryptedChatMessage = {
      id: "image-1",
      chat_id: "chat-1",
      sender_user_id: "user-1",
      client_message_id: "image-client-1",
      sequence: 4,
      ciphertext: "marker-must-not-render",
      nonce: "nonce",
      algorithm: "AES-256-GCM",
      key_version: "chat-mvp-v1",
      content_type: "image",
      attachment_id: "attachment-1",
      created_at: "2026-08-30T00:00:00Z",
    };
    expect(toChatMessageView("chat-1", imageMessage, "user-1").plaintext).toBeNull();
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
