import { afterEach, describe, expect, it } from "bun:test";
import {
  getNotificationNavigation,
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
      recruitmentId: "recruitment-1",
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

  it("新しい応募は表示言語に関係なく構造化IDから承認画面へ遷移する", () => {
    const english = getNotificationNavigation(toNotificationView(record, "en"));
    const japanese = getNotificationNavigation(toNotificationView(record, "ja"));

    expect(english).toEqual({
      pathname: "/foreigner/applications/[id]",
      params: { id: "match-1", recruitmentId: "recruitment-1" },
    });
    expect(japanese).toEqual(english);
  });

  it("応募結果は表示文言を使わずmatch_idで応募状態画面へ遷移する", () => {
    const english = getNotificationNavigation(toNotificationView({
      ...record,
      type: "match_confirmed",
      target_id: "match-accepted",
      destination: "guide_detail",
    }, "en"));
    const japanese = getNotificationNavigation(toNotificationView({
      ...record,
      type: "match_confirmed",
      target_id: "match-accepted",
      destination: "guide_detail",
    }, "ja"));

    expect(english).toEqual({
      pathname: "/japanese/guide-requested",
      params: { matchId: "match-accepted" },
    });
    expect(japanese).toEqual(english);
  });

  it("応募者詳細への遷移はIDを正規化し、募集IDがなくても成立する", () => {
    expect(getNotificationNavigation({
      type: "new_application",
      targetId: "  match-2  ",
      recruitmentId: "",
    })).toEqual({
      pathname: "/foreigner/applications/[id]",
      params: { id: "match-2" },
    });
  });

  it("新しいメッセージ通知はchat_idでチャット画面へ遷移する", () => {
    expect(getNotificationNavigation({
      type: "new_message",
      targetId: " chat-1 ",
      recruitmentId: "recruitment-1",
    })).toEqual({
      pathname: "/chat/[id]",
      params: { id: "chat-1" },
    });
  });

  it("対象IDがない通知は安全に何も開かない", () => {
    expect(getNotificationNavigation({
      type: "new_application",
      targetId: "   ",
      recruitmentId: "recruitment-1",
    })).toBeNull();
    expect(getNotificationNavigation({
      type: "match_confirmed",
      targetId: "",
      recruitmentId: "recruitment-1",
    })).toBeNull();
  });
});
