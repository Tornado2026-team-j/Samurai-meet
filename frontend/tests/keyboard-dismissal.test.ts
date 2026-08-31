import { expect, test } from "bun:test";
import { dismissKeyboardForTap, type KeyboardDismissApi } from "../components/keyboard-dismissal";

test("keeps the keyboard for input taps and dismisses it for outside taps", () => {
  let dismissCount = 0;
  const keyboard: KeyboardDismissApi = {
    dismiss: () => {
      dismissCount += 1;
    },
  };

  expect(dismissKeyboardForTap(keyboard, "input")).toBe(false);
  expect(dismissCount).toBe(0);
  expect(dismissKeyboardForTap(keyboard, "outside")).toBe(true);
  expect(dismissCount).toBe(1);
});
