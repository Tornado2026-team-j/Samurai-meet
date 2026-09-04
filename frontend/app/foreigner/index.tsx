import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LoadingSpinner, RefreshLoadingIndicator, spacing } from "../../components/ui";
import type { ThemeColors } from "../../components/ui/tokens";
import { useAuth } from "../../hooks/useAuth";
import { useDisplayLanguage } from "../../hooks/useDisplayLanguage";
import { useUnreadNotifications } from "../../hooks/useUnreadNotifications";
import { useTheme, useThemeStyles } from "../../hooks/useTheme";
import { APIError } from "../../services/api-client";
import { listChats } from "../../services/chat";
import { listMatches, listMyRecruitments, type MatchView, type Recruitment } from "../../services/matching";
import { formatApplicationBio } from "../../services/profile-format";
import { getTabBarContentBottomPadding } from "../../utils/layout";

const COPY = {
  ja: {
    signInRequired: "ログイン後に応募を表示できます。",
    loadError: "応募を読み込めませんでした。時間をおいて再試行してください。",
    openSearch: "募集条件を開く",
    search: "検索",
    searchPlaceholder: "何をしたいですか？",
    notifications: "通知",
    profile: "プロフィール",
    title: "あなたの日本を見つけよう！",
    createRecruitment: "募集を作成",
    publicRecruitments: "公開中の募集",
    todayPlan: "今日の予定",
    openPlans: "予定を見る",
    unreadChat: "未読チャットがあります",
    needsResponse: "対応が必要です",
    newApplications: (count: number) => `${count}件の新しい応募`,
    loading: "応募を読み込み中…",
    retry: "再試行",
    reviewApplications: "応募を確認",
    reviewApplication: (name: string) => `${name}さんの応募を確認`,
    noIntroduction: "自己紹介はありません。",
    review: "確認する",
    matches: "マッチング済み",
    openMatch: (name: string) => `${name}さんとのマッチを開く`,
    completed: "完了",
    matched: "マッチ済み",
    allHandled: "すべての応募に対応済みです",
  },
  en: {
    signInRequired: "Sign in to view applications.",
    loadError: "Applications could not be loaded. Please try again later.",
    openSearch: "Open search preferences",
    search: "Search",
    searchPlaceholder: "What would you like to do?",
    notifications: "Notifications",
    profile: "Profile",
    title: "Find Your Japan!",
    createRecruitment: "Create recruitment",
    publicRecruitments: "Live recruitments",
    todayPlan: "Today's plan",
    openPlans: "View plans",
    unreadChat: "You have unread chats",
    needsResponse: "Needs your response",
    newApplications: (count: number) => count === 1 ? "1 new application" : `${count} new applications`,
    loading: "Loading applications…",
    retry: "Retry",
    reviewApplications: "Review applications",
    reviewApplication: (name: string) => `Review application from ${name}`,
    noIntroduction: "No introduction provided.",
    review: "Review",
    matches: "Your matches",
    openMatch: (name: string) => `Open match with ${name}`,
    completed: "Completed",
    matched: "Matched",
    allHandled: "All applications are handled",
  },
} as const;

