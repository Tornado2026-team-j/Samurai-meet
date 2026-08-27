import { expect, test } from "bun:test";
import {
  isProtectedRoute,
  shouldRedirectToSignedOutRoot,
  shouldResetSignedOutNavigation,
} from "../services/route-guard";

test("認証が必要な画面と公開画面を区別する", () => {
  expect(isProtectedRoute("/foreigner")).toBe(true);
  expect(isProtectedRoute("/foreigner/applications/application-1")).toBe(true);
  expect(isProtectedRoute("/japanese/matches/match-1")).toBe(true);
  expect(isProtectedRoute("/profile?from=menu")).toBe(true);
  expect(isProtectedRoute("/recruitments/mine")).toBe(true);
  expect(isProtectedRoute("/tabs")).toBe(true);

  expect(isProtectedRoute("/")).toBe(false);
  expect(isProtectedRoute("/auth/complete")).toBe(false);
  expect(isProtectedRoute("/passkey")).toBe(false);
  expect(isProtectedRoute("/japan")).toBe(false);
});

test("未認証時は保護画面を言語選択ルートへ戻す", () => {
  expect(shouldRedirectToSignedOutRoot("loading", "/japanese")).toBe(false);
  expect(shouldRedirectToSignedOutRoot("signed_in", "/japanese")).toBe(false);
  expect(shouldRedirectToSignedOutRoot("pre_auth", "/japanese/matches/match-1")).toBe(true);
  expect(shouldRedirectToSignedOutRoot("signed_out", "/profile")).toBe(true);
  expect(shouldRedirectToSignedOutRoot("signed_out", "/")).toBe(false);
});

test("認証済み状態からのログアウトで履歴をリセットする", () => {
  expect(shouldResetSignedOutNavigation("signed_in", "signed_out")).toBe(true);
  expect(shouldResetSignedOutNavigation("pre_auth", "signed_out")).toBe(true);
  expect(shouldResetSignedOutNavigation("loading", "signed_out")).toBe(false);
  expect(shouldResetSignedOutNavigation("signed_out", "signed_out")).toBe(false);
});
