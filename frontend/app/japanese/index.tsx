import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Keyboard,
  PanResponder,
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
import MatchCard from "../../components/MatchCard";
import { colors, LoadingSpinner } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { useDelayedLoading } from "../../hooks/useDelayedLoading";
import { useNavigationGuard } from "../../hooks/useNavigationGuard";
import { useUnreadNotifications } from "../../hooks/useUnreadNotifications";
import { APIError } from "../../services/api-client";
import { getCurrentCoordinatesResult } from "../../services/location";
import {
  type Coordinates,
  type Recruitment,
  listMatches,
  recruitmentToMatchCard,
  searchRecruitments,
  updateCurrentLocation,
} from "../../services/matching";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../../services/onboarding";
import { isMatchCategory, type MatchCardData } from "../../types/match";
import { getTabBarContentBottomPadding } from "../../utils/layout";

const BLUE = colors.brand.sky;
const YELLOW = colors.brand.gold;
const TEXT_GRAY = colors.text.secondary;
const PLACEHOLDER_GRAY = colors.text.muted;
const BORDER_GRAY = colors.border.default;
const SATURDAY_BLUE = "#0b70e0";
const SUNDAY_RED = "#e11919";
const DATE_SWIPE_THRESHOLD = 42;
const DATE_SWIPE_VERTICAL_LIMIT = 28;
const SEARCH_LOCATION_CACHE_TTL_MS = 60_000;

type SortMode = "near" | "deadline";
type DateButtonItem = {
  dateKey: string;
  weekdayIndex: number;
  label: string;
  weekdayLabel: string;
  isToday: boolean;
};

const COPY = {
  ja: {
    signInRequired: "ログイン後に募集を表示できます。",
    loadError: "募集を読み込めませんでした。時間をおいて再試行してください。",
    loading: "募集を読み込み中…",
    retry: "再試行",
    noRecruitments: "該当する募集がありません",
    search: "キーワードで検索",
    notifications: "通知",
    profile: "プロフィール",
    filters: "検索条件",
    resetSearch: "検索条件をリセット",
    locationRequired: "近くの募集を表示するには現在地の取得を許可してください。",
    allowLocation: "現在地の取得を許可する",
    today: "今日",
    weekdays: ["日", "月", "火", "水", "木", "金", "土"],
    date: (label: string, weekday: string) => `${label} ${weekday}`,
    nearest: "現在地から近い順",
    deadlineSoon: "募集締切が短い順",
    acceptedPlans: (count: number) => `今日の承認済み予定 ${count}件`,
  },
  en: {
    signInRequired: "Sign in to view recruitments.",
    loadError: "Recruitments could not be loaded. Please try again later.",
    loading: "Loading recruitments…",
    retry: "Retry",
    noRecruitments: "No matching recruitments found",
    search: "Search by keyword",
    notifications: "Notifications",
    profile: "Profile",
    filters: "Filters",
    resetSearch: "Reset search filters",
    locationRequired: "Allow location access to show nearby recruitments.",
    allowLocation: "Allow location access",
    today: "Today",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    date: (label: string, weekday: string) => `${label} ${weekday}`,
    nearest: "Nearest to current location",
    deadlineSoon: "Closing soon",
    acceptedPlans: (count: number) => `${count} accepted today`,
  },
} as const;

function jstDateParts(value: Date): { year: number; month: number; day: number; weekdayIndex: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    weekday: "short",
    year: "numeric",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const weekdayIndexes: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    weekdayIndex: weekdayIndexes[part("weekday")] ?? 0,
  };
}

function formatDateKey(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function todayDateKey(): string {
  return formatDateKey(jstDateParts(new Date()));
}

function addDaysToDateKey(dateKey: string, days: number): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return new Date();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12));
  return date;
}

function weekDateButtons(language: AppLanguage, startDateKey: string): DateButtonItem[] {
  const copy = COPY[language];
  const today = todayDateKey();

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToDateKey(startDateKey, index);
    const parts = jstDateParts(date);
    const dateKey = formatDateKey(parts);
    const isToday = dateKey === today;
    const weekdayLabel = copy.weekdays[parts.weekdayIndex] ?? "";

    return {
      dateKey,
      weekdayIndex: parts.weekdayIndex,
      label: isToday ? copy.today : String(parts.day),
      weekdayLabel,
      isToday,
    };
  });
}

