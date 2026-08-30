import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
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
import { useAuth } from "../../hooks/useAuth";
import { useUnreadNotifications } from "../../hooks/useUnreadNotifications";
import { APIError } from "../../services/api-client";
import { getCurrentCoordinates } from "../../services/location";
import {
  recruitmentToMatchCard,
  searchRecruitments,
  updateCurrentLocation,
} from "../../services/matching";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../../services/onboarding";
import type { MatchCardData } from "../../types/match";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const PLACEHOLDER_GRAY = "#949494";
const BORDER_GRAY = "#d4d4d4";

const COPY = {
  ja: {
    all: "すべて",
    signInRequired: "ログイン後に募集を表示できます。",
    loadError: "募集を読み込めませんでした。時間をおいて再試行してください。",
    loading: "募集を読み込み中…",
    retry: "再試行",
    noRecruitments: "該当する募集がありません",
    search: "キーワードで検索",
    notifications: "通知",
    profile: "プロフィール",
    category: (category: string) => `${category}カテゴリ`,
    nearest: "現在地から近い順",
  },
  en: {
    all: "All",
    signInRequired: "Sign in to view recruitments.",
    loadError: "Recruitments could not be loaded. Please try again later.",
    loading: "Loading recruitments…",
    retry: "Retry",
    noRecruitments: "No matching recruitments found",
    search: "Search by keyword",
    notifications: "Notifications",
    profile: "Profile",
    category: (category: string) => `${category} category`,
    nearest: "Nearest to current location",
  },
} as const;

const CATEGORIES = [
  "all",
  "Food",
  "Places",
  "Activity",
  "Other",
] as const;

