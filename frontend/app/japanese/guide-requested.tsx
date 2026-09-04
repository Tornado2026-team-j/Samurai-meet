import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ThemeColors } from "../../components/ui/tokens";
import { useTheme, useThemeStyles } from "../../hooks/useTheme";
import { useAuth } from "../../hooks/useAuth";
import { APIError } from "../../services/api-client";
import { getMatch, type MatchView } from "../../services/matching";
import { loadLanguage, subscribeLanguage } from "../../services/onboarding";
import type { AppLanguage } from "../../services/onboarding-contract";

type MatchLoadErrorKey = "loginRequired" | "failed";

const COPY = {
  en: {
    waitingTitle: "Waiting for the traveler to review your application",
    matchedTitle: "It's a match!",
    withdrawnTitle: "Application withdrawn",
    unavailableTitle: "This application was not matched",
    letterLabel: "Application review in progress",
    loginRequired: "Sign in to check the application status.",
    loadFailed: "The application status could not be loaded. Please try again later.",
    matched: "The traveler chose you as their guide.",
    withdrawn: "This application was withdrawn.",
    unavailable: "This application has ended or is unavailable.",
    pending: "Your application was sent. Please wait for the traveler's response.",
    checking: "Checking application status...",
    refresh: "Refresh status",
    refreshing: "Refreshing...",
    openChat: "Open chat",
    home: "Back to home",
  },
  ja: {
    waitingTitle: "旅行者が応募を確認するまでお待ちください",
    matchedTitle: "マッチングしました！",
    withdrawnTitle: "応募を取り下げました",
    unavailableTitle: "今回はマッチングできませんでした",
    letterLabel: "応募確認待ちの手紙",
    loginRequired: "ログイン後にマッチング状態を確認できます。",
    loadFailed: "マッチング状態を取得できませんでした。時間をおいて再試行してください。",
    matched: "旅行者があなたを案内役として選びました。",
    withdrawn: "応募を取り下げました。",
    unavailable: "この応募は終了または利用できません。",
    pending: "応募は送信済みです。旅行者の確認をお待ちください。",
    checking: "マッチング状態を確認中です。",
    refresh: "状態を更新",
    refreshing: "更新中…",
    openChat: "チャットを開く",
    home: "ホームに戻る",
  },
} as const;

