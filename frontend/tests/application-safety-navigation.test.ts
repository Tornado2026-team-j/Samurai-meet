import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function readScreen(relativePath: string): Promise<string> {
  return Bun.file(join(root, relativePath)).text();
}

describe("応募詳細の安全なID契約", () => {
  it("外国人側はmatch IDの404時に募集一覧から別応募を選ばない", async () => {
    const source = await readScreen("app/foreigner/applications/[id].tsx");

    expect(source).toContain("getMatch(applicationId");
    expect(source).not.toContain("listMatches");
    expect(source).not.toContain("recruitmentID");
  });

  it("日本人側の応募状態画面はmatch IDだけを取得キーにする", async () => {
    const source = await readScreen("app/japanese/guide-requested.tsx");

    expect(source).toContain("getMatch(currentMatchID");
    expect(source).not.toContain("listMatches");
    expect(source).not.toContain("currentRecruitmentID");
  });
});

describe("応募履歴・募集管理の戻る導線", () => {
  it("応募履歴はsafe area対応のヘッダーに履歴なし時の戻り先を持つ", async () => {
    const source = await readScreen("app/japanese/applications.tsx");

    expect(source).toContain("useSafeAreaInsets");
    expect(source).toContain("router.canGoBack()");
    expect(source).toContain('router.replace("/japanese")');
    expect(source).toContain('name="chevron-left"');
    expect(source).toContain("accessibilityLabel={copy.back}");
  });

  it("募集管理はsafe area対応のヘッダーにプロフィールへの戻り先を持つ", async () => {
    const source = await readScreen("app/recruitments/mine.tsx");

    expect(source).toContain("useSafeAreaInsets");
    expect(source).toContain("router.canGoBack()");
    expect(source).toContain('router.replace("/profile")');
    expect(source).toContain('name="chevron-left"');
    expect(source).toContain("accessibilityLabel={copy.back}");
  });
});

describe("募集・応募画面の手動更新と操作ガード", () => {
  it("募集管理は手動Refreshだけで再読み込みし、期限と状態を絞り込める", async () => {
    const source = await readScreen("app/recruitments/mine.tsx");

    expect(source).toContain("RefreshControl");
    expect(source).toContain("onRefresh={() => loadManagement()}");
    expect(source).toContain("loadInFlightRef");
    expect(source).toContain("isRecruitmentExpired");
    expect(source).toContain('"expired"');
    expect(source).not.toContain("useFocusEffect");
  });

  it("応募履歴は進行中・期限切れ・終了済みを手動で切り替えられる", async () => {
    const source = await readScreen("app/japanese/applications.tsx");

    expect(source).toContain("APPLICATION_FILTERS");
    expect(source).toContain("matchesApplicationFilter");
    expect(source).toContain("RefreshControl");
    expect(source).toContain("loadInFlightRef");
    expect(source).toContain("withdrawingIDRef");
    expect(source).not.toContain("useFocusEffect");
  });

  it("応募詳細は手動Refreshと承認・却下の同時実行ガードを持つ", async () => {
    const source = await readScreen("app/foreigner/applications/[id].tsx");

    expect(source).toContain("RefreshControl");
    expect(source).toContain("onRefresh={loadApplication}");
    expect(source).toContain("loadInFlightRef");
    expect(source).toContain("actionInFlightRef");
    expect(source).toContain('router.replace("/foreigner")');
    expect(source).not.toContain("useFocusEffect");
  });
});
