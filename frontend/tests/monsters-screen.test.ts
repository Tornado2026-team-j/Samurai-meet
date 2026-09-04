import { describe, expect, test } from "bun:test";

const readScreen = () => Bun.file(new URL("../app/monsters.tsx", import.meta.url)).text();

describe("コレクション画面の表示契約", () => {
  test("棚は3列で、名前ではなく案内日を表示する", async () => {
    const source = await readScreen();

    expect(source).toContain("chunkByThree(items)");
    expect(source).toContain("index += 3");
    expect(source).toContain("formatShelfDate(displayDate(item)");
    expect(source).not.toContain("item.name");
    expect(source).toContain('resizeMode="contain"');
  });

  test("各キャラクターを押すと必要情報を含むモーダルを開く", async () => {
    const source = await readScreen();

    expect(source).toContain("onPress={() => openDetails(item)}");
    expect(source).toContain("<Modal");
    expect(source).toContain("selectedItem.location_name");
    expect(source).toContain("selectedItem.memorable_object");
    expect(source).toContain("selectedItem.memory_text");
    expect(source).toContain("sourcePhotos[selectedItem.id]");
  });

  test("loading・empty・errorを別々の状態として扱う", async () => {
    const source = await readScreen();

    expect(source).toContain("{loading ? (");
    expect(source).toContain(") : error ? (");
    expect(source).toContain(") : items.length === 0 ? (");
    expect(source).toContain("まだコレクションがありません");
  });
});
