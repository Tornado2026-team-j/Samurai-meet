import { useEffect, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../../hooks/useAuth";
import { APIError } from "../../../services/api-client";
import { getMatch, type MatchView } from "../../../services/matching";
import { loadLanguage, subscribeLanguage } from "../../../services/onboarding";
import type { AppLanguage } from "../../../services/onboarding-contract";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";

const COPY = {
  en: {
    loading: "Loading application...",
    loginRequired: "Sign in to view this application.",
    loadError: "Application could not be loaded.",
    back: "Back",
    title: "Application detail",
    introduction: "About this guide",
    noIntroduction: "No introduction provided.",
    accept: "Choose this guide",
    guideResult: "View guide result",
  },
  ja: {
    loading: "応募を読み込み中…",
    loginRequired: "ログインすると応募を確認できます。",
    loadError: "応募を読み込めませんでした。",
    back: "戻る",
    title: "応募詳細",
    introduction: "自己紹介",
    noIntroduction: "自己紹介はありません。",
    accept: "この人を案内役に決定",
    guideResult: "案内結果を見る",
  },
} as const;

export default function ForeignerApplicationDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const applicationId = Array.isArray(id) ? id[0] : id;
  const [application, setApplication] = useState<MatchView | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
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

  useEffect(() => {
    const load = async () => {
      if (!applicationId || status !== "signed_in") return;
      const activeSession = getCurrentSession() ?? session;
      if (!activeSession) return;
      setLoadState("loading");
      try {
        let result: MatchView;
        try {
          result = await getMatch(applicationId, activeSession);
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 401) throw error;
          await refresh();
          const refreshedSession = getCurrentSession();
          if (!refreshedSession) throw error;
          result = await getMatch(applicationId, refreshedSession);
        }
        setApplication(result);
        setLoadState("ready");
      } catch {
        setLoadState("error");
      }
    };
    void load();
  }, [applicationId, getCurrentSession, refresh, session, status]);

  if (!application) {
    return (
      <View style={[styles.loadingScreen, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        {loadState === "loading" ? <ActivityIndicator color={BLUE} /> : null}
        <Text style={styles.loadingText}>
          {loadState === "loading" ? copy.loading : copy.loadError}
        </Text>
      </View>
    );
  }

  const accepted = application.status === "accepted" || application.status === "completed";

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 36) }]}>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            { top: Math.max(insets.top + 8, 49) },
            pressed && styles.pressed,
          ]}
        >
          <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
        </Pressable>
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.name}>{application.other_user.name}</Text>
        <Text style={styles.bio}>{application.other_user.bio || copy.noIntroduction}</Text>

        {accepted && applicationId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({
              pathname: "/match-result/[id]",
              params: { id: applicationId },
            })}
            style={({ pressed }) => [styles.guideResultButton, pressed && styles.pressed]}
          >
            <Text style={styles.guideResultButtonText}>{copy.guideResult}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: "#ffffff" },
  loadingText: { color: TEXT_GRAY, fontSize: 14, fontWeight: "700", textAlign: "center" },
  header: {
    position: "relative",
    height: 214,
    alignItems: "center",
    justifyContent: "center",
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: BLUE,
  },
  backButton: { position: "absolute", top: 49, left: 18, width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#ffffff", fontSize: 26, fontWeight: "900", textAlign: "center" },
  content: { alignItems: "center", paddingTop: 44, paddingHorizontal: 24, gap: 16 },
  name: { color: "#101318", fontSize: 24, fontWeight: "900", textAlign: "center" },
  bio: { color: TEXT_GRAY, fontSize: 14, fontWeight: "700", lineHeight: 22, textAlign: "center" },
  guideResultButton: {
    width: 280,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 10,
    backgroundColor: YELLOW,
    marginTop: 20,
  },
  guideResultButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "900" },
  pressed: { opacity: 0.72 },
});
