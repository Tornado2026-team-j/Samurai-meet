import { describe, expect, it } from "bun:test";
import { buildMockRecruitmentPreview } from "../mocks/recruitment";
import {
  buildRecruitmentCreateRequest,
  defaultRecruitmentDate,
  normalizeRecruitmentDate,
} from "../services/recruitment";
import type { RecruitmentDraft } from "../types/recruitment";

const draft: RecruitmentDraft = {
  activity: "I want to eat takoyaki with a local guide",
  location: "Osaka,Umeda",
  useCurrentLocation: false,
  date: "August 25, 2026",
  startTime: "14:30",
  durationHours: 2,
  distanceKm: 3,
};

describe("募集プレビューのモック", () => {
  it("入力条件と解析タグを確認カード用データへ変換する", () => {
    const preview = buildMockRecruitmentPreview(draft);

    expect(preview.conditions).toEqual(draft);
    expect(preview.category).toBe("Food");
    expect(preview.tags).toEqual(["Takoyaki", "Local"]);
    expect(preview.expiresAt).toBe("August 24");
  });

  it("制作者情報をサービス応答として返す", () => {
    const preview = buildMockRecruitmentPreview(draft);

    expect(preview.author).toEqual({
      id: "mock-current-user",
      displayName: "James Brown",
      avatarUrl: null,
      countryCode: "US",
    });
  });

  it("キーワードがない場合も2つのタグを返す", () => {
    const preview = buildMockRecruitmentPreview({
      ...draft,
      activity: "I want to explore Osaka",
    });

    expect(preview.tags).toEqual(["Local", "Experience"]);
    expect(preview.category).toBe("Other");
  });

  it("分類タグを必ず4カテゴリのいずれかで返す", () => {
    const activities = [
      "Visit a historic shrine",
      "Explore an art museum",
      "Go hiking together",
      "Find something unique",
    ];
    const categories = activities.map(
      (activity) =>
        buildMockRecruitmentPreview({ ...draft, activity }).category,
    );

    expect(categories).toEqual(["Places", "Places", "Activity", "Other"]);
  });

  it("公開用の日付をバックエンド形式へ変換する", () => {
    expect(defaultRecruitmentDate(new Date("2026-08-26T09:00:00+09:00"))).toBe(
      "August,27 2026",
    );
    expect(normalizeRecruitmentDate("August,27 2026")).toBe("2026-08-27");
    expect(normalizeRecruitmentDate("2026-08-27")).toBe("2026-08-27");
  });

  it("プレビューを公開APIの入力へ変換し、現在地を含める", () => {
    const preview = buildMockRecruitmentPreview({ ...draft, date: "2026-08-27" });
    const request = buildRecruitmentCreateRequest(
      { ...draft, date: "2026-08-27", durationHours: 2 },
      preview,
      new Date("2026-08-26T09:00:00+09:00"),
      "Asia/Tokyo",
      { latitude: 35.68, longitude: 139.76, accuracy_m: 12 },
    );

    expect(request).toMatchObject({
      category: "Food",
      available_date: "2026-08-27",
      start_time: "14:30",
      end_time: "16:30",
      visibility_radius_km: 3,
      status: "open",
      latitude: 35.68,
      longitude: 139.76,
      location_accuracy_m: 12,
    });
  });

  it("日付をまたぐ公開時刻を送信前に拒否する", () => {
    const preview = buildMockRecruitmentPreview({ ...draft, date: "2026-08-27" });

    expect(() =>
      buildRecruitmentCreateRequest(
        { ...draft, date: "2026-08-27", startTime: "23:30", durationHours: 1 },
        preview,
        new Date("2026-08-26T09:00:00+09:00"),
      ),
    ).toThrow("recruitment_must_end_same_day");
  });
});
