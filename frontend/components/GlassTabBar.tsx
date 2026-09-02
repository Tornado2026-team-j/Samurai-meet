import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { usePathname, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  loadLanguage,
  subscribeLanguage,
  type AppLanguage,
  type AppMode,
} from "../services/onboarding";

const BLUE = "#5EC5F5";
const TEXT = "#535353";
const MUTED = "#8A8A8A";
const GLASS = "rgba(255, 255, 255, 0.72)";
const HIGHLIGHT = "rgba(94, 197, 245, 0.16)";

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

const TAB_ITEMS: Array<{
  key: TabKey;
  icon: IoniconName;
  activeIcon: IoniconName;
}> = [
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
    profile: "プロフィール",
  },
  en: {
    home: "Home",
    chat: "Chat",
    plans: "Plans",
    monsters: "Collection",
    profile: "Profile",
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
  const pendingHref = useRef<string | null>(null);
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const bottom = Math.max(insets.bottom + 8, 18);
  const defaultHomeHref: Href = appMode === "traveler" ? "/foreigner" : "/japanese";
  const defaultPlansHref: Href = "/plans";
  const fallbackLanguage: AppLanguage = appMode === "traveler" ? "en" : "ja";
  const labels = TAB_LABELS[language ?? fallbackLanguage];

  useEffect(() => {
    pendingHref.current = null;
  }, [pathname]);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active && nextLanguage) setLanguage(nextLanguage);
    });
    void loadLanguage()
      .then((storedLanguage) => {
        if (active) setLanguage(storedLanguage ?? fallbackLanguage);
      })
      .catch(() => {
        if (active) setLanguage(fallbackLanguage);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [fallbackLanguage]);

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
    router.replace(href);
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { bottom }]}>
      <BlurView intensity={Platform.OS === "ios" ? 42 : 22} tint="light" style={styles.bar}>
        <View style={styles.tint} />
        {TAB_ITEMS.map((item) => {
          const selected = item.key === activeTab;
          const label = labels[item.key];
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
              <View style={[styles.iconBubble, selected && styles.iconBubbleSelected]}>
                <Ionicons
                  color={selected ? BLUE : MUTED}
                  name={selected ? item.activeIcon : item.icon}
                  size={22}
                />
              </View>
              <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>
                {label}
              </Text>
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
    right: 18,
    left: 18,
    zIndex: 20,
  },
  bar: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.78)",
    borderRadius: 34,
    backgroundColor: GLASS,
    boxShadow: "0 8px 22px rgba(31, 45, 61, 0.12)",
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: GLASS,
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
  iconBubbleSelected: {
    backgroundColor: HIGHLIGHT,
  },
  label: {
    color: TEXT,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 12,
  },
  labelSelected: {
    color: BLUE,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.72,
  },
});
