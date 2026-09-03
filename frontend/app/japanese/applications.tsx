import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LoadingSpinner } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { APIError } from "../../services/api-client";
import { loadLanguage, subscribeLanguage } from "../../services/onboarding";
import type { AppLanguage } from "../../services/onboarding-contract";
import {
  listMatches,
  recruitmentToMatchCard,
  withdrawRecruitmentInterest,
  type MatchStatus,
  type MatchView,
} from "../../services/matching";
import { formatTimeRange } from "../../utils/time";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";

type ApplicationFilter = "all" | "pending" | "expired" | "resolved";
const APPLICATION_FILTERS: ApplicationFilter[] = ["all", "pending", "expired", "resolved"];

const COPY = {
  ja: {
    title: "応募履歴",
    intro: "自分が送った応募だけを表示しています。",
    loginRequired: "ログイン後に応募履歴を表示できます。",
    loading: "応募履歴を読み込み中…",
    loadError: "応募履歴を読み込めませんでした。時間をおいて再試行してください。",
    retry: "再試行",
    empty: "送信した応募はまだありません。",
    ownerLabel: "募集作成者",
    userFallback: "ユーザー",
    openHint: "応募の状態を確認する ›",
    withdrawTitle: "応募を取り下げますか？",
    withdrawMessageSuffix: "さんへの応募を取り下げます。",
    cancel: "キャンセル",
    withdraw: "取り下げる",
    withdrawing: "取り下げ中…",
    withdrawFailedTitle: "応募を取り下げられませんでした",
    withdrawFailedMessage: "最新の状態を確認して、もう一度お試しください。",
    resultFixed: "この応募は結果が確定しています。",
    back: "戻る",
    detailLabelSuffix: "さんへの応募詳細を開く",
    withdrawLabel: "応募を取り下げる",
    withdrawingLabel: "応募を取り下げ中",
    filters: { all: "すべて", pending: "進行中", expired: "期限切れ", resolved: "終了済み" },
    noFilteredApplications: "この状態の応募はありません。",
    status: {
      pending: "審査中",
      accepted: "承認済み",
      rejected: "却下",
      cancelled: "取り下げ済み",
      blocked: "利用不可",
      expired: "期限切れ",
      completed: "完了",
    },
  },
  en: {
    title: "Application history",
    intro: "Showing applications you sent.",
    loginRequired: "Sign in to view your application history.",
    loading: "Loading application history…",
    loadError: "Application history could not be loaded. Please try again later.",
    retry: "Retry",
    empty: "You have not sent any applications yet.",
    ownerLabel: "Recruitment owner",
    userFallback: "User",
    openHint: "View application status ›",
    withdrawTitle: "Withdraw this application?",
    withdrawMessageSuffix: "'s application will be withdrawn.",
    cancel: "Cancel",
    withdraw: "Withdraw",
    withdrawing: "Withdrawing…",
    withdrawFailedTitle: "The application could not be withdrawn",
    withdrawFailedMessage: "Check the latest status and try again.",
    resultFixed: "The result for this application is final.",
    back: "Back",
    detailLabelSuffix: "'s application details",
    withdrawLabel: "Withdraw application",
    withdrawingLabel: "Withdrawing application",
    filters: { all: "All", pending: "In progress", expired: "Expired", resolved: "Finished" },
    noFilteredApplications: "No applications match this status.",
    status: {
      pending: "Pending",
      accepted: "Accepted",
      rejected: "Declined",
      cancelled: "Withdrawn",
      blocked: "Unavailable",
      expired: "Expired",
      completed: "Completed",
    },
  },
} as const;

function statusColor(status: MatchStatus): string {
  if (status === "accepted" || status === "completed") return "#168df0";
  if (status === "pending") return YELLOW;
  return MUTED_GRAY;
}

