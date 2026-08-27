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
import { useAuth } from "../../../hooks/useAuth";
import {
  acceptMatch,
  getMatch,
  rejectMatch,
  type MatchView,
} from "../../../services/matching";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

export default function ForeignerApplicationDetailScreen() {
  const router = useRouter();
  const { getCurrentSession, session, status } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const applicationId = Array.isArray(id) ? id[0] : id;
  const [application, setApplication] = useState<MatchView | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<"idle" | "accepting" | "rejecting">("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (!applicationId || status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setLoadState("error");
          setLoadError("ログイン後に応募を表示できます。");
        }
        return;
      }

      setLoadState("loading");
      setLoadError(null);
      try {
        const result = await getMatch(applicationId, activeSession, controller.signal);
        if (!cancelled) {
          setApplication(result);
          setLoadState("ready");
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!cancelled) {
          setLoadState("error");
          setLoadError("応募を読み込めませんでした。すでに処理済みの可能性があります。");
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [applicationId, getCurrentSession, session, status]);

  if (!application) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        {loadState === "loading" ? <ActivityIndicator color={BLUE} /> : null}
        <Text accessibilityRole={loadState === "error" ? "alert" : undefined} style={styles.loadingText}>
          {loadState === "loading" ? "応募を読み込み中..." : loadError}
        </Text>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.loadingBackButton, pressed && styles.pressed]}
        >
          <Text style={styles.loadingBackButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const choseGuide = application.status === "accepted" || application.status === "completed";
  const declined = application.status === "rejected";
  const unavailable = application.status === "expired" || application.status === "blocked";
  const decided = choseGuide || declined || unavailable;

  const decide = async (action: "accept" | "reject") => {
    if (decided || actionState !== "idle") return;
    const activeSession = getCurrentSession() ?? session;
    if (status !== "signed_in" || !activeSession) {
      setActionError("ログイン後にもう一度お試しください。");
      return;
    }

    setActionState(action === "accept" ? "accepting" : "rejecting");
    setActionError(null);
    try {
      const result = action === "accept"
        ? await acceptMatch(application.id, activeSession)
        : await rejectMatch(application.id, activeSession);
      setApplication((current) => current ? { ...current, status: result.status, updated_at: result.updated_at, matched_at: result.matched_at } : current);
    } catch {
      setActionError("応募の処理に失敗しました。最新状態を確認して再試行してください。");
    } finally {
      setActionState("idle");
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
        </Pressable>

        <Text style={styles.headerTitle}>Application detail</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
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

          <Text style={styles.sectionLabel}>About this guide</Text>
          <Text style={styles.bio}>{application.other_user.bio || "No introduction provided."}</Text>
        </View>
      </ScrollView>

      <View style={styles.bottomActions}>
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
                ? "Guide chosen"
                : unavailable && application.status === "expired"
                  ? "Application expired"
                  : unavailable
                    ? "Application unavailable"
                    : "Application declined"}
            </Text>
          </View>
        ) : null}

        <Pressable
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
          <Text style={styles.primaryButtonText}>Choose this guide</Text>
        </Pressable>

        <Pressable
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
            {actionState === "rejecting" ? "Declining..." : "Decline"}
          </Text>
        </Pressable>
        {actionState === "accepting" ? (
          <Text style={styles.actionStatus}>Choosing guide...</Text>
        ) : null}
        {actionError ? (
          <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text>
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
