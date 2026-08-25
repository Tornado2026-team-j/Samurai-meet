import { describe, expect, it } from "bun:test";
import {
  calculateFinishTime,
  formatTimeRange,
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
});
