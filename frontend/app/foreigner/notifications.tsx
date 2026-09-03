import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
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
import { LoadingScreen, RefreshLoadingIndicator } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { APIError } from "../../services/api-client";
import {
  loadLanguage,
  subscribeLanguage,
  type AppLanguage,
} from "../../services/onboarding";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  navigateFromForeignerNotifications,
  toNotificationView,
} from "../../services/notifications";
import type {
  NotificationPeriod,
  NotificationRecord,
  NotificationType,
  NotificationView,
} from "../../types/notification";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const LINK_BLUE = "#168df0";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];
type Filter = "all" | "unread";

type NotificationIconStyle = {
  name: MaterialIconName;
  color: string;
  backgroundColor: string;
  borderColor: string;
};

const COPY = {
  ja: {
    back: "戻る",
    title: "通知",
    all: "すべて",
    unread: "未読",
    today: "今日",
    past7Days: "過去7日間",
    loading: "通知を読み込み中…",
    retry: "再試行",
    empty: "通知はまだありません",
    signInRequired: "ログイン後に通知を表示できます。",
    loadError: "通知を読み込めませんでした。時間をおいて再試行してください。",
    markAllRead: "すべて既読にする",
    markingAllRead: "既読にしています…",
    markAllReadError: "すべて既読にできませんでした。時間をおいて再試行してください。",
  },
  en: {
    back: "Back",
    title: "Notifications",
    all: "All",
    unread: "Unread",
    today: "Today",
    past7Days: "Past 7 days",
    loading: "Loading notifications…",
    retry: "Retry",
    empty: "No notifications yet",
    signInRequired: "Sign in to view notifications.",
    loadError: "Notifications could not be loaded. Please try again later.",
    markAllRead: "Mark all as read",
    markingAllRead: "Marking as read…",
    markAllReadError: "Could not mark all notifications as read. Please try again later.",
  },
} as const;

const NOTIFICATION_ICONS: Record<
  NotificationType,
  NotificationIconStyle
> = {
  new_application: {
    name: "how-to-reg",
    color: YELLOW,
    backgroundColor: "#fff8e8",
    borderColor: "#f7dfaa",
  },
  match_confirmed: {
    name: "verified",
    color: LINK_BLUE,
    backgroundColor: SOFT_BLUE,
    borderColor: "#caeafd",
  },
  application_rejected: {
    name: "sentiment-dissatisfied",
    color: MUTED_GRAY,
    backgroundColor: "#f7f7f7",
    borderColor: BORDER_GRAY,
  },
  new_message: {
    name: "chat-bubble-outline",
    color: BLUE,
    backgroundColor: SOFT_BLUE,
    borderColor: "#caeafd",
  },
  application_withdrawn: {
    name: "undo",
    color: MUTED_GRAY,
    backgroundColor: "#f7f7f7",
    borderColor: BORDER_GRAY,
  },
  guide_canceled: {
    name: "event-busy",
    color: "#d45555",
    backgroundColor: "#fff2f2",
    borderColor: "#f1cfcf",
  },
  guide_updated: {
    name: "event-note",
    color: LINK_BLUE,
    backgroundColor: SOFT_BLUE,
    borderColor: "#caeafd",
  },
  guide_reminder: {
    name: "event-available",
    color: BLUE,
    backgroundColor: SOFT_BLUE,
    borderColor: "#caeafd",
  },
  recruitment_expired: {
    name: "hourglass-empty",
    color: MUTED_GRAY,
    backgroundColor: "#f7f7f7",
    borderColor: BORDER_GRAY,
  },
};

function NotificationIcon({ type }: { type: NotificationType }) {
  const icon = NOTIFICATION_ICONS[type];

  return (
    <View
      style={[
        styles.iconCircle,
        {
          backgroundColor: icon.backgroundColor,
          borderColor: icon.borderColor,
        },
      ]}
    >
      <MaterialIcons color={icon.color} name={icon.name} size={30} />
    </View>
  );
}

