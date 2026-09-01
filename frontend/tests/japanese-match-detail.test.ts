import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const screenPath = join(import.meta.dir, "../app/japanese/matches/[id].tsx");

describe("日本語募集詳細の本番API失敗時フォールバック", () => {
  it("API取得失敗時にモック募集を詳細表示へ昇格させない", async () => {
    const source = await Bun.file(screenPath).text();

    expect(source).not.toContain("findMockMatchById");
    expect(source).not.toContain("../../../mocks/matches");
    expect(source).toContain("setMatch(null);");
    expect(source).toContain('setLoadState("error");');
    expect(source).toContain("setLoadError(copyRef.current.loadError);");
  });

  it("API失敗画面から再試行できる", async () => {
    const source = await Bun.file(screenPath).text();

    expect(source).toContain("setLoadAttempt((attempt) => attempt + 1);");
    expect(source).toContain("accessibilityLabel={copy.retry}");
    expect(source).toContain("retryButton");
  });
});
