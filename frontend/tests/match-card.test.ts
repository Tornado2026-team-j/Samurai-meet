import { describe, expect, it } from "bun:test";
import { getMatchCardCopy, getMatchCardStatusLabel } from "../services/matching";

describe("MatchCard表示文言", () => {
  it("選択中の言語で日時と期限を表示する", () => {
    expect(getMatchCardCopy("ja").date).toBe("日付");
    expect(getMatchCardCopy("ja").expiry("2026/08/28")).toBe("2026/08/28まで");
    expect(getMatchCardCopy("en").date).toBe("Date");
    expect(getMatchCardCopy("en").expiry("2026/08/28")).toBe("Until 2026/08/28");
  });

  it("応募状態を選択中の言語へ変換する", () => {
    expect(getMatchCardStatusLabel("pending", "ja")).toBe("応募中");
    expect(getMatchCardStatusLabel("pending", "en")).toBe("Pending");
    expect(getMatchCardStatusLabel("completed", "en")).toBe("Completed");
    expect(getMatchCardStatusLabel("cancelled", "ja")).toBe("取消済み");
    expect(getMatchCardStatusLabel(undefined, "en")).toBeNull();
  });
});
