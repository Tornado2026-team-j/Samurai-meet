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
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

type PhotoPreview = {
  uri: string;
  id: string;
};

const COPY = {
  ja: {
    title: "今日の思い出をアップロード",
    back: "戻る",
    addPhoto: "写真を追加",
    photoHint: "写真をアップロードすると、相手とモンスターを交換できます",
    exchange: "モンスターを交換",
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
    title: "Today's Memory",
    back: "Back",
    addPhoto: "Add Photo",
    photoHint: "Upload a photo to exchange monsters.",
    exchange: "Exchange Monsters",
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
    if (!matchId || status !== "signed_in") return;
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;

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
    if (!activeSession) return;
    setCompleting(true);
    setActionError(null);
    try {
      // TODO: connect uploadEncryptedPhoto() when photo encryption pipeline is ready
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
            <View style={styles.guideInfoCard}>
              <MaterialIcons color={BLUE} name="handshake" size={28} />
              <Text style={styles.guideInfoText}>
                {match.other_user.name}{copy.withPerson}
                {language === "ja" ? "案内しました" : "had a guide session"}
              </Text>
            </View>

            <View style={styles.photoCard}>
              {photos.length === 0 ? (
                <Pressable
                  accessibilityLabel={copy.addPhoto}
                  accessibilityRole="button"
                  onPress={() => void pickPhoto()}
                  style={({ pressed }) => [styles.photoAddArea, pressed && styles.pressed]}
                >
                  <View style={styles.photoAddCircle}>
                    <MaterialIcons color={BLUE} name="add-a-photo" size={36} />
                  </View>
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
                    <MaterialIcons color={BLUE} name="add" size={28} />
                  </Pressable>
                </View>
              )}
              <Text style={styles.photoHint}>{copy.photoHint}</Text>
            </View>

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
              <MaterialIcons color="#ffffff" name="swap-horiz" size={20} />
            </Pressable>

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
  statePanel: { minHeight: 180, width: "100%", alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 20 },
  stateText: { color: MUTED_GRAY, fontSize: 14, fontWeight: "600", lineHeight: 20, textAlign: "center" },
  retryButton: { minWidth: 84, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 18, backgroundColor: YELLOW },
  retryText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
  guideInfoCard: {
    width: "100%",
    maxWidth: 390,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#cfe9f7",
    borderRadius: 16,
    backgroundColor: SOFT_BLUE,
  },
  guideInfoText: { flex: 1, color: TEXT_GRAY, fontSize: 15, fontWeight: "700" },
  photoCard: {
    width: "100%",
    maxWidth: 390,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    gap: 14,
  },
  photoAddArea: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    borderWidth: 2,
    borderColor: "#b8dff1",
    borderStyle: "dashed",
    borderRadius: 16,
    backgroundColor: "#f5fbff",
  },
  photoAddCircle: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 34,
    backgroundColor: "#eaf8ff",
  },
  photoAddText: { color: BLUE, fontSize: 15, fontWeight: "800" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
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
    borderWidth: 2,
    borderColor: "#b8dff1",
    borderStyle: "dashed",
    borderRadius: 12,
    backgroundColor: "#f5fbff",
  },
  photoHint: { color: MUTED_GRAY, fontSize: 12, lineHeight: 18, textAlign: "center" },
  errorText: { color: "#b42318", fontSize: 13, fontWeight: "600", lineHeight: 19, textAlign: "center" },
  primaryButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "900" },
  secondaryButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  secondaryButtonText: { color: BLUE, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.72 },
});