export default function JapaneseGuideRequestedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const { getCurrentSession, refresh, session, status } = useAuth();
  const { matchId } = useLocalSearchParams<{
    matchId?: string | string[];
  }>();
  const currentMatchID = (Array.isArray(matchId) ? matchId[0] : matchId)?.trim();
  const [match, setMatch] = useState<MatchView | null>(null);
  const [matchLoadState, setMatchLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [matchLoadError, setMatchLoadError] = useState<MatchLoadErrorKey | null>(null);
  const [language, setLanguage] = useState<AppLanguage>("en");
  const copy = COPY[language];
  const authRef = useRef({ getCurrentSession, refresh, session, status });
  authRef.current = { getCurrentSession, refresh, session, status };

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage ?? "en");
    });
    void loadLanguage().then((storedLanguage) => {
      if (active && storedLanguage) setLanguage(storedLanguage);
    }).catch(() => {
      // Keep the English fallback when local language storage is unavailable.
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const loadMatch = useCallback(async (signal?: AbortSignal) => {
    if (!currentMatchID) {
      setMatchLoadState("error");
      setMatchLoadError("failed");
      return;
    }

    const auth = authRef.current;
    const activeSession = auth.getCurrentSession() ?? auth.session;
    if (auth.status !== "signed_in" || !activeSession) {
      setMatchLoadState("error");
      setMatchLoadError("loginRequired");
      return;
    }

    setMatchLoadState("loading");
    setMatchLoadError(null);
    try {
      const loadWithSession = (currentSession: typeof activeSession) =>
        getMatch(currentMatchID, currentSession, signal);
      let result: MatchView;
      try {
        result = await loadWithSession(activeSession);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await auth.refresh();
        const refreshedSession = auth.getCurrentSession();
        if (!refreshedSession) throw error;
        result = await loadWithSession(refreshedSession);
      }
      setMatch(result);
      setMatchLoadState("ready");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError" && signal?.aborted) return;
      setMatchLoadState("error");
      setMatchLoadError("failed");
    }
  }, [currentMatchID]);

  useEffect(() => {
    const controller = new AbortController();
    void loadMatch(controller.signal);
    return () => controller.abort();
  }, [loadMatch, status]);

  const matched = match?.status === "accepted" || match?.status === "completed";
  const unavailable = match?.status === "rejected"
    || match?.status === "cancelled"
    || match?.status === "expired"
    || match?.status === "blocked";
  const statusMessage = matchLoadError
    ? (matchLoadError === "loginRequired" ? copy.loginRequired : copy.loadFailed)
    : matched
      ? copy.matched
      : match?.status === "cancelled"
        ? copy.withdrawn
        : unavailable
          ? copy.unavailable
          : match
            ? copy.pending
            : copy.checking;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.canvas}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {matched
                ? copy.matchedTitle
                : match?.status === "cancelled"
                  ? copy.withdrawnTitle
                  : unavailable
                    ? copy.unavailableTitle
                    : copy.waitingTitle}
            </Text>
          </View>

          <View style={styles.main}>
            <View style={styles.mainContent}>
            <View style={styles.illustrationStage}>
              <View style={styles.illustrationCircle} />
              <Image
                accessibilityLabel={copy.letterLabel}
                resizeMode="contain"
                source={require("../../assets/images/letter.png")}
                style={styles.letterImage}
              />
            </View>

            {currentMatchID ? (
              <View style={styles.matchStatusBlock}>
                <Text accessibilityRole={matchLoadError ? "alert" : undefined} style={styles.matchStatusText}>
                  {statusMessage}
                </Text>
                {matched ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({
                      pathname: "/chat",
                      params: { matchId: currentMatchID },
                    })}
                    style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}
                  >
                    <MaterialIcons color={colors.text.inverse} name="chat-bubble-outline" size={21} />
                    <Text style={styles.chatButtonText}>{copy.openChat}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityLabel={matchLoadState === "loading" ? copy.refreshing : copy.refresh}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: matchLoadState === "loading" }}
                  disabled={matchLoadState === "loading"}
                  onPress={() => void loadMatch()}
                  style={({ pressed }) => [
                    styles.refreshButton,
                    matchLoadState === "loading" && styles.disabledButton,
                    pressed && styles.pressed,
                  ]}
                >
                  {matchLoadState === "loading" ? (
                    <View style={styles.refreshButtonContent}>
                      <ActivityIndicator color={colors.text.inverse} size="small" />
                      <Text style={styles.refreshButtonText}>{copy.refreshing}</Text>
                    </View>
                  ) : (
                    <Text style={styles.refreshButtonText}>{copy.refresh}</Text>
                  )}
                </Pressable>
              </View>
            ) : null}

              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace("/japanese")}
                style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]}
              >
                <MaterialIcons color={colors.text.inverse} name="home" size={21} />
                <Text style={styles.homeButtonText}>{copy.home}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.screen,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    backgroundColor: colors.surface.screen,
  },
  canvas: {
    width: "100%",
    maxWidth: 390,
    flexGrow: 1,
    backgroundColor: colors.surface.screen,
  },
  header: {
    height: 238,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 38,
    overflow: "hidden",
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: colors.brand.sky,
  },
  headerTitle: {
    color: colors.text.inverse,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 30,
    textAlign: "center",
  },
  main: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 38,
    paddingBottom: 72,
    backgroundColor: colors.surface.screen,
  },
  mainContent: {
    alignItems: "center",
  },
  illustrationStage: {
    width: 270,
    height: 270,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 45,
  },
  illustrationCircle: {
    position: "absolute",
    width: 224,
    height: 224,
    borderRadius: 112,
    backgroundColor: colors.brand.sky,
  },
  letterImage: {
    width: 260,
    height: 191,
  },
  homeButton: {
    width: 258,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.brand.gold,
    borderRadius: 10,
    backgroundColor: colors.brand.gold,
  },
  chatButton: {
    width: 258,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    borderRadius: 10,
    backgroundColor: colors.brand.sky,
  },
  chatButtonText: {
    color: colors.text.inverse,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  homeButtonText: {
    color: colors.text.inverse,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  matchStatusBlock: {
    width: 258,
    minHeight: 90,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 12,
    backgroundColor: colors.surface.blueSoft,
    gap: 8,
  },
  matchStatusText: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    textAlign: "center",
  },
  refreshButton: {
    minWidth: 100,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: colors.brand.sky,
  },
  refreshButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  refreshButtonText: {
    color: colors.text.inverse,
    fontSize: 12,
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.72,
  },
  });
}
