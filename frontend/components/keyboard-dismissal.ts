export type KeyboardTapTarget = "input" | "outside";

export type KeyboardDismissApi = {
  dismiss: () => void;
};

export function dismissKeyboardForTap(
  keyboard: KeyboardDismissApi,
  target: KeyboardTapTarget,
): boolean {
  if (target !== "outside") return false;
  keyboard.dismiss();
  return true;
}
