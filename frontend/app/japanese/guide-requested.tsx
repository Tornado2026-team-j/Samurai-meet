import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../../hooks/useAuth";
import { getMatch, type MatchView } from "../../services/matching";

const HEADER_BLUE = "#5ec5f5";
const YELLOW = "#e7b454";

export default function JapaneseGuideRequestedScreen() {
  const router = useRouter();
  const { getCurrentSession, session, status } = useAuth();
  const { matchId } = useLocalSearchParams<{ matchId?: string | string[] }>();
  const currentMatchID = Array.isArray(matchId) ? matchId[0] : matchId;
  const [match, setMatch] = useState<MatchView | null>(null);
  const [matchLoadState, setMatchLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [matchLoadError, setMatchLoadError] = useState<string | null>(null);

  const loadMatch = useCallback(async (signal?: AbortSignal) => {
    if (!currentMatchID) return;

    const activeSession = getCurrentSession() ?? session;
    if (status !== "signed_in" || !activeSession) {
      setMatchLoadState("error");
      setMatchLoadError("ログイン後にマッチング状態を確認できます。");
      return;
    }

    setMatchLoadState("loading");
    setMatchLoadError(null);
    try {
      const result = await getMatch(currentMatchID, activeSession, signal);
      setMatch(result);
      setMatchLoadState("ready");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setMatchLoadState("error");
      setMatchLoadError("マッチング状態を取得できませんでした。時間をおいて再試行してください。");
    }
  }, [currentMatchID, getCurrentSession, session, status]);

  useEffect(() => {
    if (!currentMatchID) return;
    const controller = new AbortController();
    void loadMatch(controller.signal);
    return () => controller.abort();
  }, [currentMatchID, loadMatch]);

  const matched = match?.status === "accepted" || match?.status === "completed";
  const unavailable = match?.status === "rejected"
    || match?.status === "cancelled"
    || match?.status === "expired"
    || match?.status === "blocked";

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.canvas}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {matched
              ? "マッチングしました！"
              : match?.status === "cancelled"
                ? "応募を取り下げました"
              : unavailable
                ? "今回はマッチングできませんでした"
                : "旅行者が応募を確認するまでお待ちください"}
          </Text>
        </View>

        <View style={styles.main}>
          <View style={styles.mainContent}>
            <View style={styles.illustrationStage}>
              <View style={styles.illustrationCircle} />
              <Image
                accessibilityLabel="応募確認待ちの手紙"
                resizeMode="contain"
                source={require("../../assets/images/letter.png")}
                style={styles.letterImage}
              />
            </View>

            {currentMatchID ? (
              <View style={styles.matchStatusBlock}>
                <Text accessibilityRole={matchLoadError ? "alert" : undefined} style={styles.matchStatusText}>
                  {matchLoadError
                    ?? (matched
                      ? "旅行者があなたを案内役として選びました。"
                      : match?.status === "cancelled"
                        ? "応募を取り下げました。"
                      : unavailable
                        ? "この応募は終了または利用できません。"
                        : match
                          ? "応募は送信済みです。旅行者の確認をお待ちください。"
                          : "マッチング状態を確認中です。")}
                </Text>
                <Pressable
                  accessibilityLabel={matchLoadState === "loading" ? "状態を更新中" : "状態を更新"}
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
                      <ActivityIndicator color="#ffffff" size="small" />
                      <Text style={styles.refreshButtonText}>更新中…</Text>
                    </View>
                  ) : (
                    <Text style={styles.refreshButtonText}>状態を更新</Text>
                  )}
                </Pressable>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/japanese")}
              style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]}
            >
              <MaterialIcons color="#ffffff" name="home" size={21} />
              <Text style={styles.homeButtonText}>ホームに戻る</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  canvas: {
    position: "relative",
    width: "100%",
    maxWidth: 390,
    minHeight: "100%",
    backgroundColor: "#ffffff",
  },
  header: {
    height: 238,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 38,
    overflow: "hidden",
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: HEADER_BLUE,
  },
  headerTitle: {
    color: "#ffffff",
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
    backgroundColor: "#ffffff",
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
    backgroundColor: "#5EC5F5",
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
    borderColor: YELLOW,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  homeButtonText: {
    color: "#ffffff",
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
    borderColor: "#d4d4d4",
    borderRadius: 12,
    backgroundColor: "#f7fbfd",
    gap: 8,
  },
  matchStatusText: {
    color: "#535353",
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
    backgroundColor: HEADER_BLUE,
  },
  refreshButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  refreshButtonText: {
    color: "#ffffff",
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
