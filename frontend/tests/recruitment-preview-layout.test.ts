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
    expect(source).toContain("const HOME_PEEK_HEIGHT = 96;");
    expect(source).toContain("const homePeekHeight = Math.max(HOME_PEEK_HEIGHT, insets.bottom + 72);");
    expect(source).toContain("windowHeight - homePeekHeight");
    expect(source).toContain("styles.confirmationKeyboardAvoiding");
    expect(source).toContain("automaticallyAdjustKeyboardInsets");
    expect(source).toContain('keyboardDismissMode="on-drag"');
    expect(source).toContain("paddingBottom: Math.max(insets.bottom + 24, 40)");
    expect(footer).toBeGreaterThan(confirmationStart);
    expect(footer).toBeLessThan(confirmationScrollEnd);
  });

  it("時刻選択は端末TZ依存のnative time pickerではなくJST壁時計値を直接編集する", async () => {
    const source = await Bun.file(join(root, "app/tabs/index.tsx")).text();

    expect(source).not.toContain('mode="time"');
    expect(source).toContain("const TIME_PICKER_HOURS = Array.from");
    expect(source).toContain("const TIME_PICKER_MINUTES = Array.from");
    expect(source).toContain("const [draftHour, setDraftHour] = useState(hour);");
    expect(source).toContain("const [draftMinute, setDraftMinute] = useState(minute);");
    expect(source).toContain("setHour(draftHour);");
    expect(source).toContain("setMinute(draftMinute);");
    expect(source).not.toContain("handleTimePickerChange");
    expect(source).not.toContain("pickerTimeRef");
  });

  it("Where候補の選択後に地図ピンとGoogle attributionを表示する", async () => {
    const source = await Bun.file(join(root, "app/tabs/index.tsx")).text();

    expect(source).toContain('import MapView, { Marker } from "react-native-maps";');
    expect(source).toContain("locationMapRegion");
    expect(source).toContain("<MapView");
    expect(source).toContain("<Marker");
    expect(source).toContain("styles.googleMapsAttribution");
    expect(source).toContain('googleMapsAttribution: "Google Maps"');
  });

  it("現在地マップからNearby候補をピン選択し、ここで会うで保存できる", async () => {
    const source = await Bun.file(join(root, "app/tabs/index.tsx")).text();

    expect(source).toContain("searchNearbyPlaces");
    expect(source).toContain("nearbyPlaces.map");
    expect(source).toContain("setPendingNearbyPlace(place)");
    expect(source).toContain("confirmNearbyPlace(pendingNearbyPlace)");
    expect(source).toContain('meetHere: "ここで会う"');
    expect(source).toContain("setSelectedLocationCoordinates(suggestion.coordinates)");
    expect(source).toContain("FORM_BASE_HEIGHT + whereExtraHeight");
    expect(source).toContain("locationSuggestions.length * LOCATION_SUGGESTION_ROW_HEIGHT");
  });
});
