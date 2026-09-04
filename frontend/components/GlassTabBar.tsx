import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { usePathname, useRouter, type Href } from "expo-router";
import { useEffect, useRef, type ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDisplayLanguage } from "../hooks/useDisplayLanguage";
import { useTheme } from "../hooks/useTheme";
import type { AppLanguage, AppMode } from "../services/onboarding";

const BLUE = "#5EC5F5";

type TabKey = "home" | "chat" | "plans" | "monsters" | "profile";
type IoniconName = ComponentProps<typeof Ionicons>["name"];

type GlassTabBarProps = {
  activeTab: TabKey;
  appMode?: AppMode;
  homeHref?: Href;
  plansHref?: Href;
};

function hrefKey(href: Href): string {
  if (typeof href === "string") return href;
  return JSON.stringify(href) ?? "";
}

const TAB_ITEMS: {
  key: TabKey;
  icon: IoniconName;
  activeIcon: IoniconName;
}[] = [
  { key: "home", icon: "home-outline", activeIcon: "home" },
  { key: "chat", icon: "chatbubbles-outline", activeIcon: "chatbubbles" },
  { key: "plans", icon: "calendar-outline", activeIcon: "calendar" },
  { key: "monsters", icon: "sparkles-outline", activeIcon: "sparkles" },
  { key: "profile", icon: "person-circle-outline", activeIcon: "person-circle" },
];

const TAB_LABELS: Record<AppLanguage, Record<TabKey, string>> = {
  ja: {
    home: "ホーム",
    chat: "チャット",
    plans: "予定",
    monsters: "コレクション",
    profile: "アカウント",
  },
  en: {
    home: "Home",
    chat: "Chat",
    plans: "Plans",
    monsters: "Collection",
    profile: "Account",
  },
};

export default function GlassTabBar({
  activeTab,
  appMode = "local",
  homeHref,
  plansHref,
}: GlassTabBarProps) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { scheme } = useTheme();
  const isDark = scheme === "dark";
  const pendingHref = useRef<string | null>(null);
  const language = useDisplayLanguage();
  const bottom = Math.max(insets.bottom + 3, 10);
  const defaultHomeHref: Href = appMode === "traveler" ? "/foreigner" : "/japanese";
  const defaultPlansHref: Href = "/plans";
  const labels = language ? TAB_LABELS[language] : null;
  const visual = isDark
    ? {
      bar: "rgba(24, 29, 34, 0.88)",
      highlight: "rgba(94, 197, 245, 0.2)",
      muted: "rgba(255, 255, 255, 0.68)",
      text: "rgba(255, 255, 255, 0.9)",
      fade: ["rgba(0, 0, 0, 0.02)", "rgba(0, 0, 0, 0.2)"] as const,
      bottomFade: ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.18)", "rgba(0, 0, 0, 0.52)"] as const,
      shadow: "0 8px 22px rgba(0, 0, 0, 0.28)",
    }
    : {
      bar: "rgba(255, 255, 255, 0.84)",
      highlight: "rgba(94, 197, 245, 0.16)",
      muted: "#8A8A8A",
      text: "#535353",
      fade: ["rgba(255, 255, 255, 0.02)", "rgba(255, 255, 255, 0.18)"] as const,
      bottomFade: ["rgba(255, 255, 255, 0)", "rgba(255, 255, 255, 0.48)", "rgba(255, 255, 255, 0.92)"] as const,
      shadow: "0 8px 22px rgba(31, 45, 61, 0.14)",
    };

  useEffect(() => {
    pendingHref.current = null;
  }, [pathname]);

  const hrefFor = (key: TabKey): Href => {
    switch (key) {
      case "home":
        return homeHref ?? defaultHomeHref;
      case "chat":
        return "/chat";
      case "plans":
        return plansHref ?? defaultPlansHref;
      case "monsters":
        return "/monsters";
      case "profile":
        return "/profile";
    }
  };

  const navigateToTab = (key: TabKey) => {
    const href = hrefFor(key);
    const targetKey = hrefKey(href);
    const targetPath = typeof href === "string" ? href.split(/[?#]/u, 1)[0] : null;
    if (targetPath === pathname || pendingHref.current === targetKey) return;

    pendingHref.current = targetKey;
    // Keep the previous tab in the stack so iOS's edge-swipe can return to it.
    router.navigate(href);
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { bottom }]}>
      <LinearGradient
        colors={visual.bottomFade}
        locations={[0, 0.52, 1]}
        pointerEvents="none"
        style={[styles.bottomFade, { bottom: -bottom }]}
      />
      <BlurView
        intensity={Platform.OS === "ios" ? 56 : 38}
        tint={isDark ? "dark" : "light"}
        style={[styles.bar, { backgroundColor: visual.bar, boxShadow: visual.shadow }]}
      >
        <LinearGradient
          colors={visual.fade}
          pointerEvents="none"
          style={styles.contentFade}
        />
        {TAB_ITEMS.map((item) => {
          const selected = item.key === activeTab;
          const label = labels?.[item.key];
          return (
            <Pressable
              key={item.key}
              accessibilityLabel={label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => navigateToTab(item.key)}
              style={({ pressed }) => [
                styles.tab,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.iconBubble, selected && { backgroundColor: visual.highlight }]}>
                <Ionicons
                  color={selected ? BLUE : visual.muted}
                  name={selected ? item.activeIcon : item.icon}
                  size={22}
                />
              </View>
              {label ? (
                <Text numberOfLines={1} style={[styles.label, { color: visual.text }, selected && styles.labelSelected]}>
                  {label}
                </Text>
              ) : <View style={styles.labelPlaceholder} />}
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    right: 14,
    left: 14,
    zIndex: 20,
  },
  bar: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 0,
    borderRadius: 34,
    elevation: 12,
  },
  contentFade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 34,
  },
  bottomFade: {
    position: "absolute",
    top: 48,
    right: -14,
    left: -14,
  },
  tab: {
    minWidth: 56,
    minHeight: 54,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  iconBubble: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 12,
  },
  labelSelected: {
    color: BLUE,
    fontWeight: "700",
  },
  labelPlaceholder: {
    height: 12,
  },
  pressed: {
    opacity: 0.72,
  },
});