function sortRecruitments(recruitments: Recruitment[], mode: SortMode): Recruitment[] {
  if (mode !== "deadline") return recruitments;
  return [...recruitments].sort((first, second) => {
    const firstTime = new Date(first.expires_at).getTime();
    const secondTime = new Date(second.expires_at).getTime();
    if (Number.isNaN(firstTime) && Number.isNaN(secondTime)) return 0;
    if (Number.isNaN(firstTime)) return 1;
    if (Number.isNaN(secondTime)) return -1;
    return firstTime - secondTime;
  });
}

export default function JapaneseHomeScreen() {
  const router = useRouter();
  const { push } = useNavigationGuard();
  const params = useLocalSearchParams<{ query?: string; date?: string; sort?: string; category?: string; time?: string; radius?: string; availableFrom?: string; availableTo?: string }>();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const hasUnreadNotifications = useUnreadNotifications();
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [query, setQuery] = useState(params.query ?? "");
  const [submittedQuery, setSubmittedQuery] = useState(params.query ?? "");
  const [recruitments, setRecruitments] = useState<Recruitment[]>([]);
  const [applicationStatuses, setApplicationStatuses] = useState<Record<string, NonNullable<MatchCardData["applicationStatus"]>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locationUnavailable, setLocationUnavailable] = useState(false);
  const initialLoadStarted = useRef(false);
  const searchRequestIDRef = useRef(0);
  const activeSearchRequestRef = useRef<{
    id: number;
    controller: AbortController;
    cancelled: boolean;
  } | null>(null);
  const mountedRef = useRef(true);
  const locationCacheRef = useRef<{ coordinates: Coordinates; cachedAt: number } | null>(null);
  const [selectedDate, setSelectedDate] = useState(params.date ?? todayDateKey);
  const [sortMode, setSortMode] = useState<SortMode>(params.sort === "deadline" ? "deadline" : "near");
  const [todayPlanCount, setTodayPlanCount] = useState(0);
  const selectedCategory = isMatchCategory(params.category) ? params.category : undefined;
  const selectedTime = params.time === "morning" || params.time === "afternoon" || params.time === "evening" ? params.time : undefined;
  const selectedRadius: 1 | 3 | 5 = params.radius === "1" ? 1 : params.radius === "5" ? 5 : 3;
  const verifiedOnly = false;
  const hasDateRange = Boolean(params.availableFrom || params.availableTo);
  const hasActiveFilters = Boolean(
    selectedCategory || selectedTime || params.availableFrom || params.availableTo || selectedRadius !== 3
  );
  const hasSearchConditions = Boolean(
    query.trim() || submittedQuery.trim() || hasActiveFilters || sortMode !== "near" || selectedDate !== todayDateKey()
  );

  const resetSearchConditions = useCallback(() => {
    Keyboard.dismiss();
    const today = todayDateKey();
    setQuery("");
    setSubmittedQuery("");
    setSelectedDate(today);
    setSortMode("near");
    router.setParams({
      query: "",
      date: today,
      sort: "near",
      category: "",
      time: "",
      radius: "3",
      availableFrom: "",
      availableTo: "",
    });
  }, [router]);

  const searchSignature = useMemo(() => [
    submittedQuery.trim(),
    hasDateRange ? "" : selectedDate,
    selectedCategory ?? "",
    selectedTime ?? "",
    selectedRadius,
    params.availableFrom ?? "",
    params.availableTo ?? "",
  ].join("\u001f"), [
    params.availableFrom,
    params.availableTo,
    hasDateRange,
    selectedCategory,
    selectedDate,
    selectedRadius,
    selectedTime,
    submittedQuery,
  ]);
  const timeRange = useMemo(() => selectedTime === "morning" ? { startTime: "06:00", endTime: "12:00" }
    : selectedTime === "afternoon" ? { startTime: "12:00", endTime: "18:00" }
      : selectedTime === "evening" ? { startTime: "18:00", endTime: "23:59" }
        : {}, [selectedTime]);
  const copy = COPY[language ?? "ja"];
  const matches = useMemo(() => sortRecruitments(recruitments, sortMode).map((item) => ({
    ...recruitmentToMatchCard(item),
    applicationStatus: applicationStatuses[item.id],
  })), [applicationStatuses, recruitments, sortMode]);
  const showLanguageLoading = useDelayedLoading(!language);
  const showInitialLoading = useDelayedLoading(loading && matches.length === 0);
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const dateButtons = useMemo(
    () => weekDateButtons(language ?? "ja", todayDateKey()),
    [language],
  );
  const selectedDateIndex = useMemo(
    () => dateButtons.findIndex((item) => item.dateKey === selectedDate),
    [dateButtons, selectedDate],
  );
  const previousSearchSignature = useRef(searchSignature);
  const filteredMatches = useMemo(() => {
    const normalizedQuery = submittedQuery.trim().toLocaleLowerCase();

    return matches.filter((match) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        match.authorName.toLocaleLowerCase().includes(normalizedQuery) ||
        match.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedQuery));

      return matchesQuery;
    });
  }, [matches, submittedQuery]);
  const actionTop = Math.max(insets.top + 8, 45);
  const dateTop = actionTop + 72;
  const sortTop = dateTop + (hasDateRange ? 0 : 76);
  const headerHeight = Math.max(hasDateRange ? 184 : 246, sortTop + 58);

  const loadRecruitments = useCallback((mode: "initial" | "refresh" = "refresh") => {
    const previousRequest = activeSearchRequestRef.current;
    if (previousRequest) {
      previousRequest.cancelled = true;
      previousRequest.controller.abort();
    }
    const requestId = searchRequestIDRef.current + 1;
    searchRequestIDRef.current = requestId;
    const controller = new AbortController();
    const request = { id: requestId, controller, cancelled: false };
    activeSearchRequestRef.current = request;
    const isCurrentRequest = () =>
      mountedRef.current && searchRequestIDRef.current === requestId && !request.cancelled && !controller.signal.aborted;
    const releaseRequest = () => {
      if (activeSearchRequestRef.current?.id === requestId) {
        activeSearchRequestRef.current = null;
      }
    };

    setRecruitments([]);
    setApplicationStatuses({});
    setTodayPlanCount(0);
    setLoading(true);
    setRefreshing(mode !== "initial");
    setLoadError(null);
    setLocationUnavailable(false);

    const run = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (status !== "signed_in" || !activeSession) {
        if (isCurrentRequest()) {
          setRecruitments([]);
          setApplicationStatuses({});
          setTodayPlanCount(0);
          setLoading(false);
          setRefreshing(false);
          setLoadError(copyRef.current.signInRequired);
        }
        releaseRequest();
        return;
      }

      try {
        const cachedLocation = locationCacheRef.current;
        const locationIsFresh = Boolean(
          cachedLocation && Date.now() - cachedLocation.cachedAt < SEARCH_LOCATION_CACHE_TTL_MS,
        );
        let coordinates = locationIsFresh ? cachedLocation?.coordinates ?? null : null;
        if (!coordinates) {
          const currentLocation = await getCurrentCoordinatesResult();
          if (!currentLocation.available) {
            if (isCurrentRequest()) {
              setRecruitments([]);
              setApplicationStatuses({});
              setTodayPlanCount(0);
              setLocationUnavailable(true);
              setLoading(false);
              setRefreshing(false);
            }
            releaseRequest();
            return;
          }
          coordinates = currentLocation.value;
          locationCacheRef.current = { coordinates, cachedAt: Date.now() };
        }

        const searchParams = {
          keywords: submittedQuery ? [submittedQuery] : [],
          category: selectedCategory,
          availableDate: params.availableFrom || params.availableTo ? undefined : selectedDate,
          availableFrom: params.availableFrom,
          availableTo: params.availableTo,
          ...timeRange,
          radiusKm: selectedRadius,
          latitude: coordinates?.latitude,
          longitude: coordinates?.longitude,
          limit: 50,
        };
        const requestSearch = (currentSession: NonNullable<typeof activeSession>) =>
          searchRecruitments(currentSession, searchParams, controller.signal);
        let searchSession = activeSession;
        let result: Recruitment[];
        try {
          result = await requestSearch(searchSession);
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 401) throw error;
          await refresh();
          const refreshedSession = getCurrentSession();
          if (!refreshedSession) throw error;
          searchSession = refreshedSession;
          result = await requestSearch(searchSession);
        }
        if (!isCurrentRequest()) return;

        void updateCurrentLocation(coordinates, searchSession, controller.signal).catch(() => undefined);

        setRecruitments(result);
        setApplicationStatuses({});
        setTodayPlanCount(0);
        setLoading(false);
        setRefreshing(false);

        void (async () => {
          let applicationResult;
          try {
            applicationResult = await listMatches(searchSession, { role: "requester", limit: 50 }, controller.signal);
          } catch (error) {
            if (!(error instanceof APIError) || error.status !== 401) return;
            try {
              await refresh();
              const refreshedSession = getCurrentSession();
              if (!refreshedSession) return;
              applicationResult = await listMatches(refreshedSession, { role: "requester", limit: 50 }, controller.signal);
            } catch {
              return;
            }
          }
          if (!isCurrentRequest()) return;
          const nextStatuses: Record<string, NonNullable<MatchCardData["applicationStatus"]>> = {};
          for (const item of applicationResult) nextStatuses[item.recruitment.id] = item.status;
          setApplicationStatuses(nextStatuses);
          setTodayPlanCount(applicationResult.filter((item) => item.status === "accepted" && item.recruitment.available_date === todayDateKey()).length);
        })();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError" && (request.cancelled || controller.signal.aborted)) return;
        if (isCurrentRequest()) {
          setLoadError(copyRef.current.loadError);
        }
      } finally {
        if (isCurrentRequest()) {
          setLoading(false);
          setRefreshing(false);
        }
        releaseRequest();
      }
    };

    void run();
    return () => {
      request.cancelled = true;
      controller.abort();
      releaseRequest();
    };
  }, [getCurrentSession, params.availableFrom, params.availableTo, refresh, selectedCategory, selectedDate, selectedRadius, session, status, submittedQuery, timeRange]);

  useEffect(() => () => {
    mountedRef.current = false;
    const activeRequest = activeSearchRequestRef.current;
    if (!activeRequest) return;
    activeRequest.cancelled = true;
    activeRequest.controller.abort();
    activeSearchRequestRef.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active && nextLanguage) setLanguage(nextLanguage);
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

  const loadRecruitmentsRef = useRef(loadRecruitments);
  loadRecruitmentsRef.current = loadRecruitments;

  useEffect(() => {
    if (status === "loading") return;

    if (status !== "signed_in") {
      initialLoadStarted.current = false;
      previousSearchSignature.current = searchSignature;
      return loadRecruitmentsRef.current("initial");
    }

    if (!initialLoadStarted.current) {
      initialLoadStarted.current = true;
      previousSearchSignature.current = searchSignature;
      return loadRecruitmentsRef.current("initial");
    }

    if (previousSearchSignature.current === searchSignature) return;
    previousSearchSignature.current = searchSignature;
    return loadRecruitmentsRef.current("refresh");
  }, [searchSignature, status]);

  const moveSelectedDate = useCallback((offset: -1 | 1) => {
    if (hasDateRange) return;
    const currentIndex = selectedDateIndex < 0 ? 0 : selectedDateIndex;
    const next = dateButtons[currentIndex + offset];
    if (!next) return;
    Keyboard.dismiss();
    setSelectedDate(next.dateKey);
  }, [dateButtons, hasDateRange, selectedDateIndex]);

  const dateSwipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dx) > DATE_SWIPE_THRESHOLD &&
      Math.abs(gesture.dy) < DATE_SWIPE_VERTICAL_LIMIT,
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx <= -DATE_SWIPE_THRESHOLD) {
        moveSelectedDate(1);
      } else if (gesture.dx >= DATE_SWIPE_THRESHOLD) {
        moveSelectedDate(-1);
      }
    },
    onPanResponderTerminationRequest: () => true,
  }), [moveSelectedDate]);

  const openMatch = (match: MatchCardData) => {
    push({
      pathname: "/japanese/matches/[id]",
      params: { id: match.id },
    });
  };

  if (!language) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        {showLanguageLoading ? <LoadingSpinner color={BLUE} size={28} speedMs={680} /> : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <ScrollView
        alwaysBounceVertical
        bounces
        contentContainerStyle={[
          styles.matchListContent,
          {
            paddingTop: headerHeight + 28,
            paddingBottom: getTabBarContentBottomPadding(insets.bottom),
          },
        ]}
        refreshControl={
          <RefreshControl
            onRefresh={() => { void loadRecruitments("refresh"); }}
            refreshing={refreshing}
            tintColor={BLUE}
          />
        }
        showsVerticalScrollIndicator={false}
        style={styles.matchList}
        nestedScrollEnabled
        {...dateSwipeResponder.panHandlers}
      >
        {todayPlanCount > 0 ? (
          <Pressable onPress={() => push("/plans")} style={styles.planShortcut}>
            <MaterialIcons color={BLUE} name="event-available" size={21} />
            <Text style={styles.planShortcutText}>{copy.acceptedPlans(todayPlanCount)}</Text>
            <MaterialIcons color={BLUE} name="chevron-right" size={22} />
          </Pressable>
        ) : null}
        {loading && matches.length === 0 ? (
          showInitialLoading ? (
            <View style={styles.statePanel}>
              <LoadingSpinner color={BLUE} size={24} speedMs={680} />
              <Text style={styles.stateText}>{copy.loading}</Text>
            </View>
          ) : null
        ) : locationUnavailable && matches.length === 0 ? (
          <View style={styles.statePanel}>
            <Text accessibilityRole="alert" style={styles.stateText}>{copy.locationRequired}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => loadRecruitments("initial")}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryButtonText}>{copy.allowLocation}</Text>
            </Pressable>
          </View>
        ) : loadError && matches.length === 0 ? (
          <View style={styles.statePanel}>
            <Text accessibilityRole="alert" style={styles.stateText}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => loadRecruitments("initial")}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {loadError ? (
              <View style={styles.inlineError}>
                <Text accessibilityRole="alert" style={styles.inlineErrorText}>{loadError}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => loadRecruitments("refresh")}
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.retryButtonText}>{copy.retry}</Text>
                </Pressable>
              </View>
            ) : null}
            {filteredMatches.map((match) => (
              <MatchCard key={match.id} language={language ?? "ja"} match={match} onOpen={openMatch} />
            ))}
          </>
        )}

        {!loading && !loadError && !locationUnavailable && filteredMatches.length === 0 && (
          <Text style={styles.emptyText}>{copy.noRecruitments}</Text>
        )}
      </ScrollView>

      <View pointerEvents="box-none" style={[styles.header, { height: headerHeight }]}>
        <View pointerEvents="box-none" style={[styles.actionRow, { top: actionTop }]}>
          <View style={styles.searchField}>
            <MaterialIcons
              color={PLACEHOLDER_GRAY}
              name="search"
              size={24}
              style={styles.searchIcon}
            />
              <TextInput
                accessibilityLabel={copy.search}
              onChangeText={setQuery}
              onSubmitEditing={() => {
                Keyboard.dismiss();
                setSubmittedQuery(query.trim());
              }}
              placeholder={copy.search}
              placeholderTextColor={PLACEHOLDER_GRAY}
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
              />
              {hasSearchConditions ? (
                <Pressable
                  accessibilityLabel={copy.resetSearch}
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={resetSearchConditions}
                  style={({ pressed }) => [styles.resetSearchButton, pressed && styles.pressed]}
                >
                  <MaterialIcons color={BLUE} name="refresh" size={20} />
                </Pressable>
              ) : null}
              <Pressable
              accessibilityLabel={copy.filters}
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => push({
                pathname: "/japanese/filters",
                params: {
                  ...(submittedQuery ? { query: submittedQuery } : {}),
                  date: selectedDate,
                  sort: sortMode,
                  ...(selectedCategory ? { category: selectedCategory } : {}),
                  ...(selectedTime ? { time: selectedTime } : {}),
                  ...(params.availableFrom ? { availableFrom: params.availableFrom } : {}),
                  ...(params.availableTo ? { availableTo: params.availableTo } : {}),
                  radius: String(selectedRadius),
                },
              })}
              style={styles.filterButton}
            >
              <MaterialIcons color={hasActiveFilters ? BLUE : PLACEHOLDER_GRAY} name="tune" size={21} />
            </Pressable>
          </View>

          <Pressable
            accessibilityLabel={copy.notifications}
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => push("/japanese/notifications")}
            style={({ pressed }) => [
              styles.headerIconButton,
              styles.notificationButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons color="#ffffff" name="notifications-none" size={32} />
            {hasUnreadNotifications ? <View style={styles.notificationBadge} /> : null}
          </Pressable>

          <Pressable
            accessibilityLabel={copy.profile}
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => push("/profile")}
            style={({ pressed }) => [
              styles.headerIconButton,
              styles.profileButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons color="#ffffff" name="account-circle" size={34} />
          </Pressable>
        </View>

        {!hasDateRange ? (
          <ScrollView
            contentContainerStyle={styles.dateContent}
            horizontal
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            style={[styles.dateList, { top: dateTop }]}
          >
            {dateButtons.map((item) => {
              const selected = selectedDate === item.dateKey;
              const weekendStyle =
                item.weekdayIndex === 0
                  ? styles.sundayText
                  : item.weekdayIndex === 6
                    ? styles.saturdayText
                    : null;

              return (
                <Pressable
                  key={item.dateKey}
                  accessibilityLabel={copy.date(item.label, item.weekdayLabel)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    Keyboard.dismiss();
                    setSelectedDate(item.dateKey);
                  }}
                  style={({ pressed }) => [
                    styles.dateButton,
                    item.isToday && styles.todayButton,
                    selected && !item.isToday && styles.dateButtonSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text numberOfLines={1} style={styles.dateLabel}>
                    {item.label}
                  </Text>
                  <Text numberOfLines={1} style={[styles.weekdayLabel, weekendStyle]}>
                    {item.weekdayLabel}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <Pressable
          accessibilityLabel={sortMode === "near" ? copy.nearest : copy.deadlineSoon}
          accessibilityRole="button"
          onPress={() => setSortMode((current) => current === "near" ? "deadline" : "near")}
          style={({ pressed }) => [
            styles.sortRow,
            { top: sortTop },
            pressed && styles.pressed,
          ]}
        >
          <MaterialIcons color={TEXT_GRAY} name="swap-vert" size={28} />
          <Text style={styles.sortText}>{sortMode === "near" ? copy.nearest : copy.deadlineSoon}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  matchList: {
    flex: 1,
  },
  matchListContent: {
    minHeight: "100%",
    paddingTop: 221,
    paddingBottom: 32,
    alignItems: "center",
    gap: 28,
  },
  planShortcut: {
    width: 307,
    maxWidth: "78.72%",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#eff8ff",
  },
  planShortcutText: {
    flex: 1,
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "800",
  },
  header: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    height: 193,
    overflow: "hidden",
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: BLUE,
  },
  actionRow: {
    position: "absolute",
    top: 45,
    right: 19,
    left: 19,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  searchField: {
    flex: 1,
    height: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 22,
    backgroundColor: "#ffffff",
  },
  searchIcon: {
    position: "absolute",
    left: 15,
  },
  searchInput: {
    width: "100%",
    height: 44,
    paddingTop: 0,
    paddingRight: 84,
    paddingBottom: 0,
    paddingLeft: 48,
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "400",
    letterSpacing: 0,
  },
  filterButton: {
    position: "absolute",
    right: 5,
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  resetSearchButton: {
    position: "absolute",
    right: 43,
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  notificationButton: {
    width: 44,
  },
  notificationBadge: {
    position: "absolute",
    top: 1,
    right: 0,
    width: 8,
    height: 8,
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 4,
    backgroundColor: YELLOW,
  },
  profileButton: {
    width: 44,
  },
  dateList: {
    position: "absolute",
    top: 90,
    right: 0,
    left: 0,
    height: 62,
  },
  dateContent: {
    paddingLeft: 20,
    paddingRight: 20,
    gap: 14,
  },
  dateButton: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  todayButton: {
    borderColor: YELLOW,
    backgroundColor: YELLOW,
  },
  dateButtonSelected: {
    borderColor: YELLOW,
    borderWidth: 2,
  },
  dateLabel: {
    color: "#000000",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 15,
    textAlign: "center",
  },
  weekdayLabel: {
    color: "#000000",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 15,
    textAlign: "center",
  },
  saturdayText: {
    color: SATURDAY_BLUE,
  },
  sundayText: {
    color: SUNDAY_RED,
  },
  sortRow: {
    position: "absolute",
    top: 146,
    left: 19,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 16,
  },
  sortText: {
    color: TEXT_GRAY,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 20,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  emptyText: {
    marginTop: 40,
    color: PLACEHOLDER_GRAY,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 18,
  },
  statePanel: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 12,
  },
  inlineError: {
    width: "100%",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
  },
  inlineErrorText: {
    color: "#b42318",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
  stateText: {
    color: PLACEHOLDER_GRAY,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
  retryButton: {
    minWidth: 78,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: YELLOW,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.72,
  },
});
