import { useEffect, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
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
import { loadLanguage, subscribeLanguage } from "../../../services/onboarding";
import type { AppLanguage } from "../../../services/onboarding-contract";
import {
  acceptMatch,
  getMatch,
  listMatches,
  rejectMatch,
  type MatchView,
} from "../../../services/matching";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

type LoadErrorKey = "loginRequired" | "failed";
type ActionErrorKey = "loginRequired" | "failed";

type DetailCopy = {
  loading: string;
  loginRequired: string;
  loadError: string;
  back: string;
  title: string;
  introduction: string;
  noIntroduction: string;
  accept: string;
  accepting: string;
  reject: string;
  rejecting: string;
  processingAccept: string;
  processingReject: string;
  actionFailed: string;
  status: {
    accepted: string;
    rejected: string;
    cancelled: string;
    recruitmentClosed: string;
    expired: string;
    unavailable: string;
  };
};

const COPY: Record<AppLanguage, DetailCopy> = {
  en: {
    loading: "Loading application...",
    loginRequired: "Sign in to view this application.",
    loadError: "Application could not be loaded. It may already have been processed.",
    back: "Back",
    title: "Application detail",
    introduction: "About this guide",
    noIntroduction: "No introduction provided.",
    accept: "Choose this guide",
    accepting: "Choosing guide...",
    reject: "Decline",
    rejecting: "Declining...",
    processingAccept: "Choosing guide...",
    processingReject: "Declining...",
    actionFailed: "The application could not be processed. Check the latest status and try again.",
    status: {
      accepted: "Guide chosen",
      rejected: "Application declined",
      cancelled: "Application withdrawn",
      recruitmentClosed: "Recruitment closed",
      expired: "Application expired",
      unavailable: "Application unavailable",
    },
  },
  ja: {
    loading: "応募を読み込み中…",
    loginRequired: "ログインすると応募を確認できます。",
    loadError: "応募を読み込めませんでした。すでに処理済みの可能性があります。",
    back: "戻る",
    title: "応募詳細",
    introduction: "自己紹介",
    noIntroduction: "自己紹介はありません。",
    accept: "この人を案内役に決定",
    accepting: "案内役を選択中…",
    reject: "却下する",
    rejecting: "却下中…",
    processingAccept: "案内役を選択しています…",
    processingReject: "応募を却下しています…",
    actionFailed: "応募を処理できませんでした。最新の状態を確認して、もう一度お試しください。",
    status: {
      accepted: "案内役に決定しました",
      rejected: "応募を却下しました",
      cancelled: "応募は取り下げ済みです",
      recruitmentClosed: "募集は終了しています",
      expired: "応募の期限が切れています",
      unavailable: "応募は利用できません",
    },
  },
};

export default function ForeignerApplicationDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const { id, recruitmentId } = useLocalSearchParams<{
    id?: string | string[];
    recruitmentId?: string | string[];
  }>();
  const applicationId = Array.isArray(id) ? id[0] : id;
  const recruitmentID = Array.isArray(recruitmentId) ? recruitmentId[0] : recruitmentId;
  const [application, setApplication] = useState<MatchView | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<LoadErrorKey | null>(null);
  const [actionState, setActionState] = useState<"idle" | "accepting" | "rejecting">("idle");
  const [actionError, setActionError] = useState<ActionErrorKey | null>(null);
  const [bottomActionsHeight, setBottomActionsHeight] = useState(0);
  const [language, setLanguage] = useState<AppLanguage>("en");
  const copy = COPY[language];

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage ?? "en");
    });
    void loadLanguage()
      .then((storedLanguage) => {
        if (active && storedLanguage) setLanguage(storedLanguage);
      })
      .catch(() => {
        // Keep the initial English copy when saved-language storage is unavailable.
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (!applicationId || status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setLoadState("error");
          setLoadError("loginRequired");
        }
        return;
      }

      setLoadState("loading");
      setLoadError(null);
      try {
        const loadWithSession = async (currentSession: typeof activeSession) => {
          try {
            return await getMatch(applicationId, currentSession, controller.signal);
          } catch (error) {
            if (!(error instanceof APIError) || error.status !== 404) throw error;
            const ownerMatches = await listMatches(
              currentSession,
              { role: "owner", limit: 50 },
              controller.signal,
            );
            const fallback = ownerMatches.find((item) =>
              item.id === applicationId
              || item.recruitment.id === recruitmentID
              || item.recruitment.id === applicationId,
            );
            if (!fallback) throw error;
            return fallback;
          }
        };
        const loadWithRefresh = async () => {
          try {
            return await loadWithSession(activeSession);
          } catch (error) {
            if (!(error instanceof APIError) || error.status !== 401) throw error;
            await refresh();
            const refreshedSession = getCurrentSession();
            if (!refreshedSession) throw error;
            return loadWithSession(refreshedSession);
          }
        };
        const result = await loadWithRefresh();
        if (!cancelled) {
          setApplication(result);
          setLoadState("ready");
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!cancelled) {
          setLoadState("error");
          setLoadError("failed");
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [applicationId, getCurrentSession, refresh, recruitmentID, session, status]);

  if (!application) {
    return (
      <View
        style={[
          styles.loadingScreen,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <StatusBar style="light" />
        {loadState === "loading" ? <ActivityIndicator color={BLUE} /> : null}
        <Text accessibilityRole={loadState === "error" ? "alert" : undefined} style={styles.loadingText}>
          {loadState === "loading" ? copy.loading : loadError ? (loadError === "loginRequired" ? copy.loginRequired : copy.loadError) : null}
        </Text>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.loadingBackButton, pressed && styles.pressed]}
        >
          <Text style={styles.loadingBackButtonText}>{copy.back}</Text>
        </Pressable>
      </View>
    );
  }

  const choseGuide = application.status === "accepted" || application.status === "completed";
  const declined = application.status === "rejected";
  const withdrawn = application.status === "cancelled";
  const unavailable = application.status === "expired" || application.status === "blocked";
  const recruitmentClosed = application.status === "pending"
    && application.recruitment.status !== "open"
    && application.recruitment.status !== "matched";
  const decided = choseGuide || declined || withdrawn || unavailable || recruitmentClosed;

  const decide = async (action: "accept" | "reject") => {
    if (decided || actionState !== "idle") return;
    const activeSession = getCurrentSession() ?? session;
    if (status !== "signed_in" || !activeSession) {
      setActionError("loginRequired");
      return;
    }

    setActionState(action === "accept" ? "accepting" : "rejecting");
    setActionError(null);
    try {
      const runAction = async (currentSession: typeof activeSession) => action === "accept"
        ? await acceptMatch(application.id, currentSession)
        : await rejectMatch(application.id, currentSession);
      let result;
      try {
        result = await runAction(activeSession);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        result = await runAction(refreshedSession);
      }
      setApplication((current) => current ? { ...current, status: result.status, updated_at: result.updated_at, matched_at: result.matched_at } : current);
    } catch {
      setActionError("failed");
    } finally {
      setActionState("idle");
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top, 36) },
        ]}
      >
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

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + Math.max(bottomActionsHeight + 24, 220),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <MaterialIcons color="#d4d4d4" name="account-circle" size={92} />
          </View>

          <Text numberOfLines={1} style={styles.name}>
            {application.other_user.name}
          </Text>
          <Text style={styles.country}>{application.other_user.nationality_code}</Text>

          <View style={styles.divider} />

          <Text style={styles.sectionLabel}>{copy.introduction}</Text>
          <Text style={styles.bio}>{application.other_user.bio || copy.noIntroduction}</Text>
        </View>
      </ScrollView>

      <View
        onLayout={(event) => setBottomActionsHeight(event.nativeEvent.layout.height)}
        style={[
          styles.bottomActions,
          { paddingBottom: Math.max(insets.bottom + 20, 34) },
        ]}
      >
        {decided ? (
          <View
            accessibilityRole="text"
            style={[styles.resultBanner, declined && styles.resultBannerDeclined]}
          >
            <MaterialIcons
              color={choseGuide ? BLUE : MUTED_GRAY}
              name={choseGuide ? "verified" : "block"}
              size={21}
            />
            <Text
              style={[
                styles.resultText,
                declined && styles.resultTextDeclined,
              ]}
            >
                {choseGuide
                  ? copy.status.accepted
                  : withdrawn
                    ? copy.status.cancelled
                    : recruitmentClosed
                      ? copy.status.recruitmentClosed
                  : unavailable && application.status === "expired"
                    ? copy.status.expired
                  : unavailable
                    ? copy.status.unavailable
                    : copy.status.rejected}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityLabel={actionState === "accepting" ? copy.accepting : copy.accept}
          accessibilityRole="button"
          accessibilityState={{ disabled: decided }}
          disabled={decided}
          onPress={() => void decide("accept")}
          style={({ pressed }) => [
            styles.primaryButton,
            decided && styles.disabledButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>{actionState === "accepting" ? copy.accepting : copy.accept}</Text>
        </Pressable>

        <Pressable
          accessibilityLabel={actionState === "rejecting" ? copy.rejecting : copy.reject}
          accessibilityRole="button"
          accessibilityState={{ disabled: decided }}
          disabled={decided}
          onPress={() => void decide("reject")}
          style={({ pressed }) => [
            styles.secondaryButton,
            decided && styles.disabledSecondaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.secondaryButtonText,
              decided && styles.disabledSecondaryButtonText,
            ]}
          >
            {actionState === "rejecting" ? copy.rejecting : copy.reject}
          </Text>
        </Pressable>
        {actionState === "accepting" ? (
          <Text style={styles.actionStatus}>{copy.processingAccept}</Text>
        ) : null}
        {actionError ? (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {actionError === "loginRequired" ? copy.loginRequired : copy.actionFailed}
          </Text>
        ) : null}
      </View>
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
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
    backgroundColor: "#ffffff",
  },
  loadingText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },
  loadingBackButton: {
    minWidth: 84,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: YELLOW,
  },
  loadingBackButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  header: {
    position: "relative",
    height: 214,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 36,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: BLUE,
  },
  backButton: {
    position: "absolute",
    top: 49,
    left: 18,
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 32,
    textAlign: "center",
  },
  content: {
    alignItems: "center",
    paddingTop: 44,
    paddingHorizontal: 24,
    paddingBottom: 210,
  },
  profileCard: {
    width: "100%",
    maxWidth: 342,
    alignItems: "center",
    paddingTop: 28,
    paddingRight: 24,
    paddingBottom: 30,
    paddingLeft: 24,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  avatarCircle: {
    width: 108,
    height: 108,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 54,
    backgroundColor: "#ffffff",
  },
  name: {
    maxWidth: "100%",
    marginTop: 20,
    color: "#101318",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 30,
    textAlign: "center",
  },
  country: {
    marginTop: 4,
    color: MUTED_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 17,
  },
  divider: {
    width: "100%",
    height: 1,
    marginTop: 24,
    backgroundColor: BORDER_GRAY,
  },
  sectionLabel: {
    alignSelf: "flex-start",
    marginTop: 22,
    color: BLUE,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 17,
  },
  bio: {
    marginTop: 10,
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 22,
  },
  bottomActions: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    paddingTop: 18,
    paddingRight: 32,
    paddingBottom: 34,
    paddingLeft: 32,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    backgroundColor: "#ffffff",
  },
  resultBanner: {
    width: "100%",
    maxWidth: 326,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#caeafd",
    borderRadius: 10,
    backgroundColor: SOFT_BLUE,
  },
  resultBannerDeclined: {
    borderColor: BORDER_GRAY,
    backgroundColor: "#f7f7f7",
  },
  resultText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 17,
  },
  resultTextDeclined: {
    color: MUTED_GRAY,
  },
  primaryButton: {
    width: "100%",
    maxWidth: 326,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  secondaryButton: {
    width: "100%",
    maxWidth: 326,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  secondaryButtonText: {
    color: BLUE,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  disabledButton: {
    borderColor: BORDER_GRAY,
    backgroundColor: BORDER_GRAY,
  },
  disabledSecondaryButton: {
    borderColor: BORDER_GRAY,
  },
  disabledSecondaryButtonText: {
    color: MUTED_GRAY,
  },
  actionStatus: {
    marginTop: 10,
    color: BLUE,
    fontSize: 12,
    fontWeight: "700",
  },
  actionError: {
    maxWidth: 326,
    marginTop: 10,
    color: "#b42318",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.72,
  },
});
