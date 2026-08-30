import { useCallback, useEffect, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../../hooks/useAuth";
import { APIError } from "../../../services/api-client";
import { getMatch, completeMatch, type MatchView } from "../../../services/matching";
import { loadLanguage, subscribeLanguage } from "../../../services/onboarding";
import type { AppLanguage } from "../../../services/onboarding-contract";

const BLUE = "#5ec5f5";
const BRIGHT_BLUE = "#00aeff";
const LIGHT_BLUE_BG = "#dae6f2";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const SUBTITLE_GRAY = "#8e8e93";
const MUTED_GRAY = "#949494";
const SOFT_BLUE = "#eff8ff";

type PhotoPreview = {
  uri: string;
  id: string;
};

const COPY = {
  ja: {
    headerTitle: "今日の思い出",
    mainTitle: "今日の思い出をアップロード",
    subtitle: "写真をアップロードして\nモンスターを交換しよう",
    addPhoto: "写真を追加",
    description: "写真をアップロードすると\n相手とモンスターを交換できます",
    exchange: "モンスターを交換",
    back: "戻る",
    loading: "読み込み中…",
    loginRequired: "ログイン後に利用できます。",
    loadError: "読み込めませんでした。時間をおいて再試行してください。",
    retry: "再試行",
    complete: "案内を完了する",
    completing: "完了中…",
    completeSuccess: "案内を完了しました",
    completeError: "案内完了処理に失敗しました。もう一度お試しください。",
    photoError: "写真の選択に失敗しました。もう一度お試しください。",
    withPerson: "さんと",
  },
  en: {
    headerTitle: "Today's memory",
    mainTitle: "Upload today's memory",
    subtitle: "Upload a photo to\nexchange monsters.",
    addPhoto: "Add photo",
    description: "Uploading a photo allows you to\nexchange monsters with your match.",
    exchange: "Exchange Monsters",
    back: "Back",
    loading: "Loading…",
    loginRequired: "Sign in to continue.",
    loadError: "Could not load. Please try again later.",
    retry: "Retry",
    complete: "Complete the guide",
    completing: "Completing…",
    completeSuccess: "Guide completed",
    completeError: "Could not complete the guide. Please try again.",
    photoError: "Could not select a photo. Please try again.",
    withPerson: " with ",
  },
} as const;

export default function MatchResultScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const matchId = Array.isArray(id) ? id[0] : id;
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [match, setMatch] = useState<MatchView | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoPreview[]>([]);
  const [completing, setCompleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const copy = COPY[language ?? "ja"];

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

  const loadMatch = useCallback(async () => {
    if (!matchId) return;

    const activeSession = getCurrentSession() ?? session;

    if (!activeSession) {
      setMatch({
        id: matchId,
        recruitment_id: "demo-recruitment",
        status: "completed",
        other_user: {
          id: "demo-partner",
          name: "Yuki Tanaka",
          nationality_code: "JP",
          bio: "Tokyo local guide",
          identity_status: "verified",
          likes_count: 12,
        },
        recruitment: {
          id: "demo-recruitment",
          category: "Places",
          author_name: "Yuki Tanaka",
          nationality_code: "JP",
          rating: 4.8,
          available_date: "2026-08-30",
          start_time: "10:00",
          end_time: "13:00",
          timezone: "Asia/Tokyo",
          duration_hours: 3,
          keywords: ["shibuya", "shopping"],
          description: "Explore Shibuya with a local",
          visibility_radius_km: 3,
          status: "completed",
          expires_at: "2026-08-30T23:59:59Z",
          created_at: "2026-08-20T10:00:00Z",
          updated_at: "2026-08-30T13:00:00Z",
        },
        created_at: "2026-08-20T10:00:00Z",
        updated_at: "2026-08-30T13:00:00Z",
      });
      setLoadState("ready");
      return;
    }

    setLoadState("loading");
    setLoadError(null);
    try {
      let result: MatchView;
      try {
        result = await getMatch(matchId, activeSession);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        result = await getMatch(matchId, refreshedSession);
      }
      setMatch(result);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setLoadError(copy.loadError);
    }
  }, [copy.loadError, getCurrentSession, matchId, refresh, session, status]);

  useEffect(() => {
    void loadMatch();
  }, [loadMatch]);

  const pickPhoto = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(copy.photoError);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
      });
      if (result.canceled || !result.assets) return;
      const newPhotos: PhotoPreview[] = result.assets.map((asset) => ({
        id: `${asset.uri}-${Date.now()}-${Math.random()}`,
        uri: asset.uri,
      }));
      setPhotos((current) => [...current, ...newPhotos]);
    } catch {
      Alert.alert(copy.photoError);
    }
  };

  const removePhoto = (photoId: string) => {
    setPhotos((current) => current.filter((p) => p.id !== photoId));
  };

  const handleComplete = async () => {
    if (completing || !matchId) return;
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) {
      Alert.alert(copy.completeSuccess);
      return;
    }
    setCompleting(true);
    setActionError(null);
    try {
      try {
        await completeMatch(matchId, activeSession);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        await completeMatch(matchId, refreshedSession);
      }
    } catch {
      setActionError(copy.completeError);
    } finally {
      setCompleting(false);
    }
  };

  const goToExchange = () => {
    if (!matchId) return;
    router.push({
      pathname: "/match-result/[id]/exchange",
      params: { id: matchId },
    });
  };

  if (!language) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator color={BLUE} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 24) }]}>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="arrow-back-ios-new" size={20} />
        </Pressable>
        <Text style={styles.headerTitle}>{copy.headerTitle}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {loadState === "loading" ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color={BLUE} />
            <Text style={styles.stateText}>{copy.loading}</Text>
          </View>
        ) : loadState === "error" ? (
          <View style={styles.statePanel}>
            <Text accessibilityRole="alert" style={styles.stateText}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadMatch()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : match ? (
          <>
            <Text style={styles.mainTitle}>{copy.mainTitle}</Text>
            <Text style={styles.subtitle}>{copy.subtitle}</Text>

            <View style={styles.photoCard}>
              {photos.length === 0 ? (
                <Pressable
                  accessibilityLabel={copy.addPhoto}
                  accessibilityRole="button"
                  onPress={() => void pickPhoto()}
                  style={({ pressed }) => [styles.photoAddArea, pressed && styles.pressed]}
                >
                  <Text style={styles.photoAddPlus}>＋</Text>
                  <Text style={styles.photoAddText}>{copy.addPhoto}</Text>
                </Pressable>
              ) : (
                <View style={styles.photoGrid}>
                  {photos.map((photo) => (
                    <View key={photo.id} style={styles.photoItem}>
                      <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
                      <Pressable
                        accessibilityLabel="Remove"
                        hitSlop={6}
                        onPress={() => removePhoto(photo.id)}
                        style={styles.photoRemoveButton}
                      >
                        <MaterialIcons color="#ffffff" name="close" size={16} />
                      </Pressable>
                    </View>
                  ))}
                  <Pressable
                    accessibilityLabel={copy.addPhoto}
                    accessibilityRole="button"
                    onPress={() => void pickPhoto()}
                    style={({ pressed }) => [styles.photoAddSmall, pressed && styles.pressed]}
                  >
                    <MaterialIcons color={BRIGHT_BLUE} name="add" size={28} />
                  </Pressable>
                </View>
              )}
            </View>

            <Text style={styles.description}>{copy.description}</Text>

            {actionError ? (
              <Text accessibilityRole="alert" style={styles.errorText}>{actionError}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: photos.length === 0 }}
              disabled={photos.length === 0}
              onPress={goToExchange}
              style={({ pressed }) => [
                styles.primaryButton,
                photos.length === 0 && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>{copy.exchange}</Text>
              <MaterialIcons color="#000000" name="swap-horiz" size={20} />
            </Pressable>

            <View style={styles.guideInfoCard}>
              <MaterialIcons color={BLUE} name="handshake" size={24} />
              <Text style={styles.guideInfoText}>
                {match.other_user.name}{copy.withPerson}
                {language === "ja" ? "案内しました" : "had a guide session"}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: completing, disabled: completing }}
              disabled={completing}
              onPress={() => void handleComplete()}
              style={({ pressed }) => [
                styles.secondaryButton,
                completing && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {completing ? (
                <ActivityIndicator color={BLUE} size="small" />
              ) : null}
              <Text style={styles.secondaryButtonText}>
                {completing ? copy.completing : copy.complete}
              </Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  header: {
    minHeight: 156,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingBottom: 24,
    backgroundColor: BLUE,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
  },
  backButton: {
    position: "absolute",
    top: 18,
    left: 12,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: "#ffffff", fontSize: 20, fontWeight: "900" },
  content: { alignItems: "center", paddingHorizontal: 20, paddingTop: 30 },
  mainTitle: { fontSize: 24, fontWeight: "900", color: "#000000", textAlign: "center" },
  subtitle: { marginTop: 28, fontSize: 18, fontWeight: "900", color: SUBTITLE_GRAY, textAlign: "center", lineHeight: 24 },
  photoCard: {
    width: "100%",
    maxWidth: 350,
    marginTop: 33,
    borderWidth: 1,
    borderColor: BRIGHT_BLUE,
    borderRadius: 16,
    backgroundColor: LIGHT_BLUE_BG,
    minHeight: 179,
    alignItems: "center",
    justifyContent: "center",
  },
  photoAddArea: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 24,
    width: "100%",
  },
  photoAddPlus: { fontSize: 40, fontWeight: "900", color: BRIGHT_BLUE, lineHeight: 44 },
  photoAddText: { fontSize: 20, fontWeight: "900", color: BRIGHT_BLUE },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 16, alignItems: "center", justifyContent: "center" },
  photoItem: { position: "relative" },
  photoPreview: { width: 100, height: 100, borderRadius: 12 },
  photoRemoveButton: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  photoAddSmall: {
    width: 100,
    height: 100,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BRIGHT_BLUE,
    borderRadius: 12,
    backgroundColor: LIGHT_BLUE_BG,
  },
  description: { marginTop: 16, fontSize: 16, fontWeight: "900", color: TEXT_GRAY, textAlign: "center", lineHeight: 22 },
  errorText: { color: "#b42318", fontSize: 13, fontWeight: "600", lineHeight: 19, textAlign: "center", marginTop: 12 },
  primaryButton: {
    width: "100%",
    maxWidth: 350,
    marginTop: 60,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    backgroundColor: YELLOW,
  },
  primaryButtonText: { color: "#000000", fontSize: 20, fontWeight: "900" },
  guideInfoCard: {
    width: "100%",
    maxWidth: 350,
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#cfe9f7",
    borderRadius: 16,
    backgroundColor: SOFT_BLUE,
  },
  guideInfoText: { flex: 1, color: TEXT_GRAY, fontSize: 14, fontWeight: "700" },
  secondaryButton: {
    width: "100%",
    maxWidth: 350,
    marginTop: 16,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 16,
    backgroundColor: "#ffffff",
  },
  secondaryButtonText: { color: BLUE, fontSize: 14, fontWeight: "800" },
  statePanel: { minHeight: 180, width: "100%", alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 20, paddingTop: 30 },
  stateText: { color: MUTED_GRAY, fontSize: 14, fontWeight: "600", lineHeight: 20, textAlign: "center" },
  retryButton: { minWidth: 84, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 18, backgroundColor: YELLOW },
  retryText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.72 },
});
