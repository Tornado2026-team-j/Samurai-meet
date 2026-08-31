import { expect, test } from "bun:test";
import { createNavigationGuard } from "../utils/navigationGuard";

test("遷移中の連打を1回に抑え、完了後は再利用できる", () => {
  const guard = createNavigationGuard();

  expect(guard.begin()).toBe(true);
  expect(guard.begin()).toBe(false);
  guard.reset();
  expect(guard.begin()).toBe(true);
});
