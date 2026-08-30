import { useCallback, useEffect, useRef, useState } from "react";
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

export default function JapaneseApplicationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [applications, setApplications] = useState<MatchView[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [withdrawingID, setWithdrawingID] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);
  const hasLoaded = useRef(false);
  const copy = COPY[language];
	const copyRef = useRef(copy);
	copyRef.current = copy;

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
        if (error instanceof Error && error.name === "AbortError") return;
        if (!cancelled) {
          setLoadState(initialLoad ? "error" : "ready");
			setLoadError(copyRef.current.loadError);
        }
      } finally {
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

  const openApplication = (matchID: string) => {
    router.push({
      pathname: "/japanese/guide-requested",
      params: { matchId: matchID },
    });
  };

  const withdraw = (application: MatchView) => {
    if (application.status !== "pending" || withdrawingID) return;
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
      setWithdrawingID(null);
    }
  };

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

        {loadState === "loading" ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color={BLUE} />
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
            ) : applications.map((application) => {
              const recruitmentCard = recruitmentToMatchCard(application.recruitment);
              const pending = application.status === "pending";
              const withdrawing = withdrawingID === application.id;
              return (
                <View key={application.id} style={styles.applicationCard}>
                  <Pressable
                    accessibilityLabel={`${application.other_user.name || copy.userFallback}${copy.detailLabelSuffix}`}
                    accessibilityRole="button"
                    onPress={() => openApplication(application.id)}
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
                      <View style={[styles.statusPill, { borderColor: statusColor(application.status) }]}>
                        <Text style={[styles.statusText, { color: statusColor(application.status) }]}>
                          {copy.status[application.status]}
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