export default function ForeignerHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const BLUE = colors.brand.sky;
  const YELLOW = colors.brand.gold;
  const { getCurrentSession, refresh, session, status } = useAuth();
  const hasUnreadNotifications = useUnreadNotifications();
  const language = useDisplayLanguage();
  const [applications, setApplications] = useState<MatchView[]>([]);
  const [ownedRecruitments, setOwnedRecruitments] = useState<Recruitment[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);
  const loadInFlight = useRef(false);
  // Keep the fallback internal until the stored language is ready. The
  // neutral branch below prevents guessed copy from appearing on screen.
  const copy = COPY[language ?? "en"];
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const pendingApplications = useMemo(
    () => applications.filter((application) => application.status === "pending"),
    [applications],
  );
  const matchedApplications = useMemo(
    () => applications.filter(
      (application) => application.status === "accepted" || application.status === "completed",
    ),
    [applications],
  );
  const openRecruitments = useMemo(() => ownedRecruitments.filter((item) => item.status === "open" || item.status === "matched"), [ownedRecruitments]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const todayPlans = useMemo(() => matchedApplications.filter((item) => item.status === "accepted" && item.recruitment.available_date === today), [matchedApplications, today]);

  const loadApplications = useCallback((mode: "initial" | "refresh" = "refresh") => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setApplications([]);
          setOwnedRecruitments([]);
          setUnreadChatCount(0);
          setLoading(false);
          setRefreshing(false);
          setLoadError(copyRef.current.signInRequired);
        }
        loadInFlight.current = false;
        return;
      }

      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setLoadError(null);
      try {
        let result;
        let recruitments;
        let chats;
        try {
          [result, recruitments, chats] = await Promise.all([
            listMatches(activeSession, { role: "owner", limit: 50 }, controller.signal),
            listMyRecruitments(activeSession, controller.signal),
            listChats(activeSession, controller.signal),
          ]);
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 401) throw error;
          await refresh();
          const refreshedSession = getCurrentSession();
          if (!refreshedSession) throw error;
          [result, recruitments, chats] = await Promise.all([
            listMatches(refreshedSession, { role: "owner", limit: 50 }, controller.signal),
            listMyRecruitments(refreshedSession, controller.signal),
            listChats(refreshedSession, controller.signal),
          ]);
        }
        if (!cancelled) {
          setApplications(result);
          setOwnedRecruitments(recruitments);
          setUnreadChatCount(chats.reduce((sum, chat) => sum + chat.unread_count, 0));
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
        loadInFlight.current = false;
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      loadInFlight.current = false;
    };
  }, [getCurrentSession, refresh, session, status]);

  const loadApplicationsRef = useRef(loadApplications);
  loadApplicationsRef.current = loadApplications;

  useEffect(() => {
    if (status === "loading") return;
    if (status !== "signed_in") {
      initialLoadStarted.current = false;
      return loadApplicationsRef.current("initial");
    }
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    return loadApplicationsRef.current("initial");
  }, [status]);

  const openSearchPreferences = () => {
    router.push("/tabs");
  };
  const openApplication = (applicationId: string) => {
    router.push({
      pathname: "/foreigner/applications/[id]",
      params: { id: applicationId },
    });
  };

  if (!language) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.header} />
        <View style={styles.languageLoadingPanel}>
          <LoadingSpinner color={BLUE} size={24} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View
          style={[
            styles.actionRow,
            { top: Math.max(insets.top + 8, 45) },
          ]}
        >
          <Pressable
            accessibilityLabel={copy.openSearch}
            accessibilityRole="button"
            onPress={openSearchPreferences}
            style={({ pressed }) => [
              styles.searchField,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons color={colors.text.muted} name="search" size={24} />
            <Text numberOfLines={1} style={styles.searchPlaceholder}>
              {copy.searchPlaceholder}
            </Text>
          </Pressable>

          <Pressable
            accessibilityLabel={copy.notifications}
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => router.push("/foreigner/notifications")}
            style={({ pressed }) => [
              styles.notificationButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons
              color={colors.text.onSky}
              name="notifications-none"
              size={32}
            />
            {hasUnreadNotifications ? <View style={styles.notificationBadge} /> : null}
          </Pressable>

          <Pressable
            accessibilityLabel={copy.profile}
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => router.push("/profile")}
            style={styles.profileButton}
          >
            <MaterialIcons color={colors.text.onSky} name="account-circle" size={34} />
          </Pressable>
        </View>

        <Text
          style={[
            styles.title,
            { top: Math.max(insets.top + 71, 108) },
          ]}
        >
          {copy.title}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
        styles.content,
        {
            paddingBottom: getTabBarContentBottomPadding(insets.bottom),
            paddingLeft: Math.max(insets.left + 16, 24),
            paddingRight: Math.max(insets.right + 16, 24),
          },
        ]}
        alwaysBounceVertical
        bounces
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              void loadApplications("refresh");
            }}
            colors={["transparent"]}
            progressBackgroundColor="transparent"
            refreshing={refreshing}
            tintColor="transparent"
          />
        }
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={openSearchPreferences} style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}>
          <MaterialIcons color={colors.text.onGold} name="add-circle" size={23} />
          <Text style={styles.createButtonText}>{copy.createRecruitment}</Text>
        </Pressable>

        <View style={styles.dashboardRow}>
          <Pressable onPress={() => router.push("/recruitments/mine")} style={styles.dashboardItem}>
            <Text style={styles.dashboardCount}>{openRecruitments.length}</Text>
            <Text style={styles.dashboardLabel}>{copy.publicRecruitments}</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/plans")} style={styles.dashboardItem}>
            <Text style={styles.dashboardCount}>{todayPlans.length}</Text>
            <Text style={styles.dashboardLabel}>{copy.todayPlan}</Text>
          </Pressable>
        </View>

        {unreadChatCount > 0 ? (
          <Pressable onPress={() => router.push("/chat")} style={styles.unreadBanner}>
            <MaterialIcons color={BLUE} name="mark-chat-unread" size={20} />
            <Text style={styles.unreadText}>{copy.unreadChat}</Text>
            <MaterialIcons color={BLUE} name="chevron-right" size={21} />
          </Pressable>
        ) : null}

        <View style={styles.pendingHeader}>
          <View style={styles.pendingIconCircle}>
            <MaterialIcons color={YELLOW} name="how-to-reg" size={28} />
          </View>
          <View style={styles.pendingHeaderText}>
            <Text style={styles.pendingEyebrow}>{copy.needsResponse}</Text>
            <Text style={styles.pendingTitle}>
              {copy.newApplications(pendingApplications.length)}
            </Text>
          </View>
        </View>

        {loading && applications.length === 0 && !loadError ? (
          <View style={styles.emptyPanel}>
            <LoadingSpinner color={BLUE} size={24} />
            <Text style={styles.emptyTitle}>{copy.loading}</Text>
          </View>
        ) : loadError && applications.length === 0 ? (
          <View style={styles.emptyPanel}>
            <Text accessibilityRole="alert" style={styles.emptyTitle}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void loadApplications("initial");
              }}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : pendingApplications.length > 0 || matchedApplications.length > 0 ? (
          <>
            {pendingApplications.length > 0 ? (
              <View style={styles.applicationSection}>
                <Text style={styles.sectionTitle}>{copy.reviewApplications}</Text>
                <View style={styles.applicationList}>
                  {pendingApplications.map((application) => (
                    <Pressable
                      key={application.id}
                      accessibilityLabel={copy.reviewApplication(application.other_user.name)}
                      accessibilityRole="button"
                      onPress={() => openApplication(application.id)}
                      style={({ pressed }) => [
                        styles.applicationCard,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.avatarCircle}>
                      <MaterialIcons color={colors.text.muted} name="account-circle" size={52} />
                      </View>

                      <View style={styles.applicationText}>
                        <Text numberOfLines={1} style={styles.applicantName}>
                          {application.other_user.name}
                        </Text>
                        <Text numberOfLines={2} style={styles.applicationBio}>
                          {formatApplicationBio(application.other_user.bio, copy.noIntroduction)}
                        </Text>
                      </View>

                      <View style={styles.reviewButton}>
                        <Text style={styles.reviewButtonText}>{copy.review}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {matchedApplications.length > 0 ? (
              <View style={styles.applicationSection}>
                <Text style={styles.sectionTitle}>{copy.matches}</Text>
                <View style={styles.applicationList}>
                  {matchedApplications.map((application) => (
                    <Pressable
                      key={application.id}
                      accessibilityLabel={copy.openMatch(application.other_user.name)}
                      accessibilityRole="button"
                      onPress={() => openApplication(application.id)}
                      style={({ pressed }) => [
                        styles.applicationCard,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.avatarCircle}>
                        <MaterialIcons color={BLUE} name="account-circle" size={52} />
                      </View>

                      <View style={styles.applicationText}>
                        <Text numberOfLines={1} style={styles.applicantName}>
                          {application.other_user.name}
                        </Text>
                        <Text numberOfLines={2} style={styles.applicationBio}>
                          {application.recruitment.description}
                        </Text>
                      </View>

                      <View style={[styles.reviewButton, styles.matchedButton]}>
                        <Text style={[styles.reviewButtonText, styles.matchedButtonText]}>
                          {application.status === "completed" ? copy.completed : copy.matched}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.emptyPanel}>
            <MaterialIcons color={BLUE} name="check-circle-outline" size={34} />
            <Text style={styles.emptyTitle}>{copy.allHandled}</Text>
          </View>
        )}
      </ScrollView>
      {refreshing ? <RefreshLoadingIndicator color={BLUE} top={186} /> : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.screen,
  },
  header: {
    position: "relative",
    width: "100%",
    height: 176,
    backgroundColor: colors.brand.sky,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
  },
  languageLoadingPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  createButton: {
    width: "100%",
    maxWidth: 342,
    minHeight: 50,
    marginBottom: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.brand.gold,
  },
  createButtonText: {
    flexShrink: 1,
    color: colors.text.onGold,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 20,
    textAlign: "center",
  },
  dashboardRow: {
    width: "100%",
    maxWidth: 342,
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  dashboardItem: {
    flex: 1,
    minHeight: 82,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    backgroundColor: colors.surface.default,
  },
  dashboardCount: {
    color: colors.brand.sky,
    fontSize: 24,
    fontWeight: "900",
  },
  dashboardLabel: {
    marginTop: 3,
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  unreadBanner: {
    width: "100%",
    maxWidth: 342,
    minHeight: 48,
    marginBottom: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.surface.blueSoft,
  },
  unreadText: {
    flex: 1,
    color: colors.text.secondary,
    fontSize: 13,
    fontWeight: "800",
  },
  actionRow: {
    position: "absolute",
    top: 45,
    left: 19,
    right: 19,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  searchField: {
    flex: 1,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: colors.surface.default,
  },
  searchPlaceholder: {
    flex: 1,
    color: colors.text.muted,
    fontSize: 15,
    fontWeight: "400",
    letterSpacing: 0,
  },
  notificationButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  notificationBadge: {
    position: "absolute",
    top: 1,
    right: 0,
    width: 8,
    height: 8,
    borderWidth: 1,
    borderColor: colors.brand.sky,
    borderRadius: 4,
    backgroundColor: colors.brand.gold,
  },
  profileButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  title: {
    position: "absolute",
    top: 108,
    left: 0,
    right: 0,
    color: colors.text.onSky,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
    textAlign: "center",
  },
  content: {
    alignItems: "center",
    paddingTop: 36,
    paddingRight: 24,
    paddingBottom: 42,
    paddingLeft: 24,
  },
  pendingHeader: {
    width: "100%",
    maxWidth: 342,
    minHeight: 104,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.border.blue,
    borderRadius: 20,
    backgroundColor: colors.surface.blueSoft,
  },
  pendingIconCircle: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.gold,
    borderRadius: 29,
    backgroundColor: colors.surface.goldSoft,
  },
  pendingHeaderText: {
    flex: 1,
    marginLeft: 16,
  },
  pendingEyebrow: {
    color: colors.brand.sky,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 15,
  },
  pendingTitle: {
    marginTop: 5,
    color: colors.text.primary,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 27,
  },
  applicationList: {
    width: "100%",
    maxWidth: 342,
    marginTop: 20,
    gap: 14,
  },
  applicationSection: {
    width: "100%",
    maxWidth: 342,
    marginTop: 20,
  },
  sectionTitle: {
    marginBottom: 10,
    color: colors.text.secondary,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  applicationCard: {
    minHeight: 112,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 20,
    backgroundColor: colors.surface.default,
  },
  avatarCircle: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 29,
    backgroundColor: colors.surface.default,
  },
  applicationText: {
    flex: 1,
    marginLeft: 14,
  },
  applicantName: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 20,
  },
  applicationBio: {
    marginTop: 6,
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 16,
  },
  reviewButton: {
    minWidth: 64,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.brand.gold,
  },
  reviewButtonText: {
    color: colors.text.onGold,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 15,
  },
  matchedButton: {
    backgroundColor: colors.brand.sky,
  },
  matchedButtonText: {
    color: colors.text.onSky,
  },
  emptyPanel: {
    width: "100%",
    maxWidth: 342,
    minHeight: 126,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 20,
    backgroundColor: colors.surface.default,
  },
  emptyTitle: {
    marginTop: 12,
    color: colors.text.muted,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 17,
  },
  retryButton: {
    minWidth: 72,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: colors.brand.gold,
  },
  retryButtonText: {
    color: colors.text.onGold,
    fontSize: 12,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.72,
  },
  });
}
