import { describe, expect, it } from "bun:test";
import { formatApplicationBio } from "../services/profile-format";

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
    expect(source).toContain('setRefreshing(mode === "refresh" && preserveContent)');
    expect(source).toContain("const [todayKey] = useState(todayDateKey);");
    expect(source).toContain("const dateSwipeBlockedRef = useRef(true);");
    expect(source).toContain("DATE_SWIPE_DOMINANCE_RATIO");
    expect(source).toContain("if (dateSwipeBlockedRef.current) return false;");
    expect(source).toContain("router.setParams({ date: item.dateKey });");
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

  it("Recovery Phrase操作は下部ナビの上までスクロールできる", async () => {
    const source = await readScreen("../components/RecoveryFlow.tsx");

    expect(source).toContain("getTabBarContentBottomPadding(insets.bottom)");
    expect(source).toContain("contentContainerStyle={[styles.content, { paddingBottom: getTabBarContentBottomPadding(insets.bottom) }]}");
  });

  it("外国人ホームは復帰フォーカスではなく初回取得とPull-to-Refreshだけを使う", async () => {
    const source = await readScreen("../app/foreigner/index.tsx");

    expect(source).not.toContain("useFocusEffect");
    expect(source).toContain("const initialLoadStarted = useRef(false);");
    expect(source).toContain('loadApplicationsRef.current("initial")');
    expect(source).toContain('loadApplications("refresh")');
    expect(source).toContain("<RefreshControl");
    expect(source).not.toContain("useDelayedLoading");
    expect(source).toContain("LoadingSpinner");
    expect(source).not.toContain("LoadingScreen");
    expect(source).toContain("useDisplayLanguage");
    expect(source).toContain("if (!language)");
    expect(source).not.toContain('useState<AppLanguage>("en")');
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

  it("募集管理では下書きの公開と公開停止から下書きへの復帰を提供する", async () => {
    const source = await readScreen("../app/recruitments/mine.tsx");

    expect(source).toContain("changeRecruitmentStatus");
    expect(source).toContain('changeRecruitmentStatus(recruitment, "open")');
    expect(source).toContain('changeRecruitmentStatus(recruitment, "draft")');
    expect(source).toContain("moveToDraftTitle");
    expect(source).toContain("DateTimePicker");
    expect(source).toContain("openEditDatePicker");
    expect(source).toContain("openEditTimePicker");
  });

  it("下書き保存後は募集管理へ進む", async () => {
    const source = await readScreen("../app/tabs/index.tsx");

    expect(source).toContain('router.replace("/recruitments/mine")');
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
    expect(source).toContain("setReviewPlan(null)");
    expect(source).toContain("reviewPromptedRef.current.delete(plan.id)");
    expect(source).not.toContain("setReviewPlan(completedPlan)");
    expect(source).toContain("reviewPromptedRef");
    expect(source).toContain("reviewPlan.recruitment.available_date");
    expect(source).toContain("reviewPlan.other_user.name");
    expect(source).toContain("reviewAlreadyLiked");
    expect(source).toContain("reviewTitle");
    expect(source).toContain("loadDeferredReviewMatchIDs");
    expect(source).toContain("deferReviewForMatch");
    expect(source).toContain("onPress={() => void deferReview()}");
    expect(source).toContain("canCreateMemoryMonster");
    expect(source).toContain("MEMORY_MONSTER_CREATION_WINDOW_MS");
    expect(source).toContain("Date.parse(plan.updated_at)");
    expect(source).toContain('pathname: "/meeting-result/[matchId]"');
    expect(chatSource).toContain('if (match.status === "completed") return true;');
  });

  it("下部ナビはLINE風のテーマ連動半透明固定バーを使う", async () => {
    const source = await readScreen("../components/GlassTabBar.tsx");
    const rootSource = await readScreen("../app/_layout.tsx");

    expect(source).toContain("useTheme");
    expect(source).toContain("const isDark = scheme === \"dark\";");
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
    expect(source).toContain("router.navigate(href)");
    expect(rootSource).toContain('animation: "default"');
    expect(rootSource).toContain("gestureEnabled: true");
  });

  it("プロフィール本体とアカウント設定を分け、設定画面にも下部ナビを維持する", async () => {
    const profileSource = await readScreen("../app/profile.tsx");
    const accountSettingsSource = await readScreen("../app/account-settings.tsx");
    const tabBarSource = await readScreen("../components/GlobalTabBar.tsx");
    const glassTabBarSource = await readScreen("../components/GlassTabBar.tsx");

    expect(profileSource).toContain("export function ProfileScreen");
    expect(profileSource).toContain("settingsOnly?: boolean");
    expect(profileSource).toContain('router.push("/account-settings")');
    expect(profileSource).toContain("headerSettingsButton");
    expect(profileSource).toContain("{!settingsOnly ? (");
    expect(profileSource).toContain("{settingsOnly ? (");
    expect(profileSource).toContain("settingsContent");
    expect(profileSource).toContain('title: "アカウント"');
    expect(accountSettingsSource).toContain('import { ProfileScreen } from "./profile"');
    expect(accountSettingsSource).toContain("<ProfileScreen settingsOnly />");
    expect(tabBarSource).toContain('pathname === "/profile" || pathname === "/account-settings"');
    expect(glassTabBarSource).toContain('profile: "アカウント"');
  });

  it("起動・認証待ち・主要一覧は共通の滑らかなロードリングを使う", async () => {
    const rootSource = await readScreen("../app/index.tsx");
    const guardSource = await readScreen("../app/_layout.tsx");
    const japaneseSource = await readScreen("../app/japanese/index.tsx");
    const foreignerSource = await readScreen("../app/foreigner/index.tsx");
    const chatSource = await readScreen("../app/chat/index.tsx");
    const plansSource = await readScreen("../app/plans.tsx");
    const profileSource = await readScreen("../app/profile.tsx");
    const tabsSource = await readScreen("../app/tabs/index.tsx");
    const glassTabBarSource = await readScreen("../components/GlassTabBar.tsx");
    const spinnerSource = await readScreen("../components/ui/LoadingSpinner.tsx");

    expect(rootSource).toContain("LoadingScreen");
    expect(guardSource).toContain("LoadingScreen");
    expect(chatSource).not.toContain("LoadingScreen");
    expect(japaneseSource).toContain("LoadingSpinner");
    expect(foreignerSource).toContain("LoadingSpinner");
    expect(chatSource).toContain("LoadingSpinner");
    expect(plansSource).toContain("LoadingSpinner");
    expect(profileSource).toContain("!profileLoaded");
    expect(profileSource).toContain("useDisplayLanguage");
    expect(tabsSource).toContain("if (!resolvedLanguage)");
    expect(glassTabBarSource).toContain("const labels = language ? TAB_LABELS[language] : null;");
    expect(glassTabBarSource).toContain("labels?.[item.key]");
    expect(glassTabBarSource).not.toContain("fallbackLanguage");
    expect(japaneseSource).not.toContain("showInitialLoading");
    expect(foreignerSource).not.toContain("showInitialLoading");
    expect(chatSource).not.toContain("if (loading && chats.length === 0 && !loadError)");
    expect(plansSource).not.toContain("if (loading && plans.length === 0 && !error)");
    expect(chatSource).toContain("RefreshLoadingIndicator");
    expect(spinnerSource).toContain("Animated.timing(opacity");
    expect(spinnerSource).toContain("useNativeDriver: true");
    expect(spinnerSource).toContain("export const LOADING_SPINNER_SPEED_MS = 500");
    expect(spinnerSource).toContain("Easing.inOut(Easing.cubic)");
    expect(spinnerSource).toContain("Animated.delay");
    expect(spinnerSource).toContain("resetBeforeIteration: true");
    expect(spinnerSource).toContain("trackColorProp ?? colors.border.subtle");
    expect(spinnerSource).toContain("borderWidth: Math.max(1, Math.round(size / 14))");
    expect(spinnerSource).toContain("borderColor: trackColor");
    expect(spinnerSource).toContain("borderTopColor: color");
    expect(spinnerSource).not.toContain("borderRightColor: color");
  });

  it("テーマ設定は端末連動を初期値にして固定テーマを選べる", async () => {
    const screenSource = await readScreen("../app/theme-settings.tsx");
    const serviceSource = await readScreen("../services/theme.ts");

    expect(screenSource).toContain('system: "端末の設定"');
    expect(screenSource).toContain('light: "ライト"');
    expect(screenSource).toContain('dark: "ダーク"');
    expect(screenSource).toContain("setPreference");
    expect(serviceSource).toContain('return value === "light" || value === "dark" || value === "system" ? value : "system"');
  });

  it("外国人ホームは構造化プロフィールJSONをそのまま描画しない", async () => {
    const source = await readScreen("../app/foreigner/index.tsx");
    const profileFormatSource = await readScreen("../services/profile-format.ts");

    expect(profileFormatSource).toContain("export function formatApplicationBio");
    expect(profileFormatSource).toContain("JSON.parse(trimmed)");
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
