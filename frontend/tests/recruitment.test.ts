import { describe, expect, it } from "bun:test";
import { buildRecruitmentPreviewModel } from "../services/recruitment-preview";
import {
  buildRecruitmentCreateRequest,
  defaultRecruitmentSchedule,
  defaultRecruitmentDate,
  formatRecruitmentDateInput,
  formatRecruitmentISODate,
  getRecruitmentScheduleIssue,
  normalizeRecruitmentDate,
  parseRecruitmentDateInput,
  recruitmentDateTimeToInstant,
  shiftRecruitmentDate,
} from "../services/recruitment";
import type { RecruitmentDraft } from "../types/recruitment";

const draft: RecruitmentDraft = {
  activity: "I want to eat takoyaki with a local guide",
  location: "Osaka,Umeda",
  useCurrentLocation: false,
  date: "2026-08-25",
  startTime: "14:30",
  durationHours: 2,
  participantLimit: 1,
  distanceKm: 3,
};

describe("募集プレビュー", () => {
	it("Geminiで確定したカテゴリと入力条件を確認カード用データへ変換する", () => {
		const preview = buildRecruitmentPreviewModel(draft, "Food");

    expect(preview.conditions).toEqual(draft);
    expect(preview.category).toBe("Food");
    expect(preview.tags).toEqual(["Takoyaki", "Local"]);
    expect(preview.expiresAt).toBe("August 25 at 16:30");
  });

  it("制作者情報をサービス応答として返す", () => {
		const preview = buildRecruitmentPreviewModel(draft, "Food");

    expect(preview.author).toEqual({
      id: "mock-current-user",
      displayName: "James Brown",
      avatarUrl: null,
      countryCode: "US",
    });
  });

  it("キーワードがない場合も2つのタグを返す", () => {
		const preview = buildRecruitmentPreviewModel({
			...draft,
			activity: "I want to explore Osaka",
		}, "Other");

    expect(preview.tags).toEqual(["Local", "Experience"]);
    expect(preview.category).toBe("Other");
  });

	it("カテゴリはGemini APIの4カテゴリ契約だけを受け入れる", () => {
    const categories = ["Food", "Places", "Activity", "Other"] as const;
		expect(categories.map((category) => buildRecruitmentPreviewModel(draft, category).category)).toEqual([...categories]);
	});

  it("公開用の日付をバックエンド形式へ変換する", () => {
    expect(defaultRecruitmentDate(new Date("2026-08-26T00:00:00.000Z"))).toBe(
      "2026-08-26",
    );
    expect(normalizeRecruitmentDate("August,27 2026")).toBe("2026-08-27");
    expect(normalizeRecruitmentDate("August 27, 2026")).toBe("2026-08-27");
    expect(normalizeRecruitmentDate("2026-08-27")).toBe("2026-08-27");
    expect(shiftRecruitmentDate("August,27 2026", 1)).toBe("2026-08-28");
  });

  it("ISO内部日付とJST表示日付を分離する", () => {
    const instant = new Date("2026-08-26T14:59:00.000Z");

    expect(formatRecruitmentISODate(instant)).toBe("2026-08-26");
    expect(formatRecruitmentDateInput(instant)).toBe("August,26 2026");
    expect(parseRecruitmentDateInput("2026-08-26").toISOString()).toBe(
      "2026-08-26T03:00:00.000Z",
    );
  });

  it("現在時刻の次の30分区切りを当日の初期時刻にする", () => {
    expect(
      defaultRecruitmentSchedule(new Date("2026-08-26T05:31:00.000Z")),
    ).toEqual({
      date: "2026-08-26",
      startTime: "15:00",
      durationHours: 1,
    });
  });

  it("JSTの深夜を越える次の30分を翌日のISO日付で返す", () => {
    expect(
      defaultRecruitmentSchedule(new Date("2026-08-26T14:31:00.000Z")),
    ).toMatchObject({
      date: "2026-08-27",
      startTime: "00:00",
    });
  });

  it("過去の時刻と日付またぎを公開前に区別する", () => {
    const now = new Date("2026-08-26T05:31:00.000Z");
    expect(
      getRecruitmentScheduleIssue(
        { ...draft, date: "2026-08-26", startTime: "14:30" },
        now,
      ),
    ).toBe("recruitment_date_in_past");
    expect(
      getRecruitmentScheduleIssue(
        {
          ...draft,
          date: "2026-08-26",
          startTime: "23:30",
          durationHours: 1,
        },
        now,
      ),
    ).toBe("recruitment_must_end_same_day");
  });

  it("JSTの日時をUTCの瞬間へ変換する", () => {
    expect(
      recruitmentDateTimeToInstant("2026-08-27", "14:30").toISOString(),
    ).toBe("2026-08-27T05:30:00.000Z");
  });

  it("プレビューを公開APIの入力へ変換し、現在地を含める", () => {
	const preview = buildRecruitmentPreviewModel({ ...draft, date: "2026-08-27" }, "Food");
    const request = buildRecruitmentCreateRequest(
      { ...draft, date: "2026-08-27", durationHours: 2 },
      preview,
      new Date("2026-08-26T00:00:00.000Z"),
      "America/Los_Angeles",
      { latitude: 35.68, longitude: 139.76, accuracy_m: 12 },
    );

    expect(request).toMatchObject({
      category: "Food",
      available_date: "2026-08-27",
      start_time: "14:30",
      end_time: "16:30",
      visibility_radius_km: 3,
      status: "open",
      timezone: "Asia/Tokyo",
      latitude: 35.68,
      longitude: 139.76,
      location_accuracy_m: 12,
    });
  });

  it("確認画面で選択したカテゴリとキーワードを公開API入力に反映する", () => {
	const preview = buildRecruitmentPreviewModel(
      { ...draft, date: "2026-08-27" },
      "Food",
    );

    const request = buildRecruitmentCreateRequest(
      { ...draft, date: "2026-08-27" },
      preview,
      new Date("2026-08-26T00:00:00.000Z"),
      undefined,
      undefined,
      {
        category: "Places",
        keywords: ["  temple  ", "Temple", "sightseeing"],
      },
    );

    expect(request.category).toBe("Places");
    expect(request.keywords).toEqual(["temple", "sightseeing"]);
  });

  it("下書き保存は過去日時を保持し、公開時だけ過去日時を拒否する", () => {
    const preview = buildRecruitmentPreviewModel(draft, "Food");
    const pastDraft = { ...draft, date: "2026-08-25" };
    const now = new Date("2026-08-26T00:00:00.000Z");

    expect(
      buildRecruitmentCreateRequest(
        pastDraft,
        preview,
        now,
        undefined,
        undefined,
        undefined,
        "draft",
      ),
    ).toMatchObject({ status: "draft", available_date: "2026-08-25" });
    expect(() => buildRecruitmentCreateRequest(pastDraft, preview, now)).toThrow(
      "recruitment_date_in_past",
    );
  });

  it("日付をまたぐ公開時刻を送信前に拒否する", () => {
	const preview = buildRecruitmentPreviewModel({ ...draft, date: "2026-08-27" }, "Food");

    expect(() =>
      buildRecruitmentCreateRequest(
        { ...draft, date: "2026-08-27", startTime: "23:30", durationHours: 1 },
        preview,
        new Date("2026-08-26T00:00:00.000Z"),
      ),
    ).toThrow("recruitment_must_end_same_day");
  });

  it("募集内容が空のまま公開API入力へ変換しない", () => {
	const preview = buildRecruitmentPreviewModel({ ...draft, date: "2026-08-27" }, "Food");

    expect(() =>
      buildRecruitmentCreateRequest(
        { ...draft, date: "2026-08-27", activity: "   " },
        preview,
        new Date("2026-08-26T00:00:00.000Z"),
      ),
    ).toThrow("invalid_recruitment_description");
  });
});