function NotificationCard({
  notification,
  onPress,
}: {
  notification: NotificationView;
  onPress: (notification: NotificationView) => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${notification.title}. ${notification.message}`}
      accessibilityRole="button"
      onPress={() => onPress(notification)}
      style={({ pressed }) => [
        styles.notificationCard,
        notification.unread && styles.notificationCardUnread,
        pressed && styles.pressed,
      ]}
    >
      {notification.unread ? <View style={styles.unreadDot} /> : null}
      <NotificationIcon type={notification.type} />

      <View style={styles.notificationText}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.notificationTitle}>
            {notification.title}
          </Text>
          <Text style={styles.receivedAt}>{notification.receivedAt}</Text>
        </View>
        <Text numberOfLines={2} style={styles.notificationMessage}>
          {notification.message}
        </Text>
      </View>

      <MaterialIcons color={MUTED_GRAY} name="chevron-right" size={30} />
    </Pressable>
  );
}

export default function ForeignerNotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [notificationRecords, setNotificationRecords] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [markAllError, setMarkAllError] = useState<string | null>(null);
  const initialLoadStartedRef = useRef(false);
  const activeLoadRef = useRef<{ cancel: () => void } | null>(null);
  const copy = COPY[language ?? "en"];
	const copyRef = useRef(copy);
	copyRef.current = copy;
  const loadNotifications = useCallback((mode: "initial" | "refresh" = "refresh") => {
    activeLoadRef.current?.cancel();
    const controller = new AbortController();
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      controller.abort();
    };
    activeLoadRef.current = { cancel };

    const load = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setNotificationRecords([]);
          setLoading(false);
          setRefreshing(false);
			setLoadError(copyRef.current.signInRequired);
        }
        if (activeLoadRef.current?.cancel === cancel) activeLoadRef.current = null;
        return;
      }

      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setLoadError(null);
      try {
        let records;
        try {
          records = await listNotifications(activeSession, { limit: 50 }, controller.signal);
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 401) throw error;
          await refresh();
          const refreshedSession = getCurrentSession();
          if (!refreshedSession) throw error;
          records = await listNotifications(refreshedSession, { limit: 50 }, controller.signal);
        }
        if (!cancelled) {
          setNotificationRecords(records);
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
        if (activeLoadRef.current?.cancel === cancel) activeLoadRef.current = null;
      }
    };

    void load();

	return cancel;
	}, [getCurrentSession, refresh, session, status]);

  const loadNotificationsRef = useRef(loadNotifications);
  loadNotificationsRef.current = loadNotifications;

  const handleMarkAllRead = useCallback(async () => {
    if (markingAllRead || status !== "signed_in") return;
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;

    setMarkAllError(null);
    setMarkingAllRead(true);
    try {
      try {
        await markAllNotificationsRead(activeSession);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        await refresh();
        const refreshedSession = getCurrentSession();
        if (!refreshedSession) throw error;
        await markAllNotificationsRead(refreshedSession);
      }
      const readAt = new Date().toISOString();
      setNotificationRecords((current) => current.map((item) => (
        item.read_at ? item : { ...item, read_at: readAt }
      )));
    } catch {
      setMarkAllError(copyRef.current.markAllReadError);
    } finally {
      setMarkingAllRead(false);
    }
  }, [getCurrentSession, markingAllRead, refresh, session, status]);

	useEffect(() => () => {
		activeLoadRef.current?.cancel();
	}, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage ?? "en");
    });
    void loadLanguage().then((storedLanguage) => {
      if (active) setLanguage(storedLanguage ?? "en");
    }).catch(() => {
      if (active) setLanguage("en");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
		if (status === "loading") {
			initialLoadStartedRef.current = false;
			return;
		}
		if (status !== "signed_in") {
			initialLoadStartedRef.current = false;
			return loadNotificationsRef.current("initial");
		}
		if (initialLoadStartedRef.current) return;

    initialLoadStartedRef.current = true;
    return loadNotificationsRef.current("initial");
	}, [status]);

  const notifications = useMemo(() => {
    const now = new Date();
    const liveNotifications = notificationRecords.map((record) =>
      toNotificationView(record, language ?? "en", now),
    );
    if (filter === "unread") {
      return liveNotifications.filter((notification) => notification.unread);
    }

    return liveNotifications;
  }, [filter, language, notificationRecords]);
  const notificationGroups = useMemo(
    () =>
      (["today", "past_7_days"] as const)
        .map((period) => ({
          period,
          notifications: notifications.filter(
            (notification) => notification.period === period,
          ),
        }))
        .filter((group) => group.notifications.length > 0),
    [notifications],
  );
  const filters = [
    { key: "all" as const, label: copy.all },
    { key: "unread" as const, label: copy.unread },
  ];
  const periodLabels: Record<NotificationPeriod, string> = {
    today: copy.today,
    past_7_days: copy.past7Days,
  };
  const markAllDisabled =
    loading || refreshing || markingAllRead || status !== "signed_in";
  const openNotification = (notification: NotificationView) => {
    const activeSession = getCurrentSession() ?? session;
    if (notification.unread) {
      setNotificationRecords((current) => current.map((item) => (
        item.id === notification.id && !item.read_at
          ? { ...item, read_at: new Date().toISOString() }
          : item
      )));
      if (activeSession) {
        // Do not make navigation wait for a best-effort read receipt. A
        // refresh or a slow API must not make a notification appear inert.
        void markNotificationRead(activeSession, notification.id).catch(() => {
          // Keep the local optimistic state; an explicit pull-to-refresh can reconcile it.
        });
      }
    }

    navigateFromForeignerNotifications(router, notification);
  };

  if (!language) {
    return <LoadingScreen />;
  }

  if (loading && notificationRecords.length === 0 && !loadError) {
    return <LoadingScreen />;
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            { top: Math.max(insets.top + 8, 49) },
            pressed && styles.pressed,
          ]}
        >
          <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
        </Pressable>

        <MaterialIcons color="#ffffff" name="notifications-none" size={43} />
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            colors={["transparent"]}
            onRefresh={() => {
              void loadNotifications("refresh");
            }}
            progressBackgroundColor="transparent"
            refreshing={refreshing}
            tintColor="transparent"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.segmentedControl}>
          {filters.map((item) => {
            const selected = filter === item.key;

            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(item.key)}
                style={({ pressed }) => [
                  styles.segment,
                  selected && styles.segmentSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    selected && styles.segmentTextSelected,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityLabel={markingAllRead ? copy.markingAllRead : copy.markAllRead}
            accessibilityRole="button"
            accessibilityState={{ disabled: markAllDisabled }}
            disabled={markAllDisabled}
            onPress={() => {
              void handleMarkAllRead();
            }}
            style={({ pressed }) => [
              styles.markAllButton,
              markAllDisabled && styles.markAllButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.markAllButtonText}>
              {markingAllRead ? copy.markingAllRead : copy.markAllRead}
            </Text>
          </Pressable>
          {markAllError ? (
            <Text accessibilityRole="alert" style={styles.actionError}>
              {markAllError}
            </Text>
          ) : null}
        </View>

        {loading && notificationRecords.length === 0 ? null : loadError && notificationRecords.length === 0 ? (
          <View style={styles.emptyState}>
            <Text accessibilityRole="alert" style={styles.emptyTitle}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void loadNotifications("initial");
              }}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : notificationGroups.length > 0 ? (
          notificationGroups.map((group) => (
            <View key={group.period} style={styles.section}>
              <Text style={styles.sectionTitle}>{periodLabels[group.period]}</Text>
              <View style={styles.cardList}>
                {group.notifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onPress={openNotification}
                  />
                ))}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons color={BLUE} name="notifications-none" size={34} />
            </View>
            <Text style={styles.emptyTitle}>{copy.empty}</Text>
          </View>
        )}
      </ScrollView>
      {refreshing ? <RefreshLoadingIndicator color={BLUE} top={248} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    position: "relative",
    height: 238,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 38,
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
    marginTop: 22,
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 36,
    textAlign: "center",
  },
  content: {
    minHeight: 606,
    alignItems: "center",
    paddingTop: 36,
    paddingHorizontal: 19,
    paddingBottom: 42,
  },
  segmentedControl: {
    width: "100%",
    maxWidth: 306,
    height: 48,
    flexDirection: "row",
    padding: 2,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 24,
    backgroundColor: "#ffffff",
  },
  actions: {
    width: "100%",
    maxWidth: 306,
    alignItems: "stretch",
    marginTop: 12,
  },
  markAllButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: LINK_BLUE,
    borderRadius: 21,
    backgroundColor: "#ffffff",
  },
  markAllButtonDisabled: {
    opacity: 0.45,
  },
  markAllButtonText: {
    color: LINK_BLUE,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
    textAlign: "center",
  },
  actionError: {
    marginTop: 8,
    color: "#c25a24",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    textAlign: "center",
  },
  segment: {
    flex: 1,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
  },
  segmentSelected: {
    backgroundColor: BLUE,
  },
  segmentText: {
    color: MUTED_GRAY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  segmentTextSelected: {
    color: "#ffffff",
  },
  section: {
    width: "100%",
    maxWidth: 348,
    marginTop: 34,
  },
  sectionTitle: {
    color: "#30343b",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 27,
  },
  cardList: {
    marginTop: 20,
    gap: 16,
  },
  notificationCard: {
    width: "100%",
    minHeight: 100,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 18,
    paddingRight: 10,
    paddingBottom: 18,
    paddingLeft: 27,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  notificationCardUnread: {
    borderColor: BLUE,
    backgroundColor: "#f4f9fd",
  },
  iconCircle: {
    width: 62,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 31,
  },
  notificationText: {
    flex: 1,
    marginLeft: 17,
  },
  titleRow: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  notificationTitle: {
    flex: 1,
    color: "#101318",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 20,
  },
  unreadDot: {
    position: "absolute",
    left: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: LINK_BLUE,
  },
  notificationMessage: {
    marginTop: 7,
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 18,
  },
  receivedAt: {
    color: MUTED_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 18,
  },
  emptyState: {
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIconCircle: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 38,
    backgroundColor: "#eff8ff",
  },
  emptyTitle: {
    marginTop: 18,
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: "center",
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  retryButton: {
    minWidth: 78,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    paddingHorizontal: 16,
    borderRadius: 17,
    backgroundColor: YELLOW,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.72,
  },
});
