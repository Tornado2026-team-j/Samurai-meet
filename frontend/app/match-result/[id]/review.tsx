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
const GREEN = "#3d9a68";
const LIGHT_GREEN = "#C6EDC9";
const MUTED_GRAY = "#8e8e93";

const COPY = {
  ja: {
    header: "Feedback",
    title: "今日の案内はどうでしたか？",
    hint: "楽しかったら、いいねを送ってみましょう！",
    thankYou: "ありがとうございました！",
    thankYouLiked: "評価ありがとうございました！",
    continue: "次へ",
    report: "運営に報告する",
    backHome: "ホームに戻る",
  },
  en: {
    header: "Feedback",
    title: "How was today's guide?",
    hint: "If you enjoyed today's guide, tap Like!",
    thankYou: "Thank you!",
    thankYouLiked: "Thank you for your feedback!",
    continue: "Continue",
    report: "Report to support",
    backHome: "Back to Home",
  },
} as const;

export default function ReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const matchId = Array.isArray(id) ? id[0] : id;

  const [language, setLanguage] = useState<AppLanguage | null>(null);

  // いいねしたか
  const [liked, setLiked] = useState(false);

  // false = ④評価画面
  // true  = ⑤評価後画面
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let active = true;

    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage ?? "ja");
    });

    void loadLanguage()
      .then((storedLanguage) => {
        if (active) setLanguage(storedLanguage ?? "ja");
      })
      .catch(() => {
        if (active) setLanguage("ja");
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!language) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
      </View>
    );
  }

  const copy = COPY[language];

  // ④ → ⑤
  // いいねの有無に関係なく進める
  const handleContinue = () => {
    setFinished(true);
  };

  // ④または⑤ → ⑥
  const goReport = () => {
    if (!matchId) return;

    router.push({
      pathname: "/match-result/[id]/report",
      params: { id: matchId },
    });
  };

  // ⑤ → Home
  const goHome = () => {
    router.replace("/japanese");
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top, 24) },
        ]}
      >
        <Text style={styles.headerTitle}>{copy.header}</Text>
      </View>

      {!finished ? (
        /* ④ 相互評価画面 */
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>{copy.title}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: liked }}
            onPress={() => setLiked(true)}
            style={({ pressed }) => [
              styles.likeArea,
              pressed && styles.pressed,
            ]}
          >
            <View
              style={[
                styles.likeCircle,
                liked && styles.likeCircleLiked,
              ]}
            >
              <MaterialIcons
                name="thumb-up"
                size={76}
                color={YELLOW}
              />
            </View>
          </Pressable>

          <Text style={styles.hint}>{copy.hint}</Text>

          {/* Likeしていてもしていなくても押せる */}
          <Pressable
            accessibilityRole="button"
            onPress={handleContinue}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.continueText}>
              {copy.continue}
            </Text>
          </Pressable>

          {/* ④ → ⑥ */}
          <Pressable
            accessibilityRole="button"
            onPress={goReport}
            style={({ pressed }) => [
              styles.reportButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.reportText}>
              {copy.report}
            </Text>
          </Pressable>
        </ScrollView>
      ) : (
        /* ⑤ 評価後画面 */
        <View
          style={[
            styles.finishedContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
        >
          <View style={styles.checkCircle}>
            <MaterialIcons
              name="check"
              size={50}
              color={GREEN}
            />
          </View>

          <Text style={styles.thankYouText}>
            {liked ? copy.thankYouLiked : copy.thankYou}
          </Text>

          <Text style={styles.thankYouSubText}>
            {language === "ja"
              ? "ご利用ありがとうございました。"
              : "We appreciate your time."}
          </Text>

          {/* ⑤ → Home */}
          <Pressable
            accessibilityRole="button"
            onPress={goHome}
            style={({ pressed }) => [
              styles.homeButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.homeButtonText}>
              {copy.backHome}
            </Text>
          </Pressable>

          {/* ⑤ → ⑥ */}
          <Pressable
            accessibilityRole="button"
            onPress={goReport}
            style={({ pressed }) => [
              styles.reportButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.reportText}>
              {copy.report}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },

  loadingScreen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },

  header: {
    minHeight: 156,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 24,
    backgroundColor: BLUE,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
  },

  headerTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
  },

  content: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 38,
    paddingTop: 42,
  },

  title: {
    color: "#000000",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },

  likeArea: {
    marginTop: 42,
  },

  likeCircle: {
    width: 150,
    height: 150,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 75,
    backgroundColor: "#fff9ec",
  },

  likeCircleLiked: {
    backgroundColor: "#fff3c9",
  },

  hint: {
    marginTop: 24,
    maxWidth: 300,
    color: MUTED_GRAY,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 23,
    textAlign: "center",
  },

  continueButton: {
    width: "100%",
    maxWidth: 315,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 55,
    borderRadius: 16,
    backgroundColor: "#dcecf8",
    borderWidth: 1,
    borderColor: BLUE,
  },

  continueText: {
    color: "#000000",
    fontSize: 18,
    fontWeight: "900",
  },

  finishedContent: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 38,
    paddingTop: 80,
  },

  checkCircle: {
    width: 100,
    height: 100,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 50,
    backgroundColor: LIGHT_GREEN,
  },

  thankYouText: {
    marginTop: 30,
    maxWidth: 300,
    color: "#000000",
    fontSize: 23,
    fontWeight: "900",
    textAlign: "center",
  },

  thankYouSubText: {
    marginTop: 12,
    color: MUTED_GRAY,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },

  homeButton: {
    width: "100%",
    maxWidth: 315,
    minHeight: 58,
    marginTop: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: YELLOW,
  },

  homeButtonText: {
    color: "#000000",
    fontSize: 18,
    fontWeight: "900",
  },

  reportButton: {
    marginTop: 26,
    padding: 10,
  },

  reportText: {
    color: "#00aeff",
    fontSize: 14,
    fontWeight: "800",
  },

  pressed: {
    opacity: 0.72,
  },
});
      
