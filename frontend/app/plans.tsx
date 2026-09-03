import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Header, colors, LoadingSpinner, radius, shadows, typography } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { APIError } from "../services/api-client";
import { cancelMeeting, createMeeting, endMeeting, getMeetingForMatch, meetingProximityCapability, resumeMeeting, startMeeting, type Meeting } from "../services/meeting";
import { completeMatch, likeMatch, listMatches, type MatchView } from "../services/matching";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../services/onboarding";
import { formatTimeRange, isJSTScheduleEnded } from "../utils/time";
import { getTabBarContentBottomPadding } from "../utils/layout";

type PlanTab = "today" | "upcoming" | "past";

const COPY = {
  ja: {
    title: "予定",
    tabs: { today: "今日", upcoming: "今後", past: "過去" },
    loading: "予定を読み込み中...",
    loadError: "予定を読み込めませんでした。",
    empty: "この期間の予定はありません",
    retry: "再試行",
    chat: "チャット",
    profile: "プロフィール",
    start: "会合を開始",
    end: "案内を終了",
    waiting: "相手の開始を待っています",
    cancel: "会合支援を中止",
    meetingCompleted: "この会合は終了済みです。",
    resume: "会合を再開する",
    resumeWaiting: "相手の再開同意を待っています",
    proximityUnavailable: "近接補助は現在利用できません。Expo Goでは現在地・Bluetoothを測定も共有もせず、開発ビルドでもOSの許可と監査済みアダプタが必要です。",
    processing: "更新中...",
    actionError: "予定を更新できませんでした。通信状況を確認してください。",
    meetingUnavailable: "この予定は現在利用できません。最新の予定を読み込んでください。",
    meetingStateChanged: "会合の状態が変わりました。最新の予定を読み込んでください。",
    meetingNotAvailable: "この会合は現在開始できません。マッチの状態を確認してください。",
    meetingForbidden: "この会合を操作する権限がありません。",
    like: "いいね",
    liked: "いいね済み",
    likeError: "いいねを送信できませんでした。予定終了後にもう一度お試しください。",
    reviewTitle: "予定はいかがでしたか？",
    reviewMessage: "相手にいいねを送れます。",
    reviewDate: "実施日時",
    reviewPerson: "評価する相手",
    reviewPending: "未評価",
    reviewAlreadyLiked: "評価済み",
    reviewLater: "あとで評価する",
    people: (count: number) => `募集 ${count}人`,
  },
  en: {
    title: "Plans",
    tabs: { today: "Today", upcoming: "Upcoming", past: "Past" },
    loading: "Loading plans...",
    loadError: "Plans could not be loaded.",
    empty: "No plans in this period",
    retry: "Retry",
    chat: "Chat",
    profile: "Profile",
    start: "Start meeting",
    end: "End guide",
    waiting: "Waiting for the other person to start",
    cancel: "Cancel meeting assistance",
    meetingCompleted: "This meeting has already ended.",
    resume: "Resume meeting assistance",
    resumeWaiting: "Waiting for the other participant to consent to resume",
    proximityUnavailable: "Nearby assistance is unavailable. Expo Go never measures or shares location or Bluetooth; a development build also needs OS permission and an audited adapter.",
    processing: "Updating...",
    actionError: "The plan could not be updated. Check your connection.",
    meetingUnavailable: "This plan is no longer available. Reload the latest plans.",
    meetingStateChanged: "The meeting state changed. Reload the latest plans.",
    meetingNotAvailable: "This meeting cannot be started now. Check the match status.",
    meetingForbidden: "You are not allowed to operate this meeting.",
    like: "Like",
    liked: "Liked",
    likeError: "The like could not be sent. Try again after the plan has ended.",
    reviewTitle: "How was your plan?",
    reviewMessage: "You can send the other participant a like.",
    reviewDate: "When",
    reviewPerson: "Person to rate",
    reviewPending: "Not rated yet",
    reviewAlreadyLiked: "Already rated",
    reviewLater: "Rate later",
    people: (count: number) => `${count} people needed`,
  },
} as const;

type PlanCopy = (typeof COPY)[AppLanguage];

function meetingActionError(error: unknown, copy: PlanCopy): string {
  if (!(error instanceof APIError)) return copy.actionError;
  switch (error.code) {
    case "meeting_not_found":
      return copy.meetingUnavailable;
    case "invalid_meeting_state":
      return copy.meetingStateChanged;
    case "meeting_not_available":
      return copy.meetingNotAvailable;
    case "meeting_forbidden":
      return copy.meetingForbidden;
    default:
      return copy.actionError;
  }
}

function jstDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function displayDate(value: string, language: AppLanguage): string {
  const parsed = new Date(`${value}T12:00:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(language === "ja" ? "ja-JP" : "en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  });
}

export default function PlansScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [activeTab, setActiveTab] = useState<PlanTab>("today");
  const [plans, setPlans] = useState<MatchView[]>([]);
  const [meetings, setMeetings] = useState<Record<string, Meeting>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);
  const [reviewPlan, setReviewPlan] = useState<MatchView | null>(null);
  const reviewPromptedRef = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const copy = COPY[language];
  const proximityCapability = meetingProximityCapability();

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((next) => {
      if (active && next) setLanguage(next);
    });
    void loadLanguage().then((next) => {
      if (active) setLanguage(next ?? "ja");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const load = useCallback(async (refreshMode = false) => {
    const activeSession = getCurrentSession() ?? session;
    if (status !== "signed_in" || !activeSession) {
      setLoading(false);
      setError(COPY[language].loadError);
      return;
    }
    if (refreshMode) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      let result: MatchView[];
      try {
        result = await listMatches(activeSession, { role: "all", limit: 50 });
      } catch (requestError) {
        if (!(requestError instanceof APIError) || requestError.status !== 401) throw requestError;
        await refresh();
        const nextSession = getCurrentSession();
        if (!nextSession) throw requestError;
        result = await listMatches(nextSession, { role: "all", limit: 50 });
      }
      const nextPlans = result.filter((item) => item.status === "accepted" || item.status === "completed");
      setPlans(nextPlans);
      const reviewCandidate = nextPlans.find((item) =>
        item.status === "completed" && !item.liked_by_me && !reviewPromptedRef.current.has(item.id));
      if (reviewCandidate) {
        reviewPromptedRef.current.add(reviewCandidate.id);
        setReviewPlan(reviewCandidate);
      }
      setActionError(null);
    } catch {
      setError(COPY[language].loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getCurrentSession, language, refresh, session, status]);

  useFocusEffect(
    useCallback(() => {
      if (status === "loading") return undefined;
      void load();
      return undefined;
    }, [load, status]),
  );

  useEffect(() => {
    const activeSession = getCurrentSession() ?? session;
    const today = jstDateKey();
    const candidates = plans.filter((plan) => plan.status === "accepted" && plan.recruitment.available_date === today);
    if (!activeSession || candidates.length === 0) return undefined;
    const controller = new AbortController();
    let active = true;
    void Promise.all(candidates.map(async (plan) => {
      try {
        return [plan.id, await getMeetingForMatch(plan.id, activeSession, controller.signal)] as const;
      } catch {
        // A 404 means that the lazy meeting session has not been created yet.
        // Other failures leave the action available and are reported on tap.
        return null;
      }
    })).then((entries) => {
      if (!active) return;
      setMeetings((current) => {
        const next = { ...current };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [getCurrentSession, plans, session]);

  const visiblePlans = useMemo(() => {
    const today = jstDateKey();
    const now = new Date();
    return plans
      .filter((plan) => {
        const date = plan.recruitment.available_date;
        const ended = isJSTScheduleEnded(plan.recruitment.available_date, plan.recruitment.end_time, now);
        if (activeTab === "today") return date === today && plan.status === "accepted" && !ended;
        if (activeTab === "upcoming") return date > today && plan.status === "accepted";
        return date < today || plan.status === "completed" || ended;
      })
      .sort((left, right) => {
        const direction = activeTab === "past" ? -1 : 1;
        return direction * `${left.recruitment.available_date}T${left.recruitment.start_time}`.localeCompare(
          `${right.recruitment.available_date}T${right.recruitment.start_time}`,
        );
      });
  }, [activeTab, plans]);

  const updateMeeting = async (plan: MatchView) => {
    if (busyMatchId) return;
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;
    setBusyMatchId(plan.id);
    setActionError(null);
    try {
      const scheduledAt = `${plan.recruitment.available_date}T${plan.recruitment.start_time}:00+09:00`;
      let current = meetings[plan.id];
      if (!current) {
        try {
          current = await getMeetingForMatch(plan.id, activeSession);
        } catch (error) {
          if (!(error instanceof APIError) || (error.status !== 404 && error.status !== 405)) throw error;
          current = await createMeeting(plan.id, scheduledAt, activeSession);
        }
      }
      if (current.status === "completed") {
        setMeetings((items) => ({ ...items, [plan.id]: current }));
        setActionError(copy.meetingCompleted);
        return;
      }
      const next = current.status === "cancelled"
        ? await resumeMeeting(current.id, activeSession)
        : current.status === "active"
        ? await endMeeting(current.id, activeSession)
        : await startMeeting(current.id, activeSession);
      setMeetings((items) => ({ ...items, [plan.id]: next }));
      if (next.status === "completed") {
        await completeMatch(plan.id, activeSession).catch(() => undefined);
        const completedPlan = { ...plan, status: "completed" as const };
        reviewPromptedRef.current.add(plan.id);
        setPlans((items) => items.map((item) => item.id === plan.id ? completedPlan : item));
        setReviewPlan(completedPlan);
      }
    } catch (error) {
      setActionError(meetingActionError(error, copy));
      if (error instanceof APIError && (error.status === 404 || error.status === 409)) {
        await load(true);
      }
    } finally {
      setBusyMatchId(null);
    }
  };

  const sendLike = async (plan: MatchView) => {
    if (busyMatchId || plan.liked_by_me) return;
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;
    setBusyMatchId(plan.id);
    setActionError(null);
    try {
      try {
        await likeMatch(plan.id, activeSession);
      } catch (requestError) {
        if (!(requestError instanceof APIError) || requestError.status !== 401) throw requestError;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw requestError;
        await likeMatch(plan.id, refreshedSession);
      }
      setPlans((items) => items.map((item) => item.id === plan.id ? { ...item, liked_by_me: true } : item));
      setReviewPlan((current) => current?.id === plan.id ? null : current);
    } catch {
      setActionError(copy.likeError);
    } finally {
      setBusyMatchId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header
        iconName="event-available"
        style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}
        title={copy.title}
        titleStyle={styles.headerTitle}
        variant="hero"
      />

      <View accessibilityRole="tablist" style={styles.tabs}>
        {(["today", "upcoming", "past"] as const).map((tab) => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
            onPress={() => setActiveTab(tab)}
            style={[styles.tab, activeTab === tab && styles.tabSelected]}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextSelected]}>{copy.tabs[tab]}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: getTabBarContentBottomPadding(insets.bottom) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.brand.sky} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.state}><LoadingSpinner color={colors.brand.sky} size={26} speedMs={680} /><Text style={styles.stateText}>{copy.loading}</Text></View>
        ) : error ? (
          <View style={styles.state}>
            <Text accessibilityRole="alert" style={styles.stateText}>{error}</Text>
            <Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{copy.retry}</Text></Pressable>
          </View>
        ) : visiblePlans.length === 0 ? (
          <View style={styles.state}><MaterialIcons color={colors.text.subtle} name="event-busy" size={36} /><Text style={styles.stateText}>{copy.empty}</Text></View>
        ) : visiblePlans.map((plan) => {
          const meeting = meetings[plan.id];
          const busy = busyMatchId === plan.id;
          return (
            <View key={plan.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.dateBadge}><Text style={styles.dateText}>{displayDate(plan.recruitment.available_date, language)}</Text></View>
                {plan.other_user.identity_status === "verified" ? <MaterialIcons color={colors.brand.sky} name="verified" size={22} /> : null}
              </View>
              <Text numberOfLines={2} style={styles.title}>{plan.recruitment.description}</Text>
              <Text style={styles.person}>{plan.other_user.name}</Text>
              <View style={styles.metaRow}>
                <MaterialIcons color={colors.text.subtle} name="schedule" size={18} />
                <Text style={styles.meta}>{formatTimeRange(plan.recruitment.start_time, plan.recruitment.duration_hours)}</Text>
                {plan.recruitment.location_name ? <><MaterialIcons color={colors.text.subtle} name="place" size={18} /><Text numberOfLines={1} style={styles.location}>{plan.recruitment.location_name}</Text></> : null}
              </View>
              <Text style={styles.people}>{copy.people(plan.recruitment.participant_limit || 1)}</Text>
              <View style={styles.actions}>
                <Pressable onPress={() => router.push({ pathname: "/chat", params: { matchId: plan.id } })} style={styles.secondaryAction}>
                  <MaterialIcons color={colors.text.secondary} name="chat-bubble-outline" size={18} />
                  <Text style={styles.secondaryActionText}>{copy.chat}</Text>
                </Pressable>
                <Pressable onPress={() => router.push({ pathname: "/users/[id]", params: { id: plan.other_user.id, matchId: plan.id } })} style={styles.secondaryAction}>
                  <MaterialIcons color={colors.text.secondary} name="person-outline" size={18} />
                  <Text style={styles.secondaryActionText}>{copy.profile}</Text>
                </Pressable>
              </View>
              {activeTab === "past" ? (
                <Pressable
                  accessibilityLabel={`${plan.other_user.name}に${copy.like}`}
                  accessibilityState={{ disabled: plan.liked_by_me || busy }}
                  disabled={plan.liked_by_me || busy}
                  onPress={() => void sendLike(plan)}
                  style={[styles.likeAction, (plan.liked_by_me || busy) && styles.disabled]}
                >
                  <MaterialIcons color={plan.liked_by_me ? colors.brand.sky : colors.text.secondary} name={plan.liked_by_me ? "thumb-up" : "thumb-up-off-alt"} size={18} />
                  <Text style={[styles.likeActionText, plan.liked_by_me && styles.likeActionTextSelected]}>{plan.liked_by_me ? copy.liked : copy.like}</Text>
                </Pressable>
              ) : null}
              {activeTab === "today" && plan.status === "accepted" ? (
                <>
                  {meeting?.status === "completed" ? <Text style={styles.meetingStatus}>{copy.meetingCompleted}</Text> : meeting?.status === "cancelled" && meeting.resume_requested ? <Text style={styles.meetingStatus}>{copy.resumeWaiting}</Text> : <>
                    <Pressable disabled={busy} onPress={() => void updateMeeting(plan)} style={[styles.primaryAction, busy && styles.disabled]}>
                      <MaterialIcons color={colors.text.inverse} name={meeting?.status === "active" ? "stop-circle" : "play-circle-filled"} size={21} />
                      <Text style={styles.primaryActionText}>{busy ? copy.processing : meeting?.status === "cancelled" ? copy.resume : meeting?.status === "active" ? copy.end : meeting?.owner_started_at || meeting?.requester_started_at ? copy.waiting : copy.start}</Text>
                    </Pressable>
                    {meeting?.status === "active" && !proximityCapability.enabled ? <Text accessibilityLiveRegion="polite" accessibilityRole="text" style={styles.proximityNotice}>{copy.proximityUnavailable}</Text> : null}
                    {meeting?.status === "planned" && (meeting.owner_started_at || meeting.requester_started_at) ? <Pressable disabled={busy} onPress={() => { const activeSession = getCurrentSession() ?? session; if (!activeSession) return; setBusyMatchId(plan.id); void cancelMeeting(meeting.id, activeSession).then((next) => setMeetings((items) => ({ ...items, [plan.id]: next }))).catch((error) => setActionError(meetingActionError(error, copy))).finally(() => setBusyMatchId(null)); }} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>{copy.cancel}</Text></Pressable> : null}
                  </>}
                </>
              ) : null}
            </View>
          );
        })}
        {actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}
      </ScrollView>
      <Modal
        animationType="fade"
        onRequestClose={() => setReviewPlan(null)}
        transparent
        visible={reviewPlan !== null}
      >
        <View style={styles.reviewBackdrop}>
          <View style={styles.reviewSheet}>
            <MaterialIcons color={colors.brand.sky} name="thumb-up" size={32} />
            <Text style={styles.reviewTitle}>{copy.reviewTitle}</Text>
            <Text style={styles.reviewMessage}>{copy.reviewMessage}</Text>
            {reviewPlan ? (
              <View style={styles.reviewPlanCard}>
                <Text style={styles.reviewPlanDate}>{copy.reviewDate}: {displayDate(reviewPlan.recruitment.available_date, language)}</Text>
                <Text style={styles.reviewPlanTime}>{formatTimeRange(reviewPlan.recruitment.start_time, reviewPlan.recruitment.duration_hours)}</Text>
                <Text numberOfLines={1} style={styles.reviewPlanPerson}>{copy.reviewPerson}: {reviewPlan.other_user.name}</Text>
                <Text style={styles.reviewPlanStatus}>{reviewPlan.liked_by_me ? copy.reviewAlreadyLiked : copy.reviewPending}</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busyMatchId !== null || !reviewPlan}
              onPress={() => { if (reviewPlan) void sendLike(reviewPlan); }}
              style={[styles.reviewPrimary, (busyMatchId !== null || !reviewPlan) && styles.disabled]}
            >
              <Text style={styles.reviewPrimaryText}>{reviewPlan?.liked_by_me ? copy.liked : copy.like}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setReviewPlan(null)}
              style={styles.reviewLater}
            >
              <Text style={styles.reviewLaterText}>{copy.reviewLater}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  header: {
    minHeight: 178,
    paddingHorizontal: 24,
    paddingBottom: 26,
    borderBottomLeftRadius: 42,
    borderBottomRightRadius: 42,
  },
  headerTitle: {
    marginTop: 8,
    color: colors.text.inverse,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 34,
  },
  tabs: { flexDirection: "row", marginHorizontal: 20, marginTop: 14, padding: 4, borderRadius: radius.lg, backgroundColor: colors.surface.subtle },
  tab: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  tabSelected: { backgroundColor: colors.surface.default, ...shadows.control },
  tabText: { color: colors.text.subtle, fontSize: 13, fontWeight: "700" },
  tabTextSelected: { color: colors.brand.sky },
  content: { padding: 20, gap: 14 },
  state: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: 12 },
  stateText: { color: colors.text.subtle, ...typography.body, textAlign: "center" },
  retry: { minHeight: 42, justifyContent: "center", paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.brand.sky },
  retryText: { color: colors.text.inverse, fontWeight: "800" },
  card: { padding: 16, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.lg, backgroundColor: colors.surface.default, ...shadows.card },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.surface.blueSoft },
  dateText: { color: colors.brand.sky, fontSize: 12, fontWeight: "800" },
  title: { marginTop: 10, color: colors.text.primary, fontSize: 17, fontWeight: "800", lineHeight: 23 },
  person: { marginTop: 5, color: colors.text.secondary, fontSize: 14, fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
  meta: { color: colors.text.subtle, fontSize: 12, fontWeight: "600" },
  location: { flex: 1, color: colors.text.subtle, fontSize: 12, fontWeight: "600" },
  people: { marginTop: 7, color: colors.text.subtle, fontSize: 12, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  secondaryAction: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.border.default, borderRadius: radius.md },
  secondaryActionText: { color: colors.text.secondary, fontSize: 12, fontWeight: "700" },
  likeAction: { minHeight: 42, marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.border.default, borderRadius: radius.md, backgroundColor: colors.surface.blueSoft },
  likeActionText: { color: colors.text.secondary, fontSize: 12, fontWeight: "800" },
  likeActionTextSelected: { color: colors.brand.sky },
  primaryAction: { minHeight: 46, marginTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: radius.md, backgroundColor: colors.brand.sky },
  primaryActionText: { color: colors.text.inverse, fontSize: 14, fontWeight: "800" },
  meetingStatus: { marginTop: 10, color: colors.text.subtle, fontSize: 13, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.55 },
  error: { color: colors.state.danger, fontSize: 13, fontWeight: "700", textAlign: "center" },
  proximityNotice: { marginTop: 8, color: colors.text.subtle, fontSize: 12, lineHeight: 18, textAlign: "center" },
  reviewBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.35)" },
  reviewSheet: { width: "100%", maxWidth: 420, alignItems: "center", padding: 26, borderRadius: radius.xl, backgroundColor: colors.surface.default, ...shadows.card },
  reviewTitle: { marginTop: 12, color: colors.text.primary, fontSize: 20, fontWeight: "800", textAlign: "center" },
  reviewMessage: { marginTop: 8, color: colors.text.secondary, fontSize: 14, fontWeight: "600", textAlign: "center" },
  reviewPlanCard: { width: "100%", marginTop: 18, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface.blueSoft },
  reviewPlanDate: { color: colors.text.secondary, fontSize: 12, fontWeight: "700" },
  reviewPlanTime: { marginTop: 4, color: colors.text.primary, fontSize: 15, fontWeight: "800" },
  reviewPlanPerson: { marginTop: 4, color: colors.text.secondary, fontSize: 13, fontWeight: "700" },
  reviewPlanStatus: { marginTop: 8, color: colors.brand.sky, fontSize: 12, fontWeight: "800" },
  reviewPrimary: { width: "100%", minHeight: 46, marginTop: 22, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.brand.sky },
  reviewPrimaryText: { color: colors.text.inverse, fontSize: 14, fontWeight: "800" },
  reviewLater: { minHeight: 42, marginTop: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  reviewLaterText: { color: colors.text.subtle, fontSize: 13, fontWeight: "700" },
});
