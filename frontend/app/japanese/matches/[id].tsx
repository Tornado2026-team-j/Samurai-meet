import { useEffect, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, LoadingSpinner } from "../../../components/ui";
import { useAuth } from "../../../hooks/useAuth";
import { APIError } from "../../../services/api-client";
import { loadLanguage, subscribeLanguage } from "../../../services/onboarding";
import {
  getRecruitment,
  recruitmentToMatchCard,
  sendRecruitmentInterest,
} from "../../../services/matching";
import type { AppLanguage } from "../../../services/onboarding";
import type { MatchCardData } from "../../../types/match";
import { formatTimeRange } from "../../../utils/time";

const BLUE = colors.brand.sky;
const YELLOW = colors.brand.gold;
const TEXT_GRAY = colors.text.muted;
const HEADER_BLUE = colors.brand.sky;
const CATEGORY_ICONS = {
  Food: "restaurant",
  Places: "place",
  Activity: "directions-run",
  Other: "category",
} as const;
const CATEGORY_IMAGES = {
  Food: require("../../../assets/images/food.png"),
  Places: require("../../../assets/images/places-category.png"),
  Activity: require("../../../assets/images/activity-category.png"),
  Other: require("../../../assets/images/other-category.png"),
} as const;

type MatchDetailCopy = {
  back: string;
  loading: string;
  loginRequired: string;
  loadError: string;
  retry: string;
  requestLogin: string;
  requestError: string;
  date: string;
  time: string;
  location: string;
  people: string;
  description: string;
  keywords: string;
  send: string;
  sending: string;
  categoryIllustration: string;
  report: string;
  home: string;
};

const COPY: Record<AppLanguage, MatchDetailCopy> = {
  ja: {
    back: "戻る",
    loading: "募集を読み込み中...",
    loginRequired: "ログイン後に募集を表示できます。",
    loadError: "募集を読み込めませんでした。募集が終了した可能性があります。",
    retry: "再試行",
    requestLogin: "ログイン後にもう一度お試しください。",
    requestError: "応募を送信できませんでした。時間をおいてもう一度お試しください。",
    date: "日付",
    time: "時刻",
    location: "場所",
    people: "募集人数",
    description: "したいこと",
    keywords: "キーワード",
    send: "この人を案内したい！",
    sending: "応募を送信中...",
    categoryIllustration: "カテゴリのイラスト",
    report: "この募集を通報",
    home: "ホーム",
  },
  en: {
    back: "Back",
    loading: "Loading recruitment...",
    loginRequired: "Please sign in to view this recruitment.",
    loadError: "We couldn't load this recruitment. It may have ended.",
    retry: "Try again",
    requestLogin: "Please sign in and try again.",
    requestError: "We couldn't send your application. Please try again later.",
    date: "Date",
    time: "Time",
    location: "Where",
    people: "People needed",
    description: "What you'd like to do",
    keywords: "Keywords",
    send: "I want to guide this person!",
    sending: "Sending application...",
    categoryIllustration: " category illustration",
    report: "Report this recruitment",
    home: "Home",
  },
};

