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
    thankYou: "評価ありがとうございました！",
    continue: "次へ",
    report: "運営に報告する",
  },
  en: {
    header: "Feedback",
    title: "How was today's guide?",
    hint: "If you enjoyed today's guide, tap Like!",
    thankYou: "Thank you for your feedback!",
    continue: "Continue",
    report: "Report to support",
  },
} as const;

export default function ReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const matchId = Array.isArray(id) ? id[0] : id;

  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [liked, setLiked] = useState(false);

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

  const goReport = () => {
    if (!matchId) return;

    router.push({
      pathname: "/match-result/[id]/report",
      params: { id: matchId },
    });
  };

  const handleContinue = () => {
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

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!liked ? (
          <>
            <Text style={styles.title}>{copy.title}</Text>

            <Pressable
              accessibilityRole="button"
              onPress={() => setLiked(true)}
              style={({ pressed }) => [
                styles.likeArea,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.likeCircle}>
                <MaterialIcons
                  name="thumb-up"
                  size={76}
                  color={YELLOW}
                />
              </View>
            </Pressable>

            <Text style={styles.hint}>{copy.hint}</Text>
          </>
        ) : (
          <View style={styles.thankYouSection}>
            <View style={styles.checkCircle}>
              <MaterialIcons
                name="check"
                size={50}
                color={GREEN}
              />
            </View>

            <Text style={styles.thankYouText}>
              {copy.thankYou}
            </Text>
          </View>
        )}

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

  thankYouSection: {
    alignItems: "center",
    marginTop: 20,
    marginBottom: 30,
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
    marginTop: 26,
    color: "#000000",
    fontSize: 23,
    fontWeight: "900",
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
    backgroundColor: YELLOW,
  },

  continueText: {
    color: "#000000",
    fontSize: 20,
    fontWeight: "900",
  },

  reportButton: {
    marginTop: 24,
    padding: 10,
  },

  reportText: {
    color: "#777777",
    fontSize: 14,
    fontWeight: "700",
    textDecorationLine: "underline",
  },

  pressed: {
    opacity: 0.72,
  },
});
