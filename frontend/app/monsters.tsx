import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LoadingSpinner } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import {
  loadLanguage,
  loadLocalProfile,
  subscribeLanguage,
  type AppLanguage,
  type LocalProfile,
} from "../services/onboarding";
import { getTabBarContentBottomPadding } from "../utils/layout";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#8A8A8A";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

const COPY = {
  ja: {
    title: "コレクション",
    loading: "読み込み中…",
    emptyTitle: "プロフィール情報がまだありません",
    emptyBody: "プロフィール設定で得意なこと・好きなことを登録すると、ここに表示されます。",
    skills: "得意なこと",
    interests: "好きなこと",
    note: "メモ",
    notSet: "未設定",
  },
  en: {
    title: "Collection",
    loading: "Loading…",
    emptyTitle: "No profile details yet",
    emptyBody: "Add your skills and interests from Profile to see them here.",
    skills: "Skills",
    interests: "Interests",
    note: "Note",
    notSet: "Not set",
  },
} as const;

const TAG_LABELS: Record<AppLanguage, Record<string, string>> = {
  ja: {
    english_conversation: "英語で話す",
    photography: "写真を撮る",
    directions: "道案内",
    food_guiding: "グルメ案内",
    history: "歴史を説明する",
    cafe_hunting: "カフェ探し",
    hidden_spots: "穴場紹介",
    shopping: "買い物に付き合う",
    conversation: "人と話す",
    planning: "スケジュールを考える",
    other: "その他",
    food: "グルメ",
    cafes: "カフェ",
    shrines_temples: "神社・寺",
    anime: "アニメ",
    games: "ゲーム",
    fashion: "ファッション",
    music: "音楽",
    nature: "自然",
    night_views: "夜景",
    walking: "散歩",
    traditional_culture: "伝統文化",
    photos: "写真",
  },
  en: {
    english_conversation: "Speaking English",
    photography: "Taking photos",
    directions: "Giving directions",
    food_guiding: "Food guiding",
    history: "Explaining history",
    cafe_hunting: "Finding cafes",
    hidden_spots: "Hidden spots",
    shopping: "Shopping together",
    conversation: "Conversation",
    planning: "Planning routes",
    other: "Other",
    food: "Food",
    cafes: "Cafes",
    shrines_temples: "Shrines and temples",
    anime: "Anime",
    games: "Games",
    fashion: "Fashion",
    music: "Music",
    nature: "Nature",
    night_views: "Night views",
    walking: "Walking",
    traditional_culture: "Traditional culture",
    photos: "Photography",
  },
};

function formatTags(tags: string[], language: AppLanguage): string {
  return tags.map((tag) => TAG_LABELS[language][tag] ?? tag).join(" / ");
}

export default function MonstersScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedUserID = useRef<string | null>(null);
  const copy = COPY[language];

  useEffect(() => {
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (nextLanguage) setLanguage(nextLanguage);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    const userID = session?.user_id;
    loadedUserID.current = userID ?? null;

    void Promise.all([
      loadLanguage(),
      userID ? loadLocalProfile(userID) : Promise.resolve(null),
    ]).then(([storedLanguage, storedProfile]) => {
      if (!active || loadedUserID.current !== (userID ?? null)) return;
      const nextLanguage = storedLanguage ?? "ja";
      setLanguage(nextLanguage);
      setProfile(storedProfile);
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [session?.user_id]);

  const skillText = profile ? formatTags(profile.monsterSeed.skillTags, language) : "";
  const interestText = profile ? formatTags(profile.monsterSeed.interestTags, language) : "";
  const noteText = profile?.monsterSeed.freeText.trim() ?? "";
  const hasDetails = Boolean(skillText || interestText || noteText);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <MaterialIcons color="#ffffff" name="auto-awesome" size={42} />
        <Text accessibilityRole="header" style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: getTabBarContentBottomPadding(insets.bottom) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.statePanel}>
            <LoadingSpinner color={BLUE} size={24} speedMs={680} />
            <Text style={styles.stateText}>{copy.loading}</Text>
          </View>
        ) : hasDetails ? (
          <View style={styles.panel}>
            <View style={styles.avatar}>
              <MaterialIcons color={BLUE} name="auto-awesome" size={44} />
            </View>
            <InfoBlock label={copy.skills} value={skillText || copy.notSet} />
            <InfoBlock label={copy.interests} value={interestText || copy.notSet} />
            <InfoBlock label={copy.note} value={noteText || copy.notSet} />
          </View>
        ) : (
          <View style={styles.statePanel}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons color={BLUE} name="auto-awesome" size={34} />
            </View>
            <Text style={styles.emptyTitle}>{copy.emptyTitle}</Text>
            <Text style={styles.stateText}>{copy.emptyBody}</Text>
          </View>
        )}
      </ScrollView>

    </View>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    minHeight: 178,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 26,
    borderBottomLeftRadius: 42,
    borderBottomRightRadius: 42,
    backgroundColor: BLUE,
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0,
  },
  content: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 28,
    gap: 16,
  },
  panel: {
    width: "100%",
    maxWidth: 390,
    alignItems: "center",
    gap: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 24,
    backgroundColor: "#ffffff",
  },
  avatar: {
    width: 92,
    height: 92,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 46,
    backgroundColor: SOFT_BLUE,
  },
  infoBlock: {
    width: "100%",
    gap: 6,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#f8fbfd",
  },
  infoLabel: {
    color: MUTED_GRAY,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
  },
  infoValue: {
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 22,
  },
  statePanel: {
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 20,
  },
  emptyIconCircle: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#caeafd",
    borderRadius: 38,
    backgroundColor: SOFT_BLUE,
  },
  emptyTitle: {
    color: TEXT_GRAY,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0,
    textAlign: "center",
  },
  stateText: {
    maxWidth: 290,
    color: MUTED_GRAY,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 22,
    textAlign: "center",
  },
});
