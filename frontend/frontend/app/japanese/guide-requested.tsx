import { useCallback, useEffect, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../../hooks/useAuth";
import { APIError } from "../../services/api-client";
import { getMatch, type MatchView } from "../../services/matching";
import { loadLanguage, subscribeLanguage } from "../../services/onboarding";
import type { AppLanguage } from "../../services/onboarding-contract";

const HEADER_BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#949494";

const COPY = {
  en: {
    waitingTitle: "Waiting for the traveler to review your application",
    matchedTitle: "It's a match!",
    withdrawnTitle: "Application withdrawn",
    unavailableTitle: "This application was not matched",
    loginRequired: "Sign in to check the application status.",
    loadFailed: "The application status could not be loaded. Please try again later.",
    matched: "The traveler chose you as their guide.",
    pending: "Your application was sent. Please wait for the traveler's response.",
    checking: "Checking application status...",
    refresh: "Refresh status",
    refreshing: "Refreshing...",
    home: "Back to home",
    guideResult: "View guide result",
  },
  ja: {
    waitingTitle: "旅行者が応募を確認するまでお待ちください",
    matchedTitle: "マッチングしました！",
    withdrawnTitle: "応募を取り下げました",
    unavailableTitle: "今回はマッチングできませんでした",
    loginRequired: "ログイン後にマッチング状態を確認できます。",
    loadFailed: "マッチング状態を取得できませんでした。時間をおいて再試行してください。",
    matched: "旅行者があなたを案内役として選びました。",
    pending: "応募は送信済みです。旅行者の確認をお待ちください。",
    checking: "マッチング状態を確認中です。",
    refresh: "状態を更新",
    refreshing: "更新中…",
    home: "ホームに戻る",
    guideResult: "案内結果を見る",
  },
} as const;

export default function JapaneseGuideRequestedScreen() {
  const router = useRouter();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const { matchId } = useLocalSearchParams<{ matchId?: string | string[] }>();
  const currentMatchID = Array.isArray(matchId) ? matchId[0] : matchId;
  const [match, setMatch] = useState<MatchView | null>(null);
  const [matchLoadState, setMatchLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [language, setLanguage] = useState<AppLanguage>("en");
  const copy = COPY[language];

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage ?? "en");
    });
    void loadLanguage().then((storedLanguage) => {
      if (active && storedLanguage) setLanguage(storedLanguage);
    }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);

  const loadMatch = useCallback(async () => {
    if (!currentMatchID) return;
    const activeSession = getCurrentSession() ?? session;
    if (status !== "signed_in" || !activeSession) {
      setMatchLoadState("error");
      return;
    }
    setMatchLoadState("loading");
    try {
      let result: MatchView;
      try {
        result = await getMatch(currentMatchID, activeSession);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        result = await getMatch(currentMatchID, refreshedSession);
      }
      setMatch(result);
      setMatchLoadState("ready");
    } catch {
      setMatchLoadState("error");
    }
  }, [currentMatchID, getCurrentSession, refresh, session, status]);

  useEffect(() => {
    if (!currentMatchID) return;
    void loadMatch();
  }, [currentMatchID, loadMatch]);

  const matched = match?.status === "accepted" || match?.status === "completed";

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {matched ? copy.matchedTitle : copy.waitingTitle}
        </Text>
      </View>
      <View style={styles.main}>
        <View style={styles.mainContent}>
          <Text style={styles.statusText}>
            {match ? (matched ? copy.matched : copy.pending) : copy.checking}
          </Text>
          {matched && currentMatchID ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({
                pathname: "/match-result/[id]",
                params: { id: currentMatchID },
              })}
              style={({ pressed }) => [styles.guideResultButton, pressed && styles.pressed]}
            >
              <Text style={styles.guideResultButtonText}>{copy.guideResult}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/japanese")}
            style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]}
          >
            <MaterialIcons color="#ffffff" name="home" size={21} />
            <Text style={styles.homeButtonText}>{copy.home}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", backgroundColor: "#ffffff" },
  header: {
    height: 238,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 38,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: HEADER_BLUE,
  },
  headerTitle: { color: "#ffffff", fontSize: 20, fontWeight: "900", lineHeight: 30, textAlign: "center" },
  main: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 38, paddingBottom: 72 },
  mainContent: { alignItems: "center", gap: 20 },
  statusText: { color: TEXT_GRAY, fontSize: 14, fontWeight: "700", textAlign: "center" },
  guideResultButton: {
    width: 258,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  guideResultButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "900" },
  homeButton: {
    width: 258,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  homeButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "900" },
  pressed: { opacity: 0.72 },
});
