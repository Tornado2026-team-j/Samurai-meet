import { describe, expect, it, mock } from "bun:test";
import { join } from "node:path";

const noop = () => null;
const testDir = import.meta.dir;

mock.module("@expo/vector-icons", () => ({ MaterialIcons: noop }));
mock.module("expo-router", () => ({ useRouter: () => ({ push: noop }) }));
mock.module("expo-status-bar", () => ({ StatusBar: noop }));
mock.module("react-native", () => ({
  ActivityIndicator: noop,
  Pressable: noop,
  RefreshControl: noop,
  ScrollView: noop,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: noop,
  View: noop,
}));
mock.module("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }) }));
mock.module(join(testDir, "../components/ui/index.ts"), () => ({
  LoadingScreen: noop,
  LoadingSpinner: noop,
  RefreshLoadingIndicator: noop,
  colors: {
    brand: { sky: "#5ec5f5", gold: "#e7b454" },
    border: { default: "#e4e4e4", subtle: "#e4e4e4" },
    surface: { blueSoft: "#eff8ff" },
    text: { muted: "#949494", secondary: "#535353" },
  },
  spacing: { md: 8, xl: 16 },
}));
mock.module(join(testDir, "../hooks/useAuth.tsx"), () => ({ useAuth: () => ({}) }));
mock.module(join(testDir, "../hooks/useUnreadNotifications.ts"), () => ({ useUnreadNotifications: () => false }));
mock.module(join(testDir, "../services/onboarding.ts"), () => ({ loadLanguage: noop, subscribeLanguage: () => noop }));

const { formatApplicationBio } = await import("../app/foreigner/index");

const readScreen = (relativePath: string) => Bun.file(new URL(relativePath, import.meta.url)).text();

describe("ホーム画面の更新契約", () => {
  it("日本語ホームは復帰フォーカスではなく初回・条件変更・明示更新で取得する", async () => {
    const source = await readScreen("../app/japanese/index.tsx");

    expect(source).not.toContain("useFocusEffect");
    expect(source).toContain("const initialLoadStarted = useRef(false);");
    expect(source).toContain('loadRecruitmentsRef.current("initial")');
    expect(source).toContain('loadRecruitments("refresh", {');
    expect(source).toContain("<RefreshControl");
    expect(source).toContain("alwaysBounceVertical");
    expect(source).toContain('pointerEvents="box-none"');
  });

  it("日本語ホームはカード検索を優先し、位置保存と応募履歴を待たない", async () => {
    const source = await readScreen("../app/japanese/index.tsx");

    expect(source).toContain("SEARCH_LOCATION_CACHE_TTL_MS");
    expect(source).toContain("void updateCurrentLocation");
    expect(source).not.toContain("await updateCurrentLocation");
    expect(source).toContain("const locationRefresh = locationIsFresh");
    expect(source).not.toContain("coordinates = await getCurrentCoordinates()");
    expect(source).toContain("setRecruitments(refinedResult);");
    expect(source).toContain("setRecruitments(result);");
    expect(source).toContain("hydrated independently below");
    expect(source).toContain("activeSearchRequestRef");
    expect(source).toContain("previousRequest.controller.abort()");
    expect(source).not.toContain("loadInFlight.current");
    expect(source).toContain('availableFrom: "",');
  });

  it("外国人ホームは復帰フォーカスではなく初回取得とPull-to-Refreshだけを使う", async () => {
    const source = await readScreen("../app/foreigner/index.tsx");

    expect(source).not.toContain("useFocusEffect");
    expect(source).toContain("const initialLoadStarted = useRef(false);");
    expect(source).toContain('loadApplicationsRef.current("initial")');
    expect(source).toContain('loadApplications("refresh")');
    expect(source).toContain("<RefreshControl");
    expect(source).toContain("useDelayedLoading");
    expect(source).toContain("LoadingScreen");
    expect(source).toContain("RefreshLoadingIndicator");
    expect(source).toContain('colors={["transparent"]}');
    expect(source).toContain("getTabBarContentBottomPadding");
  });

  it("日時pickerは標準のonChangeで確定・キャンセルを処理する", async () => {
    const source = await readScreen("../app/japanese/filters.tsx");

    expect(source).toContain("onChange={handleDatePickerChange}");
    expect(source).not.toContain("onValueChange");
    expect(source).toContain('event.type === "dismissed"');
  });

  it("条件変更時だけ表示するリセットは金色にせず高コントラストで表示する", async () => {
    const source = await readScreen("../app/japanese/filters.tsx");

    expect(source).toContain("right={hasActiveFilters ? (");
    expect(source).toContain("hasActiveFilters && styles.resetButtonActive");
    expect(source).toContain("resetButtonActive: { backgroundColor: colors.surface.default }");
    expect(source).toContain("hasActiveFilters ? colors.text.primary");
    expect(source).toContain("resetTextActive: { color: colors.text.primary");
    expect(source).not.toContain("hasActiveFilters ? colors.brand.gold");
    expect(source).not.toContain("resetTextActive: { color: colors.brand.gold");
  });

  it("予定終了後の評価は日付ではなく終了時刻を基準にする", async () => {
    const source = await readScreen("../app/plans.tsx");
    const chatSource = await readScreen("../app/chat/[id].tsx");

    expect(source).toContain("isJSTScheduleEnded");
    expect(source).toContain("plan.recruitment.end_time");
    expect(source).toContain("setReviewPlan(completedPlan)");
    expect(source).toContain("reviewPromptedRef");
    expect(source).toContain("reviewPlan.recruitment.available_date");
    expect(source).toContain("reviewPlan.other_user.name");
    expect(source).toContain("reviewAlreadyLiked");
    expect(source).toContain("reviewTitle");
    expect(chatSource).toContain('if (match.status === "completed") return true;');
  });

  it("下部ナビはLINE風のテーマ連動半透明固定バーを使う", async () => {
    const source = await readScreen("../components/GlassTabBar.tsx");

    expect(source).toContain("useColorScheme");
    expect(source).toContain('tint={isDark ? "dark" : "light"}');
    expect(source).toContain('bar: "rgba(255, 255, 255, 0.84)"');
    expect(source).toContain("borderWidth: 0");
    expect(source).not.toContain("borderColor: visual.border");
    expect(source).toContain("LinearGradient");
    expect(source).toContain("styles.contentFade");
    expect(source).toContain("styles.bottomFade");
    expect(source).toContain('bottomFade: ["rgba(255, 255, 255, 0)", "rgba(255, 255, 255, 0.48)", "rgba(255, 255, 255, 0.92)"]');
    expect(source).toContain("bottom: -bottom");
    expect(source).toContain("top: 48");
    expect(source).not.toContain("contentShield");
    expect(source).toContain("router.replace(href)");
  });

  it("起動・認証待ち・主要一覧は共通の滑らかなロードリングを使う", async () => {
    const rootSource = await readScreen("../app/index.tsx");
    const guardSource = await readScreen("../app/_layout.tsx");
    const chatSource = await readScreen("../app/chat/index.tsx");
    const spinnerSource = await readScreen("../components/ui/LoadingSpinner.tsx");

    expect(rootSource).toContain("LoadingScreen");
    expect(guardSource).toContain("LoadingScreen");
    expect(chatSource).toContain("LoadingScreen");
    expect(chatSource).toContain("RefreshLoadingIndicator");
    expect(spinnerSource).toContain("Animated.timing(opacity");
    expect(spinnerSource).toContain("useNativeDriver: true");
    expect(spinnerSource).toContain("export const LOADING_SPINNER_SPEED_MS = 500");
    expect(spinnerSource).toContain("Easing.inOut(Easing.cubic)");
    expect(spinnerSource).toContain("Animated.delay");
    expect(spinnerSource).toContain("resetBeforeIteration: true");
    expect(spinnerSource).toContain("trackColor = \"rgba(31, 45, 61, 0.12)\"");
    expect(spinnerSource).toContain("borderWidth: Math.max(1, Math.round(size / 14))");
    expect(spinnerSource).toContain("borderColor: trackColor");
    expect(spinnerSource).toContain("borderTopColor: color");
    expect(spinnerSource).not.toContain("borderRightColor: color");
  });

  it("外国人ホームは構造化プロフィールJSONをそのまま描画しない", async () => {
    const source = await readScreen("../app/foreigner/index.tsx");

    expect(source).toContain("export function formatApplicationBio");
    expect(source).toContain("JSON.parse(trimmed)");
    expect(source).toContain("formatApplicationBio(application.other_user.bio, copy.noIntroduction)");
    expect(source).not.toContain("{application.other_user.bio || copy.noIntroduction}");
  });

  it("構造化プロフィールはfreeTextだけを表示し、JSONや不正値は隠す", () => {
    expect(formatApplicationBio(
      JSON.stringify({ monsterSeed: { skillTags: ["food"], freeText: "大阪の食文化を案内できます" } }),
      "自己紹介はありません。",
    )).toBe("大阪の食文化を案内できます");
    expect(formatApplicationBio(
      JSON.stringify({ monsterSeed: { skillTags: ["food"], freeText: "" } }),
      "自己紹介はありません。",
    )).toBe("自己紹介はありません。");
    expect(formatApplicationBio("  Osaka guide  ", "No introduction provided.")).toBe("Osaka guide");
    expect(formatApplicationBio("{not-json", "No introduction provided.")).toBe("{not-json");
  });
});
