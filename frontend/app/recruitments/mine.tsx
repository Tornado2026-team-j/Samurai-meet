import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DismissKeyboardView from "../../components/DismissKeyboardView";
import WebDatePicker from "../../components/WebDatePicker";
import { LoadingSpinner } from "../../components/ui";
import type { ThemeColors } from "../../components/ui/tokens";
import { useAuth } from "../../hooks/useAuth";
import { useTheme, useThemeStyles } from "../../hooks/useTheme";
import { APIError } from "../../services/api-client";
import { loadLanguage, subscribeLanguage } from "../../services/onboarding";
import type { AppLanguage } from "../../services/onboarding-contract";
import {
  closeRecruitment,
  listMatches,
  listMyRecruitments,
  updateRecruitment,
  type MatchStatus,
  type MatchView,
  type Recruitment,
  type RecruitmentStatus,
  type RecruitmentUpdateRequest,
} from "../../services/matching";
import {
  formatRecruitmentISODate,
  parseRecruitmentDateInput,
  JST_TIME_ZONE,
} from "../../services/recruitment";
import { formatTimeRange } from "../../utils/time";
import { MATCH_CATEGORIES, type MatchCategory } from "../../types/match";

const CATEGORIES = MATCH_CATEGORIES;
const TIME_PICKER_HOURS = Array.from({ length: 24 }, (_, hourValue) => hourValue);
const TIME_PICKER_MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);

type EditTimeField = "start_time" | "end_time";

function parseEditTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) return { hour: 0, minute: 0 };
  const hour = Number(match[1]);
  return hour <= 23 ? { hour, minute: Number(match[2]) } : { hour: 0, minute: 0 };
}

function parseEditDate(value: string): Date {
  try {
    return parseRecruitmentDateInput(value);
  } catch {
    try {
      return parseRecruitmentDateInput(formatRecruitmentISODate(new Date()));
    } catch {
      return new Date();
    }
  }
}

const COPY = {
  ja: {
    back: "戻る", title: "自分の募集を管理", intro: "公開中・下書き・終了した募集を確認できます。",
    loginRequired: "ログイン後に募集を管理できます。", loading: "募集を読み込み中…",
    loadError: "募集管理を読み込めませんでした。時間をおいて再試行してください。", retry: "再試行",
    empty: "自分の募集はまだありません。", updateLoginRequired: "ログイン後にもう一度お試しください。",
    updateError: "募集を更新できませんでした。日付・時刻と入力内容を確認してください。",
    closeTitle: "募集を終了しますか？", closeMessage: "公開停止後も履歴として残ります。", cancel: "キャンセル",
    close: "終了する", closeError: "募集を終了できませんでした。最新の状態を確認してください。",
    editing: "編集", edit: "編集", publish: "公開する", publishing: "公開中…", moveToDraft: "下書きに戻す", movingToDraft: "移動中…",
    ending: "終了中…", endPublic: "公開を終了", applicants: "応募者",
    moveToDraftTitle: "募集を下書きに戻しますか？", moveToDraftMessage: "公開を一時停止し、あとで編集・再公開できます。",
    noApplicants: "まだ応募はありません。", userFallback: "ユーザー", review: "確認", state: "状態",
    editTitle: "募集を編集", closeEditor: "編集を閉じる", category: "カテゴリ", date: "日付（JST）",
    dateInput: "募集日付（JST）", start: "開始（JST）", startInput: "開始時刻（JST）", end: "終了（JST）",
    endInput: "終了時刻（JST）", description: "したいこと", descriptionInput: "募集内容",
    datePickerHint: "OS標準の日付選択を開く", closeDatePicker: "日付選択を閉じる", pickerDateTitle: "日付を選択",
    closeTimePicker: "時刻選択を閉じる", pickerTimeTitle: "時刻を選択", pickerCancel: "キャンセル", pickerDone: "完了",
    keywords: "キーワード（カンマ区切り）", keywordsInput: "キーワード", radius: "公開範囲",
    location: "場所表示名", people: "募集人数（1〜10人）",
    jstHint: "日時はサーバーと同じJST（Asia/Tokyo）で保存されます。", save: "保存", saving: "保存中…",
    filters: { all: "すべて", open: "公開中", draft: "下書き", expired: "期限切れ", closed: "終了済み" },
    noFilteredRecruitments: "この状態の募集はありません。",
    recruitmentStatus: { draft: "下書き", open: "公開中", matched: "マッチ済み", closed: "終了", expired: "期限切れ", completed: "完了" },
    matchStatus: { pending: "応募を確認中", accepted: "承認済み", rejected: "却下", cancelled: "応募取り下げ", blocked: "利用不可", expired: "期限切れ", completed: "完了" },
  },
  en: {
    back: "Back", title: "Manage my recruitments", intro: "Review your open, draft, and closed recruitments.",
    loginRequired: "Sign in to manage recruitments.", loading: "Loading recruitments…",
    loadError: "Recruitments could not be loaded. Please try again later.", retry: "Retry",
    empty: "You have not created any recruitments yet.", updateLoginRequired: "Sign in and try again.",
    updateError: "The recruitment could not be updated. Check the date, time, and details.",
    closeTitle: "Close this recruitment?", closeMessage: "It will remain in your history after it is no longer public.", cancel: "Cancel",
    close: "Close", closeError: "The recruitment could not be closed. Check the latest status and try again.",
    editing: "Edit", edit: "Edit", publish: "Publish", publishing: "Publishing…", moveToDraft: "Move to draft", movingToDraft: "Moving…",
    ending: "Closing…", endPublic: "Close recruitment", applicants: "Applicants",
    moveToDraftTitle: "Move this recruitment to draft?", moveToDraftMessage: "It will stop being public and can be edited and published later.",
    noApplicants: "There are no applications yet.", userFallback: "User", review: "Review", state: "Status",
    editTitle: "Edit recruitment", closeEditor: "Close editor", category: "Category", date: "Date (JST)",
    dateInput: "Recruitment date (JST)", start: "Start (JST)", startInput: "Start time (JST)", end: "End (JST)",
    endInput: "End time (JST)", description: "What would you like to do?", descriptionInput: "Recruitment details",
    datePickerHint: "Open the system date picker", closeDatePicker: "Close date picker", pickerDateTitle: "Choose date",
    closeTimePicker: "Close time picker", pickerTimeTitle: "Choose time", pickerCancel: "Cancel", pickerDone: "Done",
    keywords: "Keywords (comma separated)", keywordsInput: "Keywords", radius: "Visibility range",
    location: "Location name", people: "People needed (1–10)",
    jstHint: "Times are saved in JST (Asia/Tokyo), the same time zone used by the server.", save: "Save", saving: "Saving…",
    filters: { all: "All", open: "Open", draft: "Draft", expired: "Expired", closed: "Finished" },
    noFilteredRecruitments: "No recruitments match this status.",
    recruitmentStatus: { draft: "Draft", open: "Open", matched: "Matched", closed: "Closed", expired: "Expired", completed: "Completed" },
    matchStatus: { pending: "Pending review", accepted: "Accepted", rejected: "Declined", cancelled: "Withdrawn", blocked: "Unavailable", expired: "Expired", completed: "Completed" },
  },
} as const;

