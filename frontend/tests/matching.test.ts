import { afterEach, describe, expect, it } from "bun:test";
import { buildRecruitmentPreview } from "../mocks/recruitment";
import {
	closeRecruitment,
	classifyRecruitmentDescription,
  createRecruitment,
  listMatches,
  listMyRecruitments,
  recruitmentToMatchCard,
  searchRecruitments,
  sendRecruitmentInterest,
  updateRecruitment,
  withdrawRecruitmentInterest,
} from "../services/matching";
import { saveRecruitmentDraft } from "../services/recruitment";
import type { Recruitment, RecruitmentInterest } from "../services/matching";

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
  location_name: "Tokyo Station",
  participant_limit: 2,
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
      location_name: "Tokyo Station",
      participant_limit: 2,
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

  it("下書き保存はdraft状態でPOSTし、保存済みIDはPATCHで更新する", async () => {
    const requested: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      requested.push({ url: String(input), init });
      return new Response(JSON.stringify({ data: { ...recruitment, status: "draft" } }), { status: 200 });
    }) as typeof fetch;

    const draft = {
      activity: "I want to eat takoyaki with a local guide",
      location: "Osaka,Umeda",
      useCurrentLocation: false,
      date: "2099-08-27",
      startTime: "18:00",
      durationHours: 2,
      participantLimit: 1,
      distanceKm: 3 as const,
    };
    const preview = buildRecruitmentPreview(draft, "Food");
    const coordinates = { latitude: 35.68, longitude: 139.76, accuracy_m: 12 };

    await saveRecruitmentDraft(draft, preview, session, coordinates);
    await saveRecruitmentDraft(draft, preview, session, coordinates, undefined, undefined, "recruitment-1");

    expect(requested).toHaveLength(2);
    const createRequest = requested[0]!;
    const updateRequest = requested[1]!;
    expect(createRequest.init?.method).toBe("POST");
    expect(JSON.parse(String(createRequest.init?.body))).toMatchObject({ status: "draft" });
    expect(updateRequest.init?.method).toBe("PATCH");
    expect(updateRequest.url).toContain("/recruitments/recruitment-1");
    expect(JSON.parse(String(updateRequest.init?.body))).toMatchObject({ status: "draft" });
  });

	it("募集内容をサーバーのGemini分類APIへ送り、4カテゴリだけを受け取る", async () => {
		let requestedURL = "";
		let requestedInit: RequestInit | undefined;
		globalThis.fetch = (async (input, init) => {
			requestedURL = String(input);
			requestedInit = init;
			return new Response(JSON.stringify({ data: { category: "Places" } }), { status: 200 });
		}) as typeof fetch;

		await expect(classifyRecruitmentDescription("Please show me a temple.", session)).resolves.toBe("Places");
		expect(requestedURL).toContain("/recruitments/classify");
		expect(requestedInit?.method).toBe("POST");
		expect(JSON.parse(String(requestedInit?.body))).toEqual({ description: "Please show me a temple." });
	});

	it("廃止されたHeritageカテゴリを分類APIから受け入れない", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ data: { category: "Heritage" } }), { status: 200 })) as unknown as typeof fetch;

		await expect(classifyRecruitmentDescription("Please show me a temple.", session)).rejects.toThrow(
			"recruitment classification response is invalid",
		);
	});

  it("応募履歴はrequester roleで送信済み・承認済みを取得する", async () => {
    let requestedURL = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedURL = String(input);
      return new Response(JSON.stringify({
        data: [
          { id: "match-pending", status: "pending" },
          { id: "match-accepted", status: "accepted" },
        ],
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await listMatches(session, { role: "requester", limit: 50 });

    expect(result.map((item) => item.status)).toEqual(["pending", "accepted"]);
    expect(requestedURL).toContain("role=requester");
    expect(requestedURL).toContain("limit=50");
    expect(requestedURL).not.toContain("status=pending");
  });

  it("空配列と通信失敗を別の結果として扱う", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(listMatches(session, { role: "requester" })).resolves.toEqual([]);

    globalThis.fetch = (async () => {
      throw new Error("network unavailable");
    }) as unknown as typeof fetch;
    await expect(listMatches(session, { role: "requester" })).rejects.toThrow("network unavailable");
  });

  it("matchesのdata欠落を空履歴として扱わない", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;

    await expect(listMatches(session, { role: "requester" })).rejects.toThrow("matches response is invalid");
  });

  it("自分の募集管理APIと応募取り下げAPIの契約を組み立てる", async () => {
    const requests: { url: string; method?: string; body?: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method, body: init?.body as string | undefined });
      if (url.includes("/recruitments/mine")) {
        return new Response(JSON.stringify({ data: [recruitment] }), { status: 200 });
      }
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ data: recruitment }), { status: 200 });
      }
      if (url.includes("/withdraw")) {
        return new Response(JSON.stringify({
          data: {
            id: "match-1",
            recruitment_id: recruitment.id,
            status: "cancelled",
            created_at: recruitment.created_at,
            updated_at: recruitment.updated_at,
          },
        }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await expect(listMyRecruitments(session)).resolves.toHaveLength(1);
    await expect(updateRecruitment(recruitment.id, session, {
      category: "Places",
      available_date: "2026-08-28",
      start_time: "09:30",
      end_time: "11:00",
      description: "Updated description",
      timezone: "Asia/Tokyo",
      keywords: ["museum", "walk"],
      visibility_radius_km: 5,
    })).resolves.toMatchObject({ id: recruitment.id });
    await expect(closeRecruitment(recruitment.id, session)).resolves.toBeUndefined();
    await expect(withdrawRecruitmentInterest("match-1", session)).resolves.toMatchObject({ status: "cancelled" });

    expect(requests[0]?.url).toContain("/recruitments/mine");
    expect(requests[1]?.method).toBe("PATCH");
    expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({
      category: "Places",
      available_date: "2026-08-28",
      start_time: "09:30",
      end_time: "11:00",
      description: "Updated description",
      timezone: "Asia/Tokyo",
      keywords: ["museum", "walk"],
      visibility_radius_km: 5,
    });
    expect(requests[2]?.method).toBe("DELETE");
    expect(requests[3]?.url).toContain("/matches/match-1/withdraw");
  });

  it("既存応募の409 dataを既存matchとして返す", async () => {
    const existing: RecruitmentInterest = {
      id: "match-1",
      recruitment_id: recruitment.id,
      status: "pending",
      created_at: recruitment.created_at,
      updated_at: recruitment.updated_at,
    };
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: "interest_already_sent",
      data: existing,
    }), { status: 409 })) as unknown as typeof fetch;

    await expect(sendRecruitmentInterest(recruitment.id, session)).resolves.toEqual(existing);
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
