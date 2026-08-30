import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
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
import { useAuth } from "../../hooks/useAuth";
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
  type RecruitmentUpdateRequest,
} from "../../services/matching";
import { formatTimeRange } from "../../utils/time";
import { MATCH_CATEGORIES, type MatchCategory } from "../../types/match";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

const CATEGORIES = MATCH_CATEGORIES;

const COPY = {
  ja: {
    back: "戻る", title: "自分の募集を管理", intro: "公開中・下書き・終了した募集を確認できます。",
    loginRequired: "ログイン後に募集を管理できます。", loading: "募集を読み込み中…",
    loadError: "募集管理を読み込めませんでした。時間をおいて再試行してください。", retry: "再試行",
    empty: "自分の募集はまだありません。", updateLoginRequired: "ログイン後にもう一度お試しください。",
    updateError: "募集を更新できませんでした。日付・時刻と入力内容を確認してください。",
    closeTitle: "募集を終了しますか？", closeMessage: "公開停止後も履歴として残ります。", cancel: "キャンセル",
    close: "終了する", closeError: "募集を終了できませんでした。最新の状態を確認してください。",
    editing: "編集", edit: "編集", ending: "終了中…", endPublic: "公開を終了", applicants: "応募者",
    noApplicants: "まだ応募はありません。", userFallback: "ユーザー", review: "確認", state: "状態",
    editTitle: "募集を編集", closeEditor: "編集を閉じる", category: "カテゴリ", date: "日付（JST）",
    dateInput: "募集日付（JST）", start: "開始（JST）", startInput: "開始時刻（JST）", end: "終了（JST）",
    endInput: "終了時刻（JST）", description: "したいこと", descriptionInput: "募集内容",
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
    editing: "Edit", edit: "Edit", ending: "Closing…", endPublic: "Close recruitment", applicants: "Applicants",
    noApplicants: "There are no applications yet.", userFallback: "User", review: "Review", state: "Status",
    editTitle: "Edit recruitment", closeEditor: "Close editor", category: "Category", date: "Date (JST)",
    dateInput: "Recruitment date (JST)", start: "Start (JST)", startInput: "Start time (JST)", end: "End (JST)",
    endInput: "End time (JST)", description: "What would you like to do?", descriptionInput: "Recruitment details",
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

function matchesRecruitmentFilter(recruitment: Recruitment, filter: RecruitmentFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return recruitment.status === "open" || recruitment.status === "matched";
    case "draft":
      return recruitment.status === "draft";
    case "expired":
      return recruitment.status === "expired";
    case "closed":
      return recruitment.status === "closed" || recruitment.status === "completed";
  }
}

function recruitmentStatusColor(status: Recruitment["status"]): string {
  if (status === "open" || status === "matched") return "#168df0";
  if (status === "draft") return YELLOW;
  return MUTED_GRAY;
}

function matchStatusColor(status: MatchStatus): string {
  if (status === "accepted" || status === "completed") return "#168df0";
  if (status === "pending") return YELLOW;
  return MUTED_GRAY;
}

function canEdit(recruitment: Recruitment): boolean {
  return recruitment.status === "draft" || recruitment.status === "open";
}

function canClose(recruitment: Recruitment): boolean {
  return recruitment.status !== "closed"
    && recruitment.status !== "expired"
    && recruitment.status !== "completed";
}

export default function MyRecruitmentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
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
  const [saving, setSaving] = useState(false);
  const [closingID, setClosingID] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);
  const hasLoaded = useRef(false);
  const copy = COPY[language ?? "ja"];
	const copyRef = useRef(copy);
	copyRef.current = copy;

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

  const filteredRecruitments = useMemo(
    () => recruitments.filter((recruitment) => matchesRecruitmentFilter(recruitment, recruitmentFilter)),
    [recruitmentFilter, recruitments],
  );

  const startEditing = (recruitment: Recruitment) => {
    if (!canEdit(recruitment)) return;
    setOperationError(null);
    setEditing(recruitment);
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
    setEditing(null);
    setEditDraft(null);
  };

  const closeEditorAfterSave = () => {
    setEditing(null);
    setEditDraft(null);
  };

  const saveEditing = async () => {
    if (!editing || !editDraft || saving) return;
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
      setSaving(false);
    }
  };

  const closeOwnedRecruitment = (recruitment: Recruitment) => {
    if (!canClose(recruitment) || closingID) return;
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
    return <View style={styles.screen}><StatusBar style="light" /><View style={styles.statePanel}><ActivityIndicator color={BLUE} /></View></View>;
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 18) }]}>
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
            <ActivityIndicator color={BLUE} />
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
          const editable = canEdit(recruitment);
          const closable = canClose(recruitment);
          const closing = closingID === recruitment.id;
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
                <View style={[styles.statusPill, { borderColor: recruitmentStatusColor(recruitment.status) }]}>
                  <Text style={[styles.statusText, { color: recruitmentStatusColor(recruitment.status) }]}>
                    {copy.recruitmentStatus[recruitment.status]}
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
                {closable ? (
                  <Pressable
                    accessibilityLabel={closing ? copy.ending : `${recruitment.category} ${copy.endPublic}`}
                    accessibilityRole="button"
                    accessibilityState={{ busy: closing, disabled: closing }}
                    disabled={closing}
                    onPress={() => closeOwnedRecruitment(recruitment)}
                    style={({ pressed }) => [styles.closeButton, closing && styles.disabled, pressed && styles.pressed]}
                  >
                    {closing ? <ActivityIndicator color="#b42318" size="small" /> : null}
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
                      <MaterialIcons color="#d4d4d4" name="account-circle" size={32} />
                    </View>
                    <View style={styles.applicationText}>
                      <Text numberOfLines={1} style={styles.applicantName}>
                        {application.other_user.name || copy.userFallback}
                      </Text>
                      <Text style={styles.applicantMeta}>
                        {application.other_user.nationality_code || "—"} · {copy.matchStatus[application.status]}
                      </Text>
                    </View>
                    <Text style={[styles.applicationAction, { color: matchStatusColor(application.status) }]}>
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
                  <TextInput
                    accessibilityLabel={copy.dateInput}
                    editable={!saving}
                    onChangeText={(available_date) => setEditDraft((current) => current ? { ...current, available_date } : current)}
                    placeholder="YYYY-MM-DD"
                    style={styles.textInput}
                    value={editDraft.available_date}
                  />

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
                      <TextInput
                        accessibilityLabel={copy.startInput}
                        editable={!saving}
                        onChangeText={(start_time) => setEditDraft((current) => current ? { ...current, start_time } : current)}
                        placeholder="HH:mm"
                        style={styles.textInput}
                        value={editDraft.start_time}
                      />
                    </View>
                    <View style={styles.inlineField}>
                      <Text style={styles.fieldLabel}>{copy.end}</Text>
                      <TextInput
                        accessibilityLabel={copy.endInput}
                        editable={!saving}
                        onChangeText={(end_time) => setEditDraft((current) => current ? { ...current, end_time } : current)}
                        placeholder="HH:mm"
                        style={styles.textInput}
                        value={editDraft.end_time}
                      />
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
                      {saving ? <ActivityIndicator color="#ffffff" size="small" /> : null}
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
  backButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", marginRight: 12 },
  headerTitle: { color: "#ffffff", fontSize: 22, fontWeight: "800" },
  content: { alignItems: "center", paddingHorizontal: 18, paddingTop: 22, gap: 14 },
  intro: { alignSelf: "stretch", color: MUTED_GRAY, fontSize: 13, lineHeight: 19, textAlign: "center" },
  filterScroll: { alignSelf: "stretch" },
  filterContent: { gap: 8, paddingHorizontal: 2 },
  filterButton: { minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, borderWidth: 1, borderColor: BORDER_GRAY, borderRadius: 18, backgroundColor: "#ffffff" },
  filterButtonSelected: { borderColor: BLUE, backgroundColor: SOFT_BLUE },
  filterButtonText: { color: TEXT_GRAY, fontSize: 13, fontWeight: "800" },
  filterButtonTextSelected: { color: BLUE },
  operationError: { alignSelf: "stretch", color: "#b42318", fontSize: 13, fontWeight: "700", lineHeight: 19, textAlign: "center" },
  statePanel: { minHeight: 180, width: "100%", alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 20 },
  inlineError: { width: "100%", alignItems: "center", gap: 8, paddingHorizontal: 20 },
  inlineErrorText: { color: "#b42318", fontSize: 13, fontWeight: "600", lineHeight: 19, textAlign: "center" },
  stateText: { color: MUTED_GRAY, fontSize: 14, fontWeight: "600", lineHeight: 20, textAlign: "center" },
  retryButton: { minWidth: 84, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 18, backgroundColor: YELLOW },
  retryText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
  recruitmentCard: { width: "100%", maxWidth: 390, padding: 16, gap: 12, borderWidth: 1, borderColor: BORDER_GRAY, borderRadius: 18, backgroundColor: "#ffffff" },
  recruitmentHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  recruitmentTitleBlock: { flex: 1, gap: 5 },
  category: { color: TEXT_GRAY, fontSize: 18, fontWeight: "800" },
  schedule: { color: TEXT_GRAY, fontSize: 13, fontWeight: "700", lineHeight: 19 },
  statusPill: { minHeight: 28, alignItems: "center", justifyContent: "center", paddingHorizontal: 9, borderWidth: 1, borderRadius: 14 },
  statusText: { fontSize: 12, fontWeight: "800" },
  description: { color: TEXT_GRAY, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  keywords: { color: MUTED_GRAY, fontSize: 12, lineHeight: 18 },
  recruitmentActions: { flexDirection: "row", gap: 10 },
  secondaryButton: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 14, borderWidth: 1, borderColor: BLUE, borderRadius: 20, backgroundColor: "#ffffff" },
  secondaryButtonText: { color: BLUE, fontSize: 13, fontWeight: "800" },
  closeButton: { minHeight: 40, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: "#d9aaa5", borderRadius: 20, backgroundColor: "#fff8f7" },
  closeButtonText: { color: "#b42318", fontSize: 13, fontWeight: "800" },
  applicationsSection: { gap: 8, paddingTop: 4, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  applicationsTitle: { color: TEXT_GRAY, fontSize: 15, fontWeight: "800" },
  noApplications: { color: MUTED_GRAY, fontSize: 12 },
  applicationRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, borderRadius: 12, backgroundColor: SOFT_BLUE },
  applicationAvatar: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: "#ffffff" },
  applicationText: { flex: 1, gap: 3 },
  applicantName: { color: TEXT_GRAY, fontSize: 14, fontWeight: "800" },
  applicantMeta: { color: MUTED_GRAY, fontSize: 12, fontWeight: "600" },
  applicationAction: { fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.72 },
  modalKeyboardAvoiding: { flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.3)" },
  modalScrollView: { flex: 1 },
  modalContent: { flexGrow: 1, justifyContent: "flex-end" },
  editorPanel: { gap: 10, padding: 20, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "#ffffff" },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  editorTitle: { color: TEXT_GRAY, fontSize: 20, fontWeight: "900" },
  closeIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  fieldLabel: { color: TEXT_GRAY, fontSize: 13, fontWeight: "800" },
  categoryChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChoice: { minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: BORDER_GRAY, borderRadius: 18, backgroundColor: "#ffffff" },
  categoryChoiceSelected: { borderColor: BLUE, backgroundColor: SOFT_BLUE },
  categoryChoiceText: { color: TEXT_GRAY, fontSize: 13, fontWeight: "700" },
  categoryChoiceTextSelected: { color: BLUE },
  textInput: { minHeight: 44, paddingHorizontal: 13, borderWidth: 1, borderColor: BORDER_GRAY, borderRadius: 12, color: TEXT_GRAY, backgroundColor: "#ffffff", fontSize: 15 },
  descriptionInput: { minHeight: 82, paddingTop: 11, textAlignVertical: "top" },
  inlineFields: { flexDirection: "row", gap: 10 },
  inlineField: { flex: 1, gap: 10 },
  radiusChoices: { flexDirection: "row", gap: 8 },
  radiusChoice: { minWidth: 70, minHeight: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER_GRAY, borderRadius: 18, backgroundColor: "#ffffff" },
  radiusChoiceSelected: { borderColor: YELLOW, backgroundColor: YELLOW },
  radiusText: { color: TEXT_GRAY, fontSize: 13, fontWeight: "800" },
  radiusTextSelected: { color: "#ffffff" },
  jstHint: { color: MUTED_GRAY, fontSize: 12, lineHeight: 18 },
  editorActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelButton: { minHeight: 46, flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER_GRAY, borderRadius: 23, backgroundColor: "#ffffff" },
  cancelText: { color: TEXT_GRAY, fontSize: 14, fontWeight: "800" },
  saveButton: { minHeight: 46, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 23, backgroundColor: YELLOW },
  saveText: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
});
