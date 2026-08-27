import { afterEach, describe, expect, it } from "bun:test";
import {
  createRecruitment,
  listMatches,
  recruitmentToMatchCard,
  searchRecruitments,
} from "../services/matching";
import type { Recruitment } from "../services/matching";

const originalFetch = globalThis.fetch;
const session = {
  user_id: "user-1",
  session_id: "session-1",
  access_token: "access-token",
  refresh_token: "refresh-token",
};

const recruitment: Recruitment = {
  id: "recruitment-1",
  category: "Food",
  author_name: "Mika",
  nationality_code: "JP",
  rating: 0,
  available_date: "2026-08-27",
  start_time: "18:00",
  end_time: "20:00",
  timezone: "Asia/Tokyo",
  duration_hours: 2,
  keywords: ["local", "culture"],
  description: "A local dinner.",
  visibility_radius_km: 3,
  distance_band: "within_1_km",
  status: "open",
  expires_at: "2026-08-27T11:00:00Z",
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("募集APIクライアント", () => {
  it("検索条件をAPIのqueryへ変換する", async () => {
    let requestedURL = "";
    globalThis.fetch = (async (input) => {
      requestedURL = String(input);
      return new Response(JSON.stringify({ data: [recruitment] }), { status: 200 });
    }) as typeof fetch;

    const result = await searchRecruitments(session, {
      keywords: ["local guide"],
      availableDate: "2026-08-27",
      latitude: 35.68,
      longitude: 139.76,
      radiusKm: 3,
      limit: 50,
    });

    expect(result).toHaveLength(1);
    expect(requestedURL).toContain("keyword=local%20guide");
    expect(requestedURL).toContain("available_date=2026-08-27");
    expect(requestedURL).toContain("radius_km=3");
    expect(requestedURL).toContain("limit=50");
  });

  it("募集作成のPOST bodyにバックエンド契約をそのまま渡す", async () => {
    let requestedInit: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestedInit = init;
      return new Response(JSON.stringify({ data: recruitment }), { status: 201 });
    }) as typeof fetch;

    await createRecruitment(session, {
      category: "Food",
      available_date: "2026-08-27",
      start_time: "18:00",
      end_time: "20:00",
      timezone: "Asia/Tokyo",
      keywords: ["local"],
      description: "A local dinner.",
      visibility_radius_km: 3,
      latitude: 35.68,
      longitude: 139.76,
      location_accuracy_m: 20,
      status: "open",
    });

    expect(requestedInit?.method).toBe("POST");
    expect(JSON.parse(String(requestedInit?.body))).toMatchObject({
      available_date: "2026-08-27",
      visibility_radius_km: 3,
      status: "open",
      latitude: 35.68,
    });
  });

  it("外国人側のマッチ一覧は保留中以外の状態も取得する", async () => {
    let requestedURL = "";
    globalThis.fetch = (async (input) => {
      requestedURL = String(input);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    await listMatches(session, { role: "owner", limit: 50 });

    expect(requestedURL).toContain("role=owner");
    expect(requestedURL).toContain("limit=50");
    expect(requestedURL).not.toContain("status=pending");
  });

  it("バックエンド募集を既存カード表示へ変換する", () => {
    expect(recruitmentToMatchCard(recruitment)).toMatchObject({
      id: "recruitment-1",
      authorName: "Mika",
      countryFlag: "🇯🇵",
      countryName: "Japan",
      date: "August,27 2026",
      detailDate: "Aug 27, 2026 (Thu)",
      tags: ["local", "culture"],
      expiresAt: "2026/08/27",
    });
  });
});
