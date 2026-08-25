import { describe, expect, it } from "bun:test";
import { buildMockRecruitmentPreview } from "../mocks/recruitment";
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
});
