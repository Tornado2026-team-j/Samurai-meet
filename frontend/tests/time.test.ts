import { describe, expect, it } from "bun:test";
import {
  calculateFinishTime,
  formatTimeRange,
  isJSTScheduleEnded,
  shiftTime,
} from "../utils/time";

describe("時刻表示", () => {
  it("開始時刻に所要時間を足して範囲を表示する", () => {
    expect(formatTimeRange("14:30", 2)).toBe("14:30~16:30");
  });

  it("分と時間を繰り上げる", () => {
    expect(calculateFinishTime("14:45", 1.5)).toBe("16:15");
  });

  it("終了時刻が翌日になる場合は0時台へ繰り上げる", () => {
    expect(formatTimeRange("23:30", 2)).toBe("23:30~01:30");
  });

  it("開始時刻の分変更でも時間を繰り上げ、繰り下げる", () => {
    expect(shiftTime("14:55", 5)).toBe("15:00");
    expect(shiftTime("00:00", -5)).toBe("23:55");
  });

  it("予定終了後は終了扱いにし、同日の終了前はまだ終了扱いにしない", () => {
    const end = "2026-09-04";
    expect(isJSTScheduleEnded(end, "08:30", new Date("2026-09-04T00:00:00.000Z"))).toBe(true);
    expect(isJSTScheduleEnded(end, "08:30", new Date("2026-09-03T23:29:59.000Z"))).toBe(false);
  });

  it("不正な予定日時は終了扱いにしない", () => {
    expect(isJSTScheduleEnded("2026-02-31", "08:30", new Date("2026-09-04T00:00:00.000Z"))).toBe(false);
  });
});