export default function JapaneseHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const hasUnreadNotifications = useUnreadNotifications();
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [matches, setMatches] = useState<MatchCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);
  const hasLoaded = useRef(false);
  const [selectedCategory, setSelectedCategory] = useState<(typeof CATEGORIES)[number]>(
    "all",
  );
  const copy = COPY[language ?? "ja"];
	const copyRef = useRef(copy);
	copyRef.current = copy;
  const filteredMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return matches.filter((match) => {
      const matchesCategory =
        selectedCategory === "all" ||
        match.category === selectedCategory;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        match.authorName.toLocaleLowerCase().includes(normalizedQuery) ||
        match.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedQuery));

      return matchesCategory && matchesQuery;
    });
  }, [matches, query, selectedCategory]);
  const actionTop = Math.max(insets.top + 8, 45);
  const categoryTop = actionTop + 45;
  const sortTop = categoryTop + 56;
  const headerHeight = Math.max(193, sortTop + 47);

  const loadRecruitments = useCallback(() => {
    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
			setLoadError(copyRef.current.signInRequired);
        }
        return;
      }

      const initialLoad = !hasLoaded.current;
      if (initialLoad) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setLoadError(null);
      try {
        let coordinates = null;
        try {
          coordinates = await getCurrentCoordinates();
        } catch {
          coordinates = null;
        }
        if (coordinates) {
          await updateCurrentLocation(coordinates, activeSession, controller.signal).catch(() => undefined);
        }

        let result;
        try {
          result = await searchRecruitments(
            activeSession,
            {
              keywords: submittedQuery ? [submittedQuery] : [],
              latitude: coordinates?.latitude,
              longitude: coordinates?.longitude,
              limit: 50,
            },
            controller.signal,
          );
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 401) throw error;
          await refresh();
          const refreshedSession = getCurrentSession();
          if (!refreshedSession) throw error;
          result = await searchRecruitments(
            refreshedSession,
            {
              keywords: submittedQuery ? [submittedQuery] : [],
              latitude: coordinates?.latitude,
              longitude: coordinates?.longitude,
              limit: 50,
            },
            controller.signal,
          );
        }
        if (!cancelled) {
          setMatches(result.map(recruitmentToMatchCard));
          hasLoaded.current = true;
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError" && (cancelled || controller.signal.aborted)) return;
        if (!cancelled) {
			setLoadError(copyRef.current.loadError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
	}, [getCurrentSession, refresh, session, status, submittedQuery]);

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
    if (initialLoadStarted.current || status === "loading") return;
    initialLoadStarted.current = true;
    return loadRecruitmentsRef.current();
  }, [status]);

  const openMatch = (match: MatchCardData) => {
    router.push({
      pathname: "/japanese/matches/[id]",
      params: { id: match.id },
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

      <ScrollView
        contentContainerStyle={[
          styles.matchListContent,
          { paddingTop: headerHeight + 28 },
        ]}
        refreshControl={
          <RefreshControl
            onRefresh={() => loadRecruitments()}
            refreshing={refreshing}
            tintColor={BLUE}
          />
        }
        showsVerticalScrollIndicator={false}
        style={styles.matchList}
      >
        {loading ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color={BLUE} size="small" />
            <Text style={styles.stateText}>{copy.loading}</Text>
          </View>
        ) : loadError && matches.length === 0 ? (
          <View style={styles.statePanel}>
            <Text accessibilityRole="alert" style={styles.stateText}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={loadRecruitments}
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
                  onPress={() => loadRecruitments()}
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.retryButtonText}>{copy.retry}</Text>
                </Pressable>
              </View>
            ) : null}
            {filteredMatches.map((match) => (
              <MatchCard key={match.id} match={match} onOpen={openMatch} />
            ))}
          </>
        )}

        {!loading && !loadError && filteredMatches.length === 0 && (
          <Text style={styles.emptyText}>{copy.noRecruitments}</Text>
        )}
      </ScrollView>

      <View style={[styles.header, { height: headerHeight }]}>
        <View style={[styles.actionRow, { top: actionTop }]}>
          <View style={styles.searchField}>
            <MaterialIcons
              color={PLACEHOLDER_GRAY}
              name="search"
              size={22}
              style={styles.searchIcon}
            />
            <TextInput
              accessibilityLabel={copy.search}
              onChangeText={setQuery}
              onSubmitEditing={() => setSubmittedQuery(query.trim())}
              placeholder={copy.search}
              placeholderTextColor={PLACEHOLDER_GRAY}
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />
          </View>

          <Pressable
            accessibilityLabel={copy.notifications}
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => router.push("/japanese/notifications")}
            style={({ pressed }) => [
              styles.headerIconButton,
              styles.notificationButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons color="#ffffff" name="notifications-none" size={30} />
            {hasUnreadNotifications ? <View style={styles.notificationBadge} /> : null}
          </Pressable>

          <Pressable
            accessibilityLabel={copy.profile}
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => router.push("/profile")}
            style={({ pressed }) => [
              styles.headerIconButton,
              styles.profileButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons color="#ffffff" name="account-circle" size={30} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.categoryContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.categoryList, { top: categoryTop }]}
        >
          {CATEGORIES.map((category) => {
            const selected = selectedCategory === category;

            return (
              <Pressable
                key={category}
                accessibilityLabel={copy.category(category === "all" ? copy.all : category)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSelectedCategory(category)}
                style={({ pressed }) => [
                  styles.categoryButton,
                  selected && styles.categoryButtonSelected,
                  pressed && styles.pressed,
                ]}
              />
            );
          })}
        </ScrollView>

        <Pressable
          accessibilityLabel="現在地から近い順"
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.sortRow,
            { top: sortTop },
            pressed && styles.pressed,
          ]}
        >
          <MaterialIcons color={TEXT_GRAY} name="swap-vert" size={20} />
          <Text style={styles.sortText}>{copy.nearest}</Text>
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
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 19,
  },
  searchField: {
    flex: 1,
    height: 30,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  searchIcon: {
    position: "absolute",
    left: 14,
  },
  searchInput: {
    width: "100%",
    height: 30,
    paddingTop: 0,
    paddingRight: 12,
    paddingBottom: 0,
    paddingLeft: 45,
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "400",
    letterSpacing: 0,
  },
  headerIconButton: {
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  notificationButton: {
    width: 32,
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
    width: 32,
  },
  categoryList: {
    position: "absolute",
    top: 90,
    right: 0,
    left: 0,
    height: 45,
  },
  categoryContent: {
    paddingLeft: 10,
    paddingRight: 10,
    gap: 13,
  },
  categoryButton: {
    width: 45,
    height: 45,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  categoryButtonSelected: {
    borderColor: YELLOW,
    backgroundColor: YELLOW,
  },
  sortRow: {
    position: "absolute",
    top: 146,
    left: 17,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  sortText: {
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 15,
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