type EditDraft = {
  category: MatchCategory;
  available_date: string;
  start_time: string;
  end_time: string;
  keywords: string;
  description: string;
  location_name: string;
  participant_limit: string;
  visibility_radius_km: 1 | 3 | 5;
};

type RecruitmentFilter = "all" | "open" | "draft" | "expired" | "closed";

const RECRUITMENT_FILTERS: RecruitmentFilter[] = ["all", "open", "draft", "expired", "closed"];

export function isRecruitmentExpired(
  recruitment: Pick<Recruitment, "status" | "expires_at">,
  now: Date = new Date(),
): boolean {
  if (recruitment.status === "expired") return true;
  if (recruitment.status !== "open" && recruitment.status !== "matched") return false;
  const expiresAt = Date.parse(recruitment.expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function displayedRecruitmentStatus(recruitment: Recruitment, now: Date = new Date()): RecruitmentStatus {
  return isRecruitmentExpired(recruitment, now) ? "expired" : recruitment.status;
}

export function matchesRecruitmentFilter(
  recruitment: Recruitment,
  filter: RecruitmentFilter,
  now: Date = new Date(),
): boolean {
  const expired = isRecruitmentExpired(recruitment, now);
  switch (filter) {
    case "all":
      return true;
    case "open":
      return !expired && (recruitment.status === "open" || recruitment.status === "matched");
    case "draft":
      return recruitment.status === "draft";
    case "expired":
      return expired;
    case "closed":
      return recruitment.status === "closed" || recruitment.status === "completed";
  }
}

function recruitmentStatusColor(status: Recruitment["status"], colors: ThemeColors): string {
  if (status === "open" || status === "matched") return colors.state.link;
  if (status === "draft") return colors.brand.gold;
  return colors.text.muted;
}

function matchStatusColor(status: MatchStatus, colors: ThemeColors): string {
  if (status === "accepted" || status === "completed") return colors.state.link;
  if (status === "pending") return colors.brand.gold;
  return colors.text.muted;
}

function canEdit(recruitment: Recruitment): boolean {
  return recruitment.status === "draft" || recruitment.status === "open";
}

function canClose(recruitment: Recruitment): boolean {
  return recruitment.status === "open" || recruitment.status === "matched";
}

export default function MyRecruitmentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const { colors, scheme } = useTheme();
  const styles = useThemeStyles(createStyles);
  const BLUE = colors.brand.sky;
  const TEXT_GRAY = colors.text.secondary;
  const MUTED_GRAY = colors.text.muted;
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [recruitments, setRecruitments] = useState<Recruitment[]>([]);
  const [applications, setApplications] = useState<MatchView[]>([]);
  const [recruitmentFilter, setRecruitmentFilter] = useState<RecruitmentFilter>("all");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Recruitment | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editDatePickerVisible, setEditDatePickerVisible] = useState(false);
  const [editPickerDate, setEditPickerDate] = useState(() => parseEditDate(""));
  const [editTimePickerField, setEditTimePickerField] = useState<EditTimeField | null>(null);
  const [editDraftHour, setEditDraftHour] = useState(0);
  const [editDraftMinute, setEditDraftMinute] = useState(0);
  const [saving, setSaving] = useState(false);
  const [statusChangingID, setStatusChangingID] = useState<string | null>(null);
  const [closingID, setClosingID] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);
  const hasLoaded = useRef(false);
  const loadInFlightRef = useRef(false);
  const savingRef = useRef(false);
  const statusChangingRef = useRef<string | null>(null);
  const closingIDRef = useRef<string | null>(null);
  const copy = COPY[language ?? "ja"];
	const copyRef = useRef(copy);
	copyRef.current = copy;

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/profile");
  };

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

  const loadManagement = useCallback(() => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setRecruitments([]);
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
        const request = async (currentSession: typeof activeSession) => {
          const [owned, ownedApplications] = await Promise.all([
            listMyRecruitments(currentSession, controller.signal),
            listMatches(currentSession, { role: "owner", limit: 50 }, controller.signal),
          ]);
          return { owned, ownedApplications };
        };
        let result;
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
          setRecruitments(result.owned);
          setApplications(result.ownedApplications);
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

  const loadManagementRef = useRef(loadManagement);
  loadManagementRef.current = loadManagement;

  useEffect(() => {
    if (initialLoadStarted.current || status === "loading") return;
    initialLoadStarted.current = true;
    return loadManagementRef.current();
  }, [status]);

  const applicationsByRecruitment = useMemo(() => {
    const grouped = new Map<string, MatchView[]>();
    for (const application of applications) {
      const current = grouped.get(application.recruitment.id) ?? [];
      current.push(application);
      grouped.set(application.recruitment.id, current);
    }
    return grouped;
  }, [applications]);

  const filteredRecruitments = useMemo(() => {
    const now = new Date();
    return recruitments.filter((recruitment) => matchesRecruitmentFilter(recruitment, recruitmentFilter, now));
  }, [recruitmentFilter, recruitments]);

  const startEditing = (recruitment: Recruitment) => {
    if (!canEdit(recruitment)) return;
    setOperationError(null);
    setEditing(recruitment);
    setEditDatePickerVisible(false);
    setEditTimePickerField(null);
    setEditPickerDate(parseEditDate(recruitment.available_date));
    const startTime = parseEditTime(recruitment.start_time);
    setEditDraftHour(startTime.hour);
    setEditDraftMinute(startTime.minute);
    setEditDraft({
      category: recruitment.category,
      available_date: recruitment.available_date,
      start_time: recruitment.start_time,
      end_time: recruitment.end_time,
      keywords: recruitment.keywords.join(", "),
      description: recruitment.description,
      location_name: recruitment.location_name,
      participant_limit: String(recruitment.participant_limit),
      visibility_radius_km: recruitment.visibility_radius_km,
    });
  };

  const closeEditor = () => {
    if (saving) return;
    setEditDatePickerVisible(false);
    setEditTimePickerField(null);
    setEditing(null);
    setEditDraft(null);
  };

  const closeEditorAfterSave = () => {
    setEditDatePickerVisible(false);
    setEditTimePickerField(null);
    setEditing(null);
    setEditDraft(null);
  };

  const openEditDatePicker = () => {
    if (!editDraft || saving) return;
    Keyboard.dismiss();
    setEditPickerDate(parseEditDate(editDraft.available_date));
    setEditDatePickerVisible(true);
  };

  const closeEditDatePicker = () => setEditDatePickerVisible(false);

  const commitEditDate = (value: Date) => {
    try {
      const nextDate = formatRecruitmentISODate(value);
      setEditPickerDate(parseEditDate(nextDate));
      setEditDraft((current) => current ? { ...current, available_date: nextDate } : current);
      closeEditDatePicker();
    } catch {
      setOperationError(copy.updateError);
    }
  };

  const handleEditDatePickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (event.type === "dismissed") {
      closeEditDatePicker();
      return;
    }
    if (!value) return;
    if (Platform.OS === "android") {
      commitEditDate(value);
      return;
    }
    setEditPickerDate(value);
  };

  const openEditTimePicker = (field: EditTimeField) => {
    if (!editDraft || saving) return;
    Keyboard.dismiss();
    const nextTime = parseEditTime(editDraft[field]);
    setEditDraftHour(nextTime.hour);
    setEditDraftMinute(nextTime.minute);
    setEditTimePickerField(field);
  };

  const commitEditTime = () => {
    if (!editTimePickerField) return;
    const value = `${String(editDraftHour).padStart(2, "0")}:${String(editDraftMinute).padStart(2, "0")}`;
    setEditDraft((current) => current ? { ...current, [editTimePickerField]: value } : current);
    setEditTimePickerField(null);
  };

  const saveEditing = async () => {
    if (!editing || !editDraft || saving || savingRef.current) return;
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || status !== "signed_in") {
      setOperationError(copy.updateLoginRequired);
      return;
    }

    const patch: RecruitmentUpdateRequest = {
      category: editDraft.category,
      available_date: editDraft.available_date.trim(),
      start_time: editDraft.start_time.trim(),
      end_time: editDraft.end_time.trim(),
      timezone: "Asia/Tokyo",
      keywords: editDraft.keywords.split(/[,、\n]/).map((item) => item.trim()).filter(Boolean),
      description: editDraft.description.trim(),
      location_name: editDraft.location_name.trim(),
      participant_limit: Number(editDraft.participant_limit),
      visibility_radius_km: editDraft.visibility_radius_km,
    };

    savingRef.current = true;
    setSaving(true);
    setOperationError(null);
    try {
      let result: Recruitment;
      try {
        result = await updateRecruitment(editing.id, activeSession, patch);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        result = await updateRecruitment(editing.id, refreshedSession, patch);
      }
      setRecruitments((current) => current.map((item) => item.id === result.id ? result : item));
      closeEditorAfterSave();
    } catch {
      setOperationError(copy.updateError);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const changeRecruitmentStatus = async (
    recruitment: Recruitment,
    nextStatus: Extract<RecruitmentStatus, "draft" | "open">,
  ) => {
    if (statusChangingRef.current || saving || recruitment.status === nextStatus) return;
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || status !== "signed_in") {
      setOperationError(copy.updateLoginRequired);
      return;
    }

    statusChangingRef.current = recruitment.id;
    setStatusChangingID(recruitment.id);
    setOperationError(null);
    try {
      let result: Recruitment;
      try {
        result = await updateRecruitment(recruitment.id, activeSession, { status: nextStatus });
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        result = await updateRecruitment(recruitment.id, refreshedSession, { status: nextStatus });
      }
      setRecruitments((current) => current.map((item) => item.id === result.id ? result : item));
    } catch {
      setOperationError(copy.updateError);
    } finally {
      statusChangingRef.current = null;
      setStatusChangingID(null);
    }
  };

  const publishDraft = (recruitment: Recruitment) => {
    if (recruitment.status !== "draft") return;
    void changeRecruitmentStatus(recruitment, "open");
  };

  const moveRecruitmentToDraft = (recruitment: Recruitment) => {
    if (recruitment.status !== "open") return;
    Alert.alert(
      copy.moveToDraftTitle,
      copy.moveToDraftMessage,
      [
        { text: copy.cancel, style: "cancel" },
        { text: copy.moveToDraft, onPress: () => void changeRecruitmentStatus(recruitment, "draft") },
      ],
    );
  };

  const closeOwnedRecruitment = (recruitment: Recruitment) => {
    if (!canClose(recruitment) || closingID || closingIDRef.current) return;
    Alert.alert(
      copy.closeTitle,
      copy.closeMessage,
      [
        { text: copy.cancel, style: "cancel" },
        {
          text: copy.close,
          style: "destructive",
          onPress: () => void performClose(recruitment),
        },
      ],
    );
  };

  const performClose = async (recruitment: Recruitment) => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || status !== "signed_in") return;
    if (closingIDRef.current) return;
    closingIDRef.current = recruitment.id;
    setClosingID(recruitment.id);
    setOperationError(null);
    try {
      try {
        await closeRecruitment(recruitment.id, activeSession);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        await closeRecruitment(recruitment.id, refreshedSession);
      }
      setRecruitments((current) => current.map((item) => item.id === recruitment.id
        ? { ...item, status: "closed", updated_at: new Date().toISOString() }
        : item
      ));
    } catch {
      setOperationError(copy.closeError);
    } finally {
      closingIDRef.current = null;
      setClosingID(null);
    }
  };

  const openApplication = (application: MatchView) => {
    router.push({
      pathname: "/foreigner/applications/[id]",
      params: { id: application.id, recruitmentId: application.recruitment.id },
    });
  };

  if (!language) {
    return <View style={styles.screen}><StatusBar style="dark" /><View style={styles.statePanel}><LoadingSpinner color={BLUE} size={28} /></View></View>;
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
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
          <MaterialIcons color={colors.text.onSky} name="chevron-left" size={30} />
        </Pressable>
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 120, 132) }]}
        refreshControl={
          <RefreshControl
            onRefresh={() => loadManagement()}
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
          {RECRUITMENT_FILTERS.map((filter) => {
            const selected = recruitmentFilter === filter;
            return (
              <Pressable
                key={filter}
                accessibilityLabel={copy.filters[filter]}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setRecruitmentFilter(filter)}
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
        {operationError ? <Text accessibilityRole="alert" style={styles.operationError}>{operationError}</Text> : null}

        {loadState === "loading" ? (
          <View style={styles.statePanel}>
            <LoadingSpinner color={BLUE} size={24} />
            <Text style={styles.stateText}>{copy.loading}</Text>
          </View>
        ) : loadState === "error" ? (
          <View style={styles.statePanel}>
            <Text accessibilityRole="alert" style={styles.stateText}>{loadError}</Text>
            <Pressable
              accessibilityLabel={copy.retry}
              accessibilityRole="button"
              onPress={loadManagement}
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
                  onPress={() => loadManagement()}
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.retryText}>{copy.retry}</Text>
                </Pressable>
              </View>
            ) : null}
            {recruitments.length === 0 ? (
              <View style={styles.statePanel}>
                <MaterialIcons color={MUTED_GRAY} name="post-add" size={38} />
                <Text style={styles.stateText}>{copy.empty}</Text>
              </View>
            ) : filteredRecruitments.length === 0 ? (
              <View style={styles.statePanel}>
                <MaterialIcons color={MUTED_GRAY} name="filter-list" size={38} />
                <Text style={styles.stateText}>{copy.noFilteredRecruitments}</Text>
              </View>
            ) : filteredRecruitments.map((recruitment) => {
          const ownedApplications = applicationsByRecruitment.get(recruitment.id) ?? [];
          const expired = isRecruitmentExpired(recruitment);
          const status = displayedRecruitmentStatus(recruitment);
          const closing = closingID === recruitment.id;
          const statusChanging = statusChangingID === recruitment.id;
          const editable = !expired && !statusChanging && canEdit(recruitment);
          const closable = !expired && !statusChanging && canClose(recruitment);
          return (
            <View key={recruitment.id} style={styles.recruitmentCard}>
              <View style={styles.recruitmentHeader}>
                <View style={styles.recruitmentTitleBlock}>
                  <Text style={styles.category}>{recruitment.category}</Text>
                  <Text style={styles.schedule}>
                    {recruitment.available_date} · {formatTimeRange(recruitment.start_time, recruitment.duration_hours)}
                  </Text>
                  <Text style={styles.schedule}>
                    {recruitment.location_name || "-"} · {recruitment.participant_limit}人
                  </Text>
                </View>
                <View style={[styles.statusPill, { borderColor: recruitmentStatusColor(status, colors) }]}>
                  <Text style={[styles.statusText, { color: recruitmentStatusColor(status, colors) }]}>
                    {copy.recruitmentStatus[status]}
                  </Text>
                </View>
              </View>

              <Text numberOfLines={3} style={styles.description}>{recruitment.description}</Text>
              <Text style={styles.keywords}>{copy.keywords}: {recruitment.keywords.join(" · ") || "—"}</Text>

              <View style={styles.recruitmentActions}>
                {editable ? (
                  <Pressable
                    accessibilityLabel={`${recruitment.category} ${copy.edit}`}
                    accessibilityRole="button"
                    onPress={() => startEditing(recruitment)}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                  >
                    <MaterialIcons color={BLUE} name="edit" size={17} />
                    <Text style={styles.secondaryButtonText}>{copy.edit}</Text>
                  </Pressable>
                ) : null}
                {recruitment.status === "draft" ? (
                  <Pressable
                    accessibilityLabel={statusChanging ? copy.publishing : `${recruitment.category} ${copy.publish}`}
                    accessibilityRole="button"
                    accessibilityState={{ busy: statusChanging, disabled: statusChanging }}
                    disabled={statusChanging}
                    onPress={() => publishDraft(recruitment)}
                    style={({ pressed }) => [styles.publishButton, statusChanging && styles.disabled, pressed && styles.pressed]}
                  >
                    {statusChanging ? <ActivityIndicator color={colors.text.onGold} size="small" /> : <MaterialIcons color={colors.text.onGold} name="publish" size={17} />}
                    <Text style={styles.publishButtonText}>{statusChanging ? copy.publishing : copy.publish}</Text>
                  </Pressable>
                ) : null}
                {recruitment.status === "open" ? (
                  <Pressable
                    accessibilityLabel={statusChanging ? copy.movingToDraft : `${recruitment.category} ${copy.moveToDraft}`}
                    accessibilityRole="button"
                    accessibilityState={{ busy: statusChanging, disabled: statusChanging }}
                    disabled={statusChanging}
                    onPress={() => moveRecruitmentToDraft(recruitment)}
                    style={({ pressed }) => [styles.pauseButton, statusChanging && styles.disabled, pressed && styles.pressed]}
                  >
                    {statusChanging ? <ActivityIndicator color={BLUE} size="small" /> : <MaterialIcons color={BLUE} name="pause-circle-outline" size={17} />}
                    <Text style={styles.pauseButtonText}>{statusChanging ? copy.movingToDraft : copy.moveToDraft}</Text>
                  </Pressable>
                ) : null}
                {closable ? (
                  <Pressable
                    accessibilityLabel={closing ? copy.ending : `${recruitment.category} ${copy.endPublic}`}
                    accessibilityRole="button"
                    accessibilityState={{ busy: closing, disabled: closing }}
                    disabled={closing}
                    onPress={() => closeOwnedRecruitment(recruitment)}
                    style={({ pressed }) => [styles.closeButton, closing && styles.disabled, pressed && styles.pressed]}
                  >
                    {closing ? <ActivityIndicator color={colors.state.danger} size="small" /> : null}
                    <Text style={styles.closeButtonText}>{closing ? copy.ending : copy.endPublic}</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.applicationsSection}>
                <Text style={styles.applicationsTitle}>
                  {copy.applicants} {ownedApplications.length > 0 ? `(${ownedApplications.length})` : ""}
                </Text>
                {ownedApplications.length === 0 ? (
                  <Text style={styles.noApplications}>{copy.noApplicants}</Text>
                ) : ownedApplications.map((application) => (
                  <Pressable
                    key={application.id}
                    accessibilityLabel={`${application.other_user.name || copy.userFallback} ${copy.review}`}
                    accessibilityRole="button"
                    onPress={() => openApplication(application)}
                    style={({ pressed }) => [styles.applicationRow, pressed && styles.pressed]}
                  >
                    <View style={styles.applicationAvatar}>
                      <MaterialIcons color={colors.border.muted} name="account-circle" size={32} />
                    </View>
                    <View style={styles.applicationText}>
                      <Text numberOfLines={1} style={styles.applicantName}>
                        {application.other_user.name || copy.userFallback}
                      </Text>
                      <Text style={styles.applicantMeta}>
                        {application.other_user.nationality_code || "—"} · {copy.matchStatus[application.status]}
                      </Text>
                    </View>
                    <Text style={[styles.applicationAction, { color: matchStatusColor(application.status, colors) }]}>
                      {application.status === "pending" ? copy.review : copy.state} ›
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
            })}
          </>
        )}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={closeEditor}
        transparent
        visible={Boolean(editing && editDraft)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
          style={styles.modalKeyboardAvoiding}
        >
          <DismissKeyboardView style={styles.modalBackdrop}>
            <ScrollView
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 24, paddingTop: insets.top + 16 }]}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.modalScrollView}
            >
              <View style={styles.editorPanel}>
              <View style={styles.editorHeader}>
                <Text style={styles.editorTitle}>{copy.editTitle}</Text>
                  <Pressable
                    accessibilityLabel={copy.closeEditor}
                    accessibilityRole="button"
                    disabled={saving}
                    onPress={() => {
                      Keyboard.dismiss();
                      closeEditor();
                    }}
                  style={({ pressed }) => [styles.closeIcon, pressed && styles.pressed]}
                >
                  <MaterialIcons color={TEXT_GRAY} name="close" size={22} />
                </Pressable>
              </View>

              {editDraft ? (
                <>
                  <Text style={styles.fieldLabel}>{copy.category}</Text>
                  <View style={styles.categoryChoices}>
                    {CATEGORIES.map((category) => (
                      <Pressable
                        key={category}
                        accessibilityLabel={`${category}を選択`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: editDraft.category === category }}
                        disabled={saving}
                        onPress={() => {
                          Keyboard.dismiss();
                          setEditDraft((current) => current ? { ...current, category } : current);
                        }}
                        style={({ pressed }) => [
                          styles.categoryChoice,
                          editDraft.category === category && styles.categoryChoiceSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.categoryChoiceText, editDraft.category === category && styles.categoryChoiceTextSelected]}>
                          {category}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>{copy.date}</Text>
                  <Pressable
                    accessibilityLabel={copy.dateInput}
                    accessibilityHint={copy.datePickerHint}
                    accessibilityRole="button"
                    disabled={saving}
                    onPress={openEditDatePicker}
                    style={({ pressed }) => [styles.textInput, styles.pickerInput, saving && styles.disabled, pressed && styles.pressed]}
                  >
                    <Text style={styles.pickerValue}>{editDraft.available_date}</Text>
                    <MaterialIcons color={colors.brand.sky} name="calendar-today" size={20} />
                  </Pressable>

                  <Text style={styles.fieldLabel}>{copy.location}</Text>
                  <TextInput
                    editable={!saving}
                    maxLength={120}
                    onChangeText={(location_name) => setEditDraft((current) => current ? { ...current, location_name } : current)}
                    placeholder="Tokyo Station"
                    style={styles.textInput}
                    value={editDraft.location_name}
                  />

                  <Text style={styles.fieldLabel}>{copy.people}</Text>
                  <TextInput
                    editable={!saving}
                    keyboardType="number-pad"
                    maxLength={2}
                    onChangeText={(participant_limit) => setEditDraft((current) => current ? { ...current, participant_limit } : current)}
                    placeholder="1"
                    style={styles.textInput}
                    value={editDraft.participant_limit}
                  />

                  <View style={styles.inlineFields}>
                    <View style={styles.inlineField}>
                      <Text style={styles.fieldLabel}>{copy.start}</Text>
                      <Pressable
                        accessibilityLabel={copy.startInput}
                        accessibilityRole="button"
                        disabled={saving}
                        onPress={() => openEditTimePicker("start_time")}
                        style={({ pressed }) => [styles.textInput, styles.pickerInput, saving && styles.disabled, pressed && styles.pressed]}
                      >
                        <MaterialIcons color={colors.brand.gold} name="access-time" size={18} />
                        <Text style={styles.pickerValue}>{editDraft.start_time}</Text>
                        <MaterialIcons color={colors.brand.gold} name="expand-more" size={20} />
                      </Pressable>
                    </View>
                    <View style={styles.inlineField}>
                      <Text style={styles.fieldLabel}>{copy.end}</Text>
                      <Pressable
                        accessibilityLabel={copy.endInput}
                        accessibilityRole="button"
                        disabled={saving}
                        onPress={() => openEditTimePicker("end_time")}
                        style={({ pressed }) => [styles.textInput, styles.pickerInput, saving && styles.disabled, pressed && styles.pressed]}
                      >
                        <MaterialIcons color={colors.brand.gold} name="access-time" size={18} />
                        <Text style={styles.pickerValue}>{editDraft.end_time}</Text>
                        <MaterialIcons color={colors.brand.gold} name="expand-more" size={20} />
                      </Pressable>
                    </View>
                  </View>

                  <Text style={styles.fieldLabel}>{copy.description}</Text>
                  <TextInput
                    accessibilityLabel={copy.descriptionInput}
                    editable={!saving}
                    multiline
                    onChangeText={(description) => setEditDraft((current) => current ? { ...current, description } : current)}
                    style={[styles.textInput, styles.descriptionInput]}
                    value={editDraft.description}
                  />

                  <Text style={styles.fieldLabel}>{copy.keywords}</Text>
                  <TextInput
                    accessibilityLabel={copy.keywordsInput}
                    editable={!saving}
                    onChangeText={(keywords) => setEditDraft((current) => current ? { ...current, keywords } : current)}
                    style={styles.textInput}
                    value={editDraft.keywords}
                  />

                  <Text style={styles.fieldLabel}>{copy.radius}</Text>
                  <View style={styles.radiusChoices}>
                    {([1, 3, 5] as const).map((radius) => (
                      <Pressable
                        key={radius}
                        accessibilityLabel={`${radius}kmを選択`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: editDraft.visibility_radius_km === radius }}
                        disabled={saving}
                        onPress={() => {
                          Keyboard.dismiss();
                          setEditDraft((current) => current ? { ...current, visibility_radius_km: radius } : current);
                        }}
                        style={({ pressed }) => [
                          styles.radiusChoice,
                          editDraft.visibility_radius_km === radius && styles.radiusChoiceSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.radiusText, editDraft.visibility_radius_km === radius && styles.radiusTextSelected]}>{radius}km</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.jstHint}>{copy.jstHint}</Text>
                  {operationError ? <Text accessibilityRole="alert" style={styles.operationError}>{operationError}</Text> : null}
                  <View style={styles.editorActions}>
                    <Pressable
                      accessibilityLabel={copy.cancel}
                      accessibilityRole="button"
                      disabled={saving}
                      onPress={() => {
                        Keyboard.dismiss();
                        closeEditor();
                      }}
                      style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.cancelText}>{copy.cancel}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={saving ? copy.saving : copy.save}
                      accessibilityRole="button"
                      accessibilityState={{ busy: saving, disabled: saving }}
                      disabled={saving}
                      onPress={() => {
                        Keyboard.dismiss();
                        void saveEditing();
                      }}
                      style={({ pressed }) => [styles.saveButton, saving && styles.disabled, pressed && styles.pressed]}
                    >
                      {saving ? <ActivityIndicator color={colors.text.onGold} size="small" /> : null}
                      <Text style={styles.saveText}>{saving ? copy.saving : copy.save}</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
              </View>
            </ScrollView>
          </DismissKeyboardView>
        </KeyboardAvoidingView>
      </Modal>

      {Platform.OS === "web" && editDatePickerVisible ? (
        <WebDatePicker
          cancelLabel={copy.pickerCancel}
          doneLabel={copy.pickerDone}
          label={copy.pickerDateTitle}
          onChange={commitEditDate}
          onDismiss={closeEditDatePicker}
          value={editPickerDate}
        />
      ) : Platform.OS !== "ios" && editDatePickerVisible ? (
        <DateTimePicker
          display="default"
          mode="date"
          onChange={handleEditDatePickerChange}
          onDismiss={closeEditDatePicker}
          timeZoneName={JST_TIME_ZONE}
          value={editPickerDate}
        />
      ) : null}

      {Platform.OS === "ios" ? (
        <Modal
          animationType="slide"
          onRequestClose={closeEditDatePicker}
          transparent
          visible={editDatePickerVisible}
        >
          <View style={styles.modalBackdrop}>
            <Pressable
              accessibilityLabel={copy.closeDatePicker}
              onPress={closeEditDatePicker}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={styles.pickerHeader}>
                <Pressable accessibilityRole="button" onPress={closeEditDatePicker} style={styles.pickerHeaderButton}>
                  <Text style={styles.pickerCancelText}>{copy.pickerCancel}</Text>
                </Pressable>
                <Text style={styles.pickerTitle}>{copy.pickerDateTitle}</Text>
                <Pressable accessibilityRole="button" onPress={() => commitEditDate(editPickerDate)} style={styles.pickerHeaderButton}>
                  <Text style={styles.pickerDoneText}>{copy.pickerDone}</Text>
                </Pressable>
              </View>
              <DateTimePicker
                accentColor={colors.brand.sky}
                display="spinner"
                locale={language === "en" ? "en-US" : "ja-JP"}
                mode="date"
                onChange={handleEditDatePickerChange}
                onDismiss={closeEditDatePicker}
                style={styles.nativePicker}
                themeVariant={scheme}
                timeZoneName={JST_TIME_ZONE}
                value={editPickerDate}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      <Modal
        animationType="slide"
        onRequestClose={() => setEditTimePickerField(null)}
        transparent
        visible={editTimePickerField !== null}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel={copy.closeTimePicker}
            onPress={() => setEditTimePickerField(null)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.pickerSheet, styles.timePickerSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.pickerHeader}>
              <Pressable accessibilityRole="button" onPress={() => setEditTimePickerField(null)} style={styles.pickerHeaderButton}>
                <Text style={styles.pickerCancelText}>{copy.pickerCancel}</Text>
              </Pressable>
              <Text style={styles.pickerTitle}>
                {editTimePickerField === "start_time" ? copy.start : copy.end}
              </Text>
              <Pressable accessibilityRole="button" onPress={commitEditTime} style={styles.pickerHeaderButton}>
                <Text style={styles.pickerDoneText}>{copy.pickerDone}</Text>
              </Pressable>
            </View>
            <View style={styles.wallClockPicker}>
              <ScrollView
                contentContainerStyle={styles.wallClockColumnContent}
                showsVerticalScrollIndicator={false}
                style={styles.wallClockColumn}
              >
                {TIME_PICKER_HOURS.map((hourValue) => {
                  const selected = editDraftHour === hourValue;
                  return (
                    <Pressable
                      key={hourValue}
                      accessibilityLabel={`${String(hourValue).padStart(2, "0")}:00`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setEditDraftHour(hourValue)}
                      style={({ pressed }) => [
                        styles.wallClockOption,
                        selected && styles.wallClockOptionSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.wallClockOptionText, selected && styles.wallClockOptionTextSelected]}>
                        {String(hourValue).padStart(2, "0")}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Text style={styles.wallClockSeparator}>:</Text>
              <ScrollView
                contentContainerStyle={styles.wallClockColumnContent}
                showsVerticalScrollIndicator={false}
                style={styles.wallClockColumn}
              >
                {TIME_PICKER_MINUTES.map((minuteValue) => {
                  const selected = editDraftMinute === minuteValue;
                  return (
                    <Pressable
                      key={minuteValue}
                      accessibilityLabel={`${minuteValue} minutes`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setEditDraftMinute(minuteValue)}
                      style={({ pressed }) => [
                        styles.wallClockOption,
                        selected && styles.wallClockOptionSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.wallClockOptionText, selected && styles.wallClockOptionTextSelected]}>
                        {String(minuteValue).padStart(2, "0")}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  header: {
    minHeight: 108,
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 18,
    backgroundColor: colors.brand.sky,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  backButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", marginRight: 12 },
  headerTitle: { color: colors.text.onSky, fontSize: 22, fontWeight: "800" },
  content: { alignItems: "center", paddingHorizontal: 18, paddingTop: 22, gap: 14 },
  intro: { alignSelf: "stretch", color: colors.text.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  filterScroll: { alignSelf: "stretch" },
  filterContent: { gap: 8, paddingHorizontal: 2 },
  filterButton: { minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border.default, borderRadius: 18, backgroundColor: colors.surface.default },
  filterButtonSelected: { borderColor: colors.brand.sky, backgroundColor: colors.surface.blueSoft },
  filterButtonText: { color: colors.text.secondary, fontSize: 13, fontWeight: "800" },
  filterButtonTextSelected: { color: colors.brand.sky },
  operationError: { alignSelf: "stretch", color: colors.state.danger, fontSize: 13, fontWeight: "700", lineHeight: 19, textAlign: "center" },
  statePanel: { minHeight: 180, width: "100%", alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 20 },
  inlineError: { width: "100%", alignItems: "center", gap: 8, paddingHorizontal: 20 },
  inlineErrorText: { color: colors.state.danger, fontSize: 13, fontWeight: "600", lineHeight: 19, textAlign: "center" },
  stateText: { color: colors.text.muted, fontSize: 14, fontWeight: "600", lineHeight: 20, textAlign: "center" },
  retryButton: { minWidth: 84, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.brand.gold },
  retryText: { color: colors.text.onGold, fontSize: 13, fontWeight: "800" },
  recruitmentCard: { width: "100%", maxWidth: 390, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.border.default, borderRadius: 18, backgroundColor: colors.surface.default },
  recruitmentHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  recruitmentTitleBlock: { flex: 1, gap: 5 },
  category: { color: colors.text.secondary, fontSize: 18, fontWeight: "800" },
  schedule: { color: colors.text.secondary, fontSize: 13, fontWeight: "700", lineHeight: 19 },
  statusPill: { minHeight: 28, alignItems: "center", justifyContent: "center", paddingHorizontal: 9, borderWidth: 1, borderRadius: 14 },
  statusText: { fontSize: 12, fontWeight: "800" },
  description: { color: colors.text.secondary, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  keywords: { color: colors.text.muted, fontSize: 12, lineHeight: 18 },
  recruitmentActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  secondaryButton: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.brand.sky, borderRadius: 20, backgroundColor: colors.surface.default },
  secondaryButtonText: { color: colors.brand.sky, fontSize: 13, fontWeight: "800" },
  publishButton: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.brand.gold },
  publishButtonText: { color: colors.text.onGold, fontSize: 13, fontWeight: "800" },
  pauseButton: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.brand.sky, borderRadius: 20, backgroundColor: colors.surface.blueSoft },
  pauseButtonText: { color: colors.brand.sky, fontSize: 13, fontWeight: "800" },
  closeButton: { minHeight: 40, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border.danger, borderRadius: 20, backgroundColor: colors.surface.dangerSoft },
  closeButtonText: { color: colors.state.danger, fontSize: 13, fontWeight: "800" },
  applicationsSection: { gap: 8, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border.subtle },
  applicationsTitle: { color: colors.text.secondary, fontSize: 15, fontWeight: "800" },
  noApplications: { color: colors.text.muted, fontSize: 12 },
  applicationRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.surface.blueSoft },
  applicationAvatar: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: colors.surface.default },
  applicationText: { flex: 1, gap: 3 },
  applicantName: { color: colors.text.secondary, fontSize: 14, fontWeight: "800" },
  applicantMeta: { color: colors.text.muted, fontSize: 12, fontWeight: "600" },
  applicationAction: { fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.72 },
  modalKeyboardAvoiding: { flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay.scrim },
  modalScrollView: { flex: 1 },
  modalContent: { flexGrow: 1, justifyContent: "flex-end" },
  editorPanel: { gap: 10, padding: 20, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.surface.default },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  editorTitle: { color: colors.text.secondary, fontSize: 20, fontWeight: "900" },
  closeIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  fieldLabel: { color: colors.text.secondary, fontSize: 13, fontWeight: "800" },
  categoryChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChoice: { minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border.default, borderRadius: 18, backgroundColor: colors.surface.default },
  categoryChoiceSelected: { borderColor: colors.brand.sky, backgroundColor: colors.surface.blueSoft },
  categoryChoiceText: { color: colors.text.secondary, fontSize: 13, fontWeight: "700" },
  categoryChoiceTextSelected: { color: colors.brand.sky },
  textInput: { minHeight: 44, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.border.default, borderRadius: 12, color: colors.text.secondary, backgroundColor: colors.surface.default, fontSize: 15 },
  pickerInput: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  pickerValue: { flex: 1, color: colors.text.secondary, fontSize: 15, fontWeight: "600" },
  descriptionInput: { minHeight: 82, paddingTop: 11, textAlignVertical: "top" },
  inlineFields: { flexDirection: "row", gap: 10 },
  inlineField: { flex: 1, gap: 10 },
  radiusChoices: { flexDirection: "row", gap: 8 },
  radiusChoice: { minWidth: 70, minHeight: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border.default, borderRadius: 18, backgroundColor: colors.surface.default },
  radiusChoiceSelected: { borderColor: colors.brand.gold, backgroundColor: colors.brand.gold },
  radiusText: { color: colors.text.secondary, fontSize: 13, fontWeight: "800" },
  radiusTextSelected: { color: colors.text.onGold },
  jstHint: { color: colors.text.muted, fontSize: 12, lineHeight: 18 },
  editorActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelButton: { minHeight: 46, flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border.default, borderRadius: 23, backgroundColor: colors.surface.default },
  cancelText: { color: colors.text.secondary, fontSize: 14, fontWeight: "800" },
  saveButton: { minHeight: 46, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 23, backgroundColor: colors.brand.gold },
  saveText: { color: colors.text.onGold, fontSize: 14, fontWeight: "900" },
  pickerSheet: { minHeight: 286, paddingTop: 8, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface.default },
  pickerHeader: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  pickerHeaderButton: { minWidth: 72, height: 40, alignItems: "center", justifyContent: "center" },
  pickerTitle: { flex: 1, color: colors.text.secondary, fontSize: 16, fontWeight: "900", textAlign: "center" },
  pickerCancelText: { color: colors.text.secondary, fontSize: 14, fontWeight: "700" },
  pickerDoneText: { color: colors.brand.sky, fontSize: 14, fontWeight: "900" },
  nativePicker: { alignSelf: "center", width: "100%", height: 216 },
  timePickerSheet: { minHeight: 342 },
  wallClockPicker: { height: 252, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  wallClockColumn: { width: 96, height: 224, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 18, backgroundColor: colors.surface.blueSoft },
  wallClockColumnContent: { paddingVertical: 8, gap: 6 },
  wallClockOption: { height: 38, alignItems: "center", justifyContent: "center", marginHorizontal: 8, borderRadius: 12 },
  wallClockOptionSelected: { backgroundColor: colors.brand.sky },
  wallClockOptionText: { color: colors.text.secondary, fontSize: 18, fontWeight: "800" },
  wallClockOptionTextSelected: { color: colors.text.inverse },
  wallClockSeparator: { width: 16, color: colors.text.secondary, fontSize: 28, fontWeight: "900", textAlign: "center" },
  });
}
