import { useEffect, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loadLanguage, subscribeLanguage } from "../../../services/onboarding";
import type { AppLanguage } from "../../../services/onboarding-contract";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

const COPY = {
  ja: {
    title: "今日の案内はどうでしたか？",
    back: "戻る",
    like: "いいね！",
    liked: "いいねを送りました！",
    thankYou: "評価ありがとうございました",
    likeHint: "相手に「いいね」を送ることができます（1回のみ）",
    report: "運営に報告する",
    finish: "完了",
  },
  en: {
    title: "How was today's guide?",
    back: "Back",
    like: "Like!",
    liked: "Sent a like!",
    thankYou: "Thank you for your feedback!",
    likeHint: "You can send a like to the other person (once only)",
    report: "Report to support",
    finish: "Done",
  },
} as const;

export default function ReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const matchId = Array.isArray(id) ? id[0] : id;
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [liked, setLiked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage ?? "ja");
    });
    void loadLanguage().then((storedLanguage) => {
      if (active) setLanguage(storedLanguage ?? "ja");
    }).catch(() => {
      if (active) setLanguage("ja");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!language) {
    return <View style={styles.loadingScreen}><StatusBar style="dark" /></View>;
  }

  const copy = COPY[language];

  const handleLike = async () => {
    if (liked || submitting) return;
    setSubmitting(true);
    // TODO: Connect to POST /matches/{id}/reviews when backend API is ready
    // For MVP, just update local state
    setLiked(true);
    setSubmitting(false);
  };

  const goReport = () => {
    if (matchId) {
      router.push({
        pathname: "/match-result/[id]/report",
        params: { id: matchId },
      });
    }
  };

  const goHome = () => {
    router.replace("/japanese");
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 18) }]}>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="arrow-back-ios-new" size={20} />
        </Pressable>
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.reviewCard}>
          <Text style={styles.reviewHint}>{copy.likeHint}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: liked || submitting }}
            disabled={liked || submitting}
            onPress={() => void handleLike()}
            style={({ pressed }) => [
              styles.likeButton,
              liked && styles.likeButtonDone,
              (liked || submitting) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons
              color={liked ? "#ffffff" : YELLOW}
              name={liked ? "thumb-up" : "thumb-up-off-alt"}
              size={48}
            />
            <Text style={[styles.likeText, liked && styles.likeTextDone]}>
              {liked ? copy.liked : copy.like}
            </Text>
          </Pressable>

          {liked ? (
            <View style={styles.thankYouBanner}>
              <MaterialIcons color="#3d9a68" name="check-circle" size={22} />
              <Text style={styles.thankYouText}>{copy.thankYou}</Text>
            </View>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={goReport}
          style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#b42318" name="report-problem" size={20} />
          <Text style={styles.reportButtonText}>{copy.report}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={goHome}
          style={({ pressed }) => [styles.finishButton, pressed && styles.pressed]}
        >
          <Text style={styles.finishButtonText}>{copy.finish}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  header: {
    minHeight: 108,
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 18,
    backgroundColor: BLUE,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  backButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", marginRight: 12 },
  headerTitle: { color: "#ffffff", fontSize: 22, fontWeight: "800" },
  content: { alignItems: "center", paddingHorizontal: 18, paddingTop: 22, gap: 14 },
  reviewCard: {
    width: "100%",
    maxWidth: 390,
    alignItems: "center",
    gap: 20,
    padding: 28,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 18,
    backgroundColor: "#ffffff",
  },
  reviewHint: { color: MUTED_GRAY, fontSize: 13, lineHeight: 19, textAlign: "center" },
  likeButton: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 2,
    borderColor: YELLOW,
    borderRadius: 80,
    backgroundColor: "#fff9ec",
  },
  likeButtonDone: { borderColor: "#3d9a68", backgroundColor: "#eef8f2" },
  likeText: { color: YELLOW, fontSize: 18, fontWeight: "900" },
  likeTextDone: { color: "#3d9a68" },
  thankYouBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#cfe9d8",
    borderRadius: 10,
    backgroundColor: "#eef8f2",
  },
  thankYouText: { color: "#3d9a68", fontSize: 14, fontWeight: "800" },
  reportButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#f0c8c4",
    borderRadius: 22,
    backgroundColor: "#fff5f4",
  },
  reportButtonText: { color: "#b42318", fontSize: 14, fontWeight: "800" },
  finishButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  finishButtonText: { color: BLUE, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.72 },
});
