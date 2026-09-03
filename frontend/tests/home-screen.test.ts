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
    expect(source).toContain('loadRecruitments("refresh")');
    expect(source).toContain("<RefreshControl");
  });

  it("日本語ホームはカード検索を優先し、位置保存と応募履歴を待たない", async () => {
    const source = await readScreen("../app/japanese/index.tsx");

    expect(source).toContain("SEARCH_LOCATION_CACHE_TTL_MS");
    expect(source).toContain("void updateCurrentLocation");
    expect(source).not.toContain("await updateCurrentLocation");
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