export default function JapaneseMatchDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const matchId = Array.isArray(id) ? id[0] : id;
  const [match, setMatch] = useState<MatchCardData | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [requestState, setRequestState] = useState<"idle" | "sending">("idle");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [languageLoaded, setLanguageLoaded] = useState(false);
  const copy = COPY[language ?? "ja"];
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const authRef = useRef({ getCurrentSession, refresh, session, status });
  authRef.current = { getCurrentSession, refresh, session, status };

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (!cancelled) {
        setLanguage(nextLanguage ?? "ja");
        setLanguageLoaded(true);
      }
    });

    void loadLanguage()
      .then((storedLanguage) => {
        if (cancelled) return;
        setLanguage(storedLanguage ?? "ja");
        setLanguageLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLanguage("ja");
        setLanguageLoaded(true);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      const auth = authRef.current;
      const activeSession = auth.getCurrentSession() ?? auth.session;
      if (!matchId || auth.status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setMatch(null);
          setLoadState("error");
          setLoadError(copyRef.current.loginRequired);
        }
        return;
      }

      setLoadState("loading");
      setLoadError(null);
      try {
        const loadWithSession = (currentSession: typeof activeSession) => getRecruitment(
          matchId,
          currentSession,
          controller.signal,
        );
        let recruitment;
        try {
          recruitment = await loadWithSession(activeSession);
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 401) throw error;
          await auth.refresh();
          const refreshedSession = auth.getCurrentSession();
          if (!refreshedSession) throw error;
          recruitment = await loadWithSession(refreshedSession);
        }
        if (!cancelled) {
          setMatch(recruitmentToMatchCard(recruitment));
          setLoadState("ready");
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError" && (cancelled || controller.signal.aborted)) return;
        if (!cancelled) {
          setMatch(null);
          setLoadState("error");
          setLoadError(copyRef.current.loadError);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loadAttempt, matchId, status]);

  if (!languageLoaded) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <LoadingSpinner color={HEADER_BLUE} size={26} />
      </View>
    );
  }

  if (!match) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        {loadState === "loading" ? <LoadingSpinner color={HEADER_BLUE} size={26} /> : null}
        <Text accessibilityRole={loadState === "error" ? "alert" : undefined} style={styles.loadingText}>
          {loadState === "loading" ? copy.loading : loadError}
        </Text>
        {loadState === "error" ? (
          <Pressable
            accessibilityLabel={copy.retry}
            accessibilityRole="button"
            onPress={() => {
              setMatch(null);
              setLoadState("loading");
              setLoadError(null);
              setLoadAttempt((attempt) => attempt + 1);
            }}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryButtonText}>{copy.retry}</Text>
          </Pressable>
        ) : null}
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

  const sendInterest = async () => {
    if (requestState === "sending") return;
    const activeSession = getCurrentSession() ?? session;
    if (status !== "signed_in" || !activeSession) {
      setRequestError(copy.requestLogin);
      return;
    }

    setRequestState("sending");
    setRequestError(null);

    try {
      const sendWithSession = (currentSession: typeof activeSession) => sendRecruitmentInterest(
        match.id,
        currentSession,
      );
      let interest;
      try {
        interest = await sendWithSession(activeSession);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        interest = await sendWithSession(refreshedSession);
      }
      if (interest?.id) {
        router.push({
          pathname: "/japanese/guide-requested",
          params: { matchId: interest.id, recruitmentId: interest.recruitment_id },
        });
      } else {
        router.push("/japanese/guide-requested");
      }
    } catch {
      setRequestError(copy.requestError);
    } finally {
      setRequestState("idle");
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.header,
            { minHeight: Math.max(insets.top + 210, 260) },
          ]}
        >
            <Image
              accessibilityLabel={`${match.category}${copy.categoryIllustration}`}
              resizeMode="contain"
              source={CATEGORY_IMAGES[match.category]}
              style={[styles.categoryImage, { top: Math.max(insets.top + 20, 60) }]}
            />

            <Pressable
              accessibilityLabel={copy.back}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.backButton,
            { top: Math.max(insets.top + 6, 45) },
                pressed && styles.pressed,
              ]}
            >
              <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
            </Pressable>

            <Pressable
              accessibilityLabel={copy.home}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => router.replace("/japanese")}
              style={({ pressed }) => [
                styles.homeButton,
                { top: Math.max(insets.top + 6, 45) },
                pressed && styles.pressed,
              ]}
            >
              <MaterialIcons color="#ffffff" name="home" size={24} />
            </Pressable>

            <View
              style={[
                styles.categoryBadge,
                { top: Math.max(insets.top + 8, 48) },
              ]}
            >
              <MaterialIcons
                color={YELLOW}
                name={CATEGORY_ICONS[match.category]}
                size={19}
              />
              <Text style={styles.categoryText}>{match.category}</Text>
            </View>
        </View>
        <View style={styles.content}>
          <View style={styles.profileGroup}>
            <MaterialIcons color="#d4d4d4" name="account-circle" size={50} />
            <View style={styles.profileText}>
              <View style={styles.nameRow}>
                <Text numberOfLines={1} style={styles.name}>
                  {match.authorName}
                </Text>
                <Text style={styles.flag}>{match.countryFlag}</Text>
              </View>
              <Text style={styles.country}>{match.countryName}</Text>
              <View style={styles.ratingRow}>
                <MaterialIcons color={YELLOW} name="thumb-up-off-alt" size={17} />
                <Text style={styles.rating}>{match.rating}</Text>
              </View>
            </View>
          </View>

          <View style={styles.schedulePanel}>
            <View style={styles.scheduleRow}>
              <MaterialIcons color="#168df0" name="calendar-today" size={25} />
              <View style={styles.scheduleText}>
                <Text style={styles.scheduleLabel}>{copy.date}</Text>
                <Text style={styles.scheduleValue}>{match.detailDate}</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={[styles.scheduleRow, styles.timeRow]}>
              <MaterialIcons color="#168df0" name="schedule" size={27} />
              <View style={styles.scheduleText}>
                <Text style={styles.scheduleLabel}>{copy.time}</Text>
                <Text style={styles.scheduleValue}>
                  {formatTimeRange(match.startTime, match.durationHours)}
                </Text>
              </View>
            </View>
            {match.locationName ? <><View style={styles.divider} /><View style={[styles.scheduleRow, styles.timeRow]}><MaterialIcons color={BLUE} name="place" size={27} /><View style={styles.scheduleText}><Text style={styles.scheduleLabel}>{copy.location}</Text><Text style={styles.scheduleValue}>{match.locationName}</Text></View></View></> : null}
            <View style={styles.peopleRow}><MaterialIcons color={BLUE} name="groups" size={20} /><Text style={styles.peopleText}>{copy.people}: {match.participantLimit ?? 1}</Text></View>
          </View>

          <View style={styles.descriptionPanel}>
            <Text style={styles.descriptionLabel}>{copy.description}</Text>
            <Text style={styles.description}>{match.description}</Text>
          </View>

          <View style={styles.keywordsPanel}>
            <View style={styles.keywordsTitleRow}>
              <MaterialIcons color="#168df0" name="sell" size={21} />
              <Text style={styles.keywordsTitle}>{copy.keywords}</Text>
            </View>
            <View style={styles.keywordsRow}>
              {match.detailTags.map((tag) => (
                <View key={tag} style={styles.keyword}>
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    numberOfLines={1}
                    style={styles.keywordText}
                  >
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: requestState === "sending" }}
            disabled={requestState === "sending"}
            onPress={() => void sendInterest()}
            style={({ pressed }) => [
              styles.guideButton,
              requestState === "sending" && styles.guideButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.guideButtonText}>
              {requestState === "sending" ? copy.sending : copy.send}
            </Text>
          </Pressable>

          {requestError ? (
            <Text
              accessibilityRole="alert"
              style={styles.requestError}
            >
              {requestError}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({
              pathname: "/report",
              params: { targetType: "recruitment_card", targetId: match.id, name: match.authorName },
            })}
            style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}
          >
            <MaterialIcons color="#b42318" name="outlined-flag" size={19} />
            <Text style={styles.reportButtonText}>{copy.report}</Text>
          </Pressable>
        </View>
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
  retryButton: {
    minWidth: 84,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: BLUE,
  },
  retryButtonText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: "800",
  },
  reportButton: {
    minHeight: 44,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  reportButtonText: {
    color: "#b42318",
    fontSize: 13,
    fontWeight: "800",
  },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: HEADER_BLUE,
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
  homeButton: {
    position: "absolute",
    right: 18,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  categoryImage: {
    position: "absolute",
    top: 66,
    alignSelf: "center",
    width: "100%",
    maxWidth: 383,
    height: 180,
  },
  categoryBadge: {
    position: "absolute",
    top: 46,
    alignSelf: "center",
    width: 95,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  categoryText: {
    color: "#535353",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 18,
  },
  profileGroup: {
    width: "100%",
    minHeight: 62,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  content: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    paddingTop: 20,
    paddingHorizontal: 28,
  },
  profileText: {
    marginLeft: 17,
  },
  nameRow: {
    height: 25,
    flexDirection: "row",
    alignItems: "center",
  },
  name: {
    maxWidth: 154,
    color: "#000000",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 24,
  },
  flag: {
    marginLeft: 13,
    color: "#000000",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 24,
  },
  country: {
    marginTop: 2,
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  ratingRow: {
    marginTop: 5,
    height: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  rating: {
    marginLeft: 5,
    color: YELLOW,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  schedulePanel: {
    width: "100%",
    minHeight: 132,
    marginTop: 10,
    paddingHorizontal: 24,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: "#e4e4e4",
    borderRadius: 12,
    backgroundColor: "#ffffff",
  },
  scheduleRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
  },
  timeRow: {
    marginTop: 7,
  },
  scheduleText: {
    marginLeft: 17,
  },
  scheduleLabel: {
    color: "#3d3d3d",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  scheduleValue: {
    marginTop: 3,
    color: "#000000",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 24,
  },
  peopleRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  peopleText: {
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
  },
  divider: {
    width: "100%",
    height: 1,
    marginVertical: 5,
    backgroundColor: "#e6e6e6",
  },
  descriptionPanel: {
    width: "100%",
    minHeight: 108,
    marginTop: 12,
    paddingTop: 10,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 20,
    backgroundColor: "#f4f9fd",
  },
  descriptionLabel: {
    color: BLUE,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  description: {
    marginTop: 10,
    color: "#000000",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  keywordsPanel: {
    width: "100%",
    minHeight: 64,
    marginTop: 14,
  },
  keywordsTitleRow: {
    height: 25,
    flexDirection: "row",
    alignItems: "center",
  },
  keywordsTitle: {
    marginLeft: 7,
    color: "#168df0",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  keywordsRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  keyword: {
    minWidth: 59,
    maxWidth: 74,
    height: 30,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#eff8ff",
  },
  keywordText: {
    color: "#222222",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  guideButton: {
    width: "100%",
    minHeight: 46,
    marginTop: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  guideButtonDisabled: {
    opacity: 0.72,
  },
  guideButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  requestError: {
    width: "100%",
    marginTop: 10,
    color: "#d45555",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 14,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.72,
  },
});
