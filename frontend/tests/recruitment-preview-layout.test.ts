import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("募集プレビュー fallback のレイアウト契約", () => {
  it("固定高に閉じ込めず、キーボード対応のスクロール末尾に戻る導線を置く", async () => {
    const source = await Bun.file(join(root, "app/tabs/index.tsx")).text();
    const confirmationStart = source.indexOf("styles.confirmationContent");
    const confirmationScrollEnd = source.indexOf("</ScrollView>", confirmationStart);
    const footer = source.indexOf("styles.confirmationFooter", confirmationStart);

    expect(source).not.toContain("CONFIRMATION_HEADER_HEIGHT");
    expect(source).toContain("const viewportConfirmationHeight = Math.max(");
    expect(source).toContain("const compactConfirmationHeight = Math.min(");
    expect(source).toContain("manualFallbackVisible || previewStatus === \"success\"");
    expect(source).toContain("windowHeight,");
    expect(source).toContain("styles.confirmationKeyboardAvoiding");
    expect(source).toContain("automaticallyAdjustKeyboardInsets");
    expect(source).toContain('keyboardDismissMode="on-drag"');
    expect(source).toContain("paddingBottom: Math.max(insets.bottom + 24, 40)");
    expect(footer).toBeGreaterThan(confirmationStart);
    expect(footer).toBeLessThan(confirmationScrollEnd);
  });
});
