import { afterEach, describe, expect, it } from "bun:test";
import {
  isNotificationRecord,
  listNotifications,
  markNotificationRead,
  toNotificationView,
} from "../services/notifications";
import type { NotificationRecord } from "../types/notification";

const originalFetch = globalThis.fetch;
const session = {
  user_id: "user-1",
  session_id: "session-1",
  access_token: "access-token",
  refresh_token: "refresh-token",
};

const record: NotificationRecord = {
  id: "notification-1",
  type: "new_application",
  target_id: "match-1",
  recruitment_id: "recruitment-1",
  destination: "applicants",
  actor_name: "Alex",
  created_at: "2026-08-27T11:58:00Z",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("通知APIクライアント", () => {
  it("サーバーの通知一覧を取得し、不正な項目を表示へ流さない", async () => {
    let requestedURL = "";
    globalThis.fetch = (async (input) => {
      requestedURL = String(input);
      return new Response(JSON.stringify({
        data: [record, { ...record, type: "unknown" }],
      }), { status: 200 });
    }) as typeof fetch;

    const result = await listNotifications(session, { unreadOnly: true, limit: 50 });

    expect(result).toEqual([record]);
    expect(requestedURL).toContain("unread_only=true");
    expect(requestedURL).toContain("limit=50");
  });

  it("通知を既読にするエンドポイントをPOSTする", async () => {
    let requestedURL = "";
    let requestedMethod = "";
    globalThis.fetch = (async (input, init) => {
      requestedURL = String(input);
      requestedMethod = String(init?.method);
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await markNotificationRead(session, "notification-1");

    expect(requestedURL).toContain("/notifications/notification-1/read");
    expect(requestedMethod).toBe("POST");
  });

  it("通知を役割に依存しない日本語・英語表示へ変換する", () => {
    const now = new Date("2026-08-27T12:00:00Z");

    expect(toNotificationView(record, "en", now)).toMatchObject({
      title: "New application",
      message: "Alex applied to your recruitment.",
      receivedAt: "2m",
      unread: true,
      period: "today",
      targetId: "match-1",
    });
    expect(toNotificationView(record, "ja", now)).toMatchObject({
      title: "新しい応募",
      message: "Alexさんがあなたの募集に応募しました",
      receivedAt: "2分前",
    });
  });

  it("通知レコードの必須フィールドを検証する", () => {
    expect(isNotificationRecord(record)).toBe(true);
    expect(isNotificationRecord({ ...record, target_id: "" })).toBe(false);
    expect(isNotificationRecord({ ...record, destination: "unknown" })).toBe(false);
  });
});
