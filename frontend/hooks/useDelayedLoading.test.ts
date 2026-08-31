import { expect, test } from "bun:test";
import {
  DEFAULT_LOADING_DELAY_MS,
  DEFAULT_MIN_LOADING_MS,
  getDelayedLoadingPhase,
} from "./useDelayedLoading";

test("短いロードではローディングを表示しない", () => {
  expect(DEFAULT_LOADING_DELAY_MS).toBe(200);
  expect(getDelayedLoadingPhase({
    loading: true,
    loadingStartedAt: 0,
    visibleSince: null,
    now: 199,
  })).toBe("pending");
  expect(getDelayedLoadingPhase({
    loading: false,
    loadingStartedAt: 0,
    visibleSince: null,
    now: 199,
  })).toBe("hidden");
});

test("表示したローディングは最低時間まで維持する", () => {
  expect(DEFAULT_MIN_LOADING_MS).toBe(200);
  expect(getDelayedLoadingPhase({
    loading: false,
    loadingStartedAt: 0,
    visibleSince: 200,
    now: 399,
  })).toBe("visible");
  expect(getDelayedLoadingPhase({
    loading: false,
    loadingStartedAt: 0,
    visibleSince: 200,
    now: 400,
  })).toBe("hidden");
});