export function isApplicationExpired(application: MatchView, now: Date = new Date()): boolean {
  if (application.status === "expired" || application.recruitment.status === "expired") return true;
  if (application.recruitment.status !== "open" && application.recruitment.status !== "matched") return false;
  const expiresAt = Date.parse(application.recruitment.expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

export function matchesApplicationFilter(
  application: MatchView,
  filter: ApplicationFilter,
  now: Date = new Date(),
): boolean {
  const expired = isApplicationExpired(application, now);
  switch (filter) {
    case "all":
      return true;
    case "pending":
      return application.status === "pending" && !expired;
    case "expired":
      return expired;
    case "resolved":
      return application.status !== "pending" && !expired;
  }
}

export default function JapaneseApplicationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [applications, setApplications] = useState<MatchView[]>([]);
  const [applicationFilter, setApplicationFilter] = useState<ApplicationFilter>("all");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [withdrawingID, setWithdrawingID] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);
  const hasLoaded = useRef(false);
  const loadInFlightRef = useRef(false);
  const withdrawingIDRef = useRef<string | null>(null);
  const copy = COPY[language];
	const copyRef = useRef(copy);
  copyRef.current = copy;

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/japanese");
  };

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active && nextLanguage) setLanguage(nextLanguage);
    });
    void loadLanguage().then((storedLanguage) => {
      if (active) setLanguage(storedLanguage ?? "ja");
    }).catch(() => {
      // Keep the stable default when the preference cannot be read.
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const loadApplications = useCallback(() => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setApplications([]);
          setRefreshing(false);
          setLoadState("error");
			setLoadError(copyRef.current.loginRequired);
        }
		loadInFlightRef.current = false;
        return;
      }

      const initialLoad = !hasLoaded.current;
      if (initialLoad) {
        setLoadState("loading");
      } else {
        setRefreshing(true);
      }
      setLoadError(null);
      try {
        const request = (currentSession: typeof activeSession) => listMatches(
          currentSession,
          { role: "requester", limit: 50 },
          controller.signal,
        );
        let result: MatchView[];
        try {
          result = await request(activeSession);
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 401) throw error;
          await refresh();
          const refreshedSession = getCurrentSession();
          if (!refreshedSession) throw error;
          result = await request(refreshedSession);
        }
        if (!cancelled) {
          setApplications(result);
          hasLoaded.current = true;
          setLoadState("ready");
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError" && (cancelled || controller.signal.aborted)) return;
        if (!cancelled) {
          setLoadState(initialLoad ? "error" : "ready");
			setLoadError(copyRef.current.loadError);
        }
      } finally {
		loadInFlightRef.current = false;
        if (!cancelled) setRefreshing(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
	}, [getCurrentSession, refresh, session, status]);

  const loadApplicationsRef = useRef(loadApplications);
  loadApplicationsRef.current = loadApplications;

  useEffect(() => {
    if (initialLoadStarted.current || status === "loading") return;
    initialLoadStarted.current = true;
    return loadApplicationsRef.current();
  }, [status]);

  const openApplication = (application: MatchView) => {
    router.push({
      pathname: "/japanese/guide-requested",
      params: {
        matchId: application.id,
        recruitmentId: application.recruitment.id,
      },
    });
  };

  const withdraw = (application: MatchView) => {
    if (application.status !== "pending" || withdrawingID || withdrawingIDRef.current) return;
    const recipientName = application.other_user.name || copy.userFallback;
    Alert.alert(
      copy.withdrawTitle,
      `${recipientName}${copy.withdrawMessageSuffix}`,
      [
        { text: copy.cancel, style: "cancel" },
        {
          text: copy.withdraw,
          style: "destructive",
          onPress: () => void performWithdraw(application),
        },
      ],
    );
  };

  const performWithdraw = async (application: MatchView) => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || status !== "signed_in") return;
    if (withdrawingIDRef.current) return;
    withdrawingIDRef.current = application.id;
    setWithdrawingID(application.id);
    try {
      let result;
      try {
        result = await withdrawRecruitmentInterest(application.id, activeSession);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        result = await withdrawRecruitmentInterest(application.id, refreshedSession);
      }
      setApplications((current) => current.map((item) => (
        item.id === application.id
          ? { ...item, status: result.status, updated_at: result.updated_at }
          : item
      )));
    } catch {
      Alert.alert(copy.withdrawFailedTitle, copy.withdrawFailedMessage);
    } finally {
      withdrawingIDRef.current = null;
      setWithdrawingID(null);
    }
  };

  const filteredApplications = useMemo(() => {
    const now = new Date();
    return applications.filter((application) => matchesApplicationFilter(application, applicationFilter, now));
  }, [applicationFilter, applications]);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.header, {
        minHeight: Math.max(108, insets.top + 72),
        paddingTop: Math.max(insets.top, 18),
      }]}>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          hitSlop={10}
          onPress={goBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
        </Pressable>
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 120, 132) }]}
        refreshControl={
          <RefreshControl
            onRefresh={() => loadApplications()}
            refreshing={refreshing}
            tintColor={BLUE}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>{copy.intro}</Text>
        <ScrollView
          contentContainerStyle={styles.filterContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
        >
          {APPLICATION_FILTERS.map((filter) => {
            const selected = applicationFilter === filter;
            return (
              <Pressable
                key={filter}
                accessibilityLabel={copy.filters[filter]}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setApplicationFilter(filter)}
                style={({ pressed }) => [
                  styles.filterButton,
                  selected && styles.filterButtonSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.filterButtonText, selected && styles.filterButtonTextSelected]}>
                  {copy.filters[filter]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loadState === "loading" ? (
          <View style={styles.statePanel}>
            <LoadingSpinner color={BLUE} size={24} speedMs={680} />
            <Text style={styles.stateText}>{copy.loading}</Text>
          </View>
        ) : loadState === "error" ? (
          <View style={styles.statePanel}>
            <Text accessibilityRole="alert" style={styles.stateText}>{loadError}</Text>
            <Pressable
              accessibilityLabel={copy.retry}
              accessibilityRole="button"
              onPress={loadApplications}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {loadError ? (
              <View style={styles.inlineError}>
                <Text accessibilityRole="alert" style={styles.inlineErrorText}>{loadError}</Text>
                <Pressable
                  accessibilityLabel={copy.retry}
                  accessibilityRole="button"
                  onPress={() => loadApplications()}
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.retryText}>{copy.retry}</Text>
                </Pressable>
              </View>
            ) : null}
            {applications.length === 0 ? (
              <View style={styles.statePanel}>
                <MaterialIcons color={MUTED_GRAY} name="history" size={36} />
                <Text style={styles.stateText}>{copy.empty}</Text>
              </View>
            ) : filteredApplications.length === 0 ? (
              <View style={styles.statePanel}>
                <MaterialIcons color={MUTED_GRAY} name="filter-list" size={36} />
                <Text style={styles.stateText}>{copy.noFilteredApplications}</Text>
              </View>
            ) : filteredApplications.map((application) => {
              const recruitmentCard = recruitmentToMatchCard(application.recruitment);
              const expired = isApplicationExpired(application);
              const displayedStatus: MatchStatus = expired ? "expired" : application.status;
              const pending = application.status === "pending" && !expired;
              const withdrawing = withdrawingID === application.id;
              return (
                <View key={application.id} style={styles.applicationCard}>
                  <Pressable
                    accessibilityLabel={`${application.other_user.name || copy.userFallback}${copy.detailLabelSuffix}`}
                    accessibilityRole="button"
                    onPress={() => openApplication(application)}
                    style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.avatar}>
                        <MaterialIcons color="#d4d4d4" name="account-circle" size={38} />
                      </View>
                      <View style={styles.recipientBlock}>
                        <Text numberOfLines={1} style={styles.recipientName}>
                          {application.other_user.name || copy.userFallback}
                        </Text>
                        <Text style={styles.recipientCountry}>
                          {copy.ownerLabel} · {application.other_user.nationality_code || "—"}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { borderColor: statusColor(displayedStatus) }]}>
                        <Text style={[styles.statusText, { color: statusColor(displayedStatus) }]}>
                          {copy.status[displayedStatus]}
                        </Text>
                      </View>
                    </View>

                    <Text numberOfLines={2} style={styles.description}>
                      {application.recruitment.description}
                    </Text>
                    <Text style={styles.schedule}>
                      {recruitmentCard.detailDate} · {formatTimeRange(application.recruitment.start_time, application.recruitment.duration_hours)}
                    </Text>
                    <Text style={styles.openHint}>{copy.openHint}</Text>
                  </Pressable>

                  {pending ? (
                    <Pressable
                      accessibilityLabel={withdrawing ? copy.withdrawingLabel : copy.withdrawLabel}
                      accessibilityRole="button"
                      accessibilityState={{ busy: withdrawing, disabled: withdrawing }}
                      disabled={withdrawing}
                      onPress={() => withdraw(application)}
                      style={({ pressed }) => [styles.withdrawButton, withdrawing && styles.disabled, pressed && styles.pressed]}
                    >
                      {withdrawing ? <ActivityIndicator color="#b42318" size="small" /> : null}
                      <Text style={styles.withdrawText}>{withdrawing ? copy.withdrawing : copy.withdraw}</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.resultText}>{copy.resultFixed}</Text>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
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
  backButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerTitle: { color: "#ffffff", fontSize: 24, fontWeight: "800" },
  content: {
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 22,
    gap: 14,
  },
  intro: {
    alignSelf: "stretch",
    color: MUTED_GRAY,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  filterScroll: { alignSelf: "stretch" },
  filterContent: { gap: 8, paddingHorizontal: 2 },
  filterButton: {
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 18,
    backgroundColor: "#ffffff",
  },
  filterButtonSelected: { borderColor: BLUE, backgroundColor: "#eff8ff" },
  filterButtonText: { color: TEXT_GRAY, fontSize: 13, fontWeight: "800" },
  filterButtonTextSelected: { color: BLUE },
  statePanel: {
    minHeight: 180,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 20,
  },
  inlineError: {
    width: "100%",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  inlineErrorText: {
    color: "#b42318",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    textAlign: "center",
  },
  stateText: { color: MUTED_GRAY, fontSize: 14, fontWeight: "600", lineHeight: 20, textAlign: "center" },
  retryButton: {
    minWidth: 84,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: YELLOW,
  },
  retryText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
  applicationCard: {
    width: "100%",
    maxWidth: 390,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 18,
    backgroundColor: "#ffffff",
  },
  cardMain: { padding: 16, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "#f6f6f6",
  },
  recipientBlock: { flex: 1, gap: 3 },
  recipientName: { color: "#111111", fontSize: 17, fontWeight: "800" },
  recipientCountry: { color: MUTED_GRAY, fontSize: 12, fontWeight: "600" },
  statusPill: {
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: 14,
  },
  statusText: { fontSize: 12, fontWeight: "800" },
  description: { color: TEXT_GRAY, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  schedule: { color: TEXT_GRAY, fontSize: 13, fontWeight: "700", lineHeight: 19 },
  openHint: { color: BLUE, fontSize: 12, fontWeight: "700" },
  withdrawButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#d9aaa5",
    borderRadius: 22,
    backgroundColor: "#fff8f7",
  },
  withdrawText: { color: "#b42318", fontSize: 13, fontWeight: "800" },
  resultText: {
    marginHorizontal: 16,
    marginBottom: 16,
    color: MUTED_GRAY,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.72 },
});
