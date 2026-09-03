import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Header, LoadingSpinner } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { APIError } from "../../services/api-client";
import {
  filterChatsByStatus,
  listChats,
  type ChatListFilter,
  type ChatSummary,
} from "../../services/chat";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../../services/onboarding";
import { getTabBarContentBottomPadding } from "../../utils/layout";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

const COPY = {
  ja: {
    title: "チャット",
    back: "戻る",
    loading: "チャットを読み込み中…",
    retry: "再試行",
    empty: "マッチング後にチャットが表示されます",
    emptyFiltered: "選択した状態のチャットはありません",
    showAll: "すべてのチャットを表示",
    signInRequired: "ログイン後にチャットを表示できます。",
    loadError: "チャットを読み込めませんでした。時間をおいて再試行してください。",
    filterTitle: "チャットの状態",
    filters: { all: "すべて", active: "進行中", completed: "終了済み" },
    filterOption: (label: string, count: number) => `${label}（${count}件）`,
    chatStatus: { accepted: "進行中", completed: "終了済み" },
    unread: (count: number) => `${count}件の未読`,
    open: (name: string, status: string, unreadCount: number) =>
      `${name}さんとのチャットを開く。状態: ${status}${unreadCount > 0 ? `。${unreadCount}件の未読` : ""}`,
    unknownUser: "Samurai Meetユーザー",
    lastMessage: (time: string) => `最終メッセージ ${time}`,
    noMessages: "まだメッセージはありません",
  },
  en: {
    title: "Chat",
    back: "Back",
    loading: "Loading chats…",
    retry: "Retry",
    empty: "Chats appear after a match is confirmed",
    emptyFiltered: "No chats match this status",
    showAll: "Show all chats",
    signInRequired: "Sign in to view chats.",
    loadError: "Chats could not be loaded. Please try again later.",
    filterTitle: "Chat status",
    filters: { all: "All", active: "Active", completed: "Completed" },
    filterOption: (label: string, count: number) => `${label} (${count})`,
    chatStatus: { accepted: "Active", completed: "Completed" },
    unread: (count: number) => count === 1 ? "1 unread" : `${count} unread`,
    open: (name: string, status: string, unreadCount: number) =>
      `Open chat with ${name}. Status: ${status}${unreadCount > 0 ? `. ${copyUnread(unreadCount)}` : ""}`,
    unknownUser: "Samurai Meet user",
    lastMessage: (time: string) => `Last message ${time}`,
    noMessages: "No messages yet",
  },
} as const;

function copyUnread(count: number): string {
  return count === 1 ? "1 unread" : `${count} unread`;
}

const FILTER_OPTIONS: readonly ChatListFilter[] = ["all", "active", "completed"];

function formatRelative(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}

export default function ChatListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { matchId } = useLocalSearchParams<{ matchId?: string | string[] }>();
  const targetMatchID = Array.isArray(matchId) ? matchId[0] : matchId;
  const { getCurrentSession, refresh, session, status } = useAuth();
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChatListFilter>("all");
  const navigatedMatchRef = useRef<string | null>(null);
  const copy = COPY[language ?? "ja"];

  const sortedChats = useMemo(() => [...chats].sort((left, right) => {
    const leftTime = Date.parse(left.last_message_at ?? left.updated_at);
    const rightTime = Date.parse(right.last_message_at ?? right.updated_at);
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  }), [chats]);

  const visibleChats = useMemo(
    () => filterChatsByStatus(sortedChats, filter),
    [filter, sortedChats],
  );
  const filterCounts = useMemo(() => ({
    all: filterChatsByStatus(sortedChats, "all").length,
    active: filterChatsByStatus(sortedChats, "active").length,
    completed: filterChatsByStatus(sortedChats, "completed").length,
  }), [sortedChats]);

  const load = useCallback((mode: "initial" | "refresh" = "refresh") => {
    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
          setLoadError(copy.signInRequired);
        }
        return;
      }

      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setLoadError(null);
      try {
        let result;
        try {
          result = await listChats(activeSession, controller.signal);
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 401) throw error;
          await refresh();
          const refreshedSession = getCurrentSession();
          if (!refreshedSession) throw error;
          result = await listChats(refreshedSession, controller.signal);
        }
        if (!cancelled) setChats(result);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!cancelled) setLoadError(copy.loadError);
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
  }, [copy.loadError, copy.signInRequired, getCurrentSession, refresh, session, status]);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage ?? "ja");
    });
    void loadLanguage().then((storedLanguage) => {
      if (!active) return;
      const nextLanguage = storedLanguage ?? "ja";
      setLanguage(nextLanguage);
    }).catch(() => {
      if (active) setLanguage("ja");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useFocusEffect(
    useCallback(() => load("initial"), [load]),
  );

  useEffect(() => {
    if (!targetMatchID || loading || loadError || navigatedMatchRef.current === targetMatchID) return;
    const target = chats.find((chat) => chat.match_id === targetMatchID || chat.id === targetMatchID);
    if (!target) return;
    navigatedMatchRef.current = targetMatchID;
    router.replace({
      pathname: "/chat/[id]",
      params: { id: target.id },
    });
  }, [chats, loadError, loading, router, targetMatchID]);

  if (!language) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <LoadingSpinner color={BLUE} size={28} speedMs={640} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header
        iconName="chat-bubble-outline"
        style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}
        title={copy.title}
        titleStyle={styles.headerTitle}
        variant="hero"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: getTabBarContentBottomPadding(insets.bottom) },
        ]}
        refreshControl={
          <RefreshControl onRefresh={() => void load("refresh")} refreshing={refreshing} tintColor={BLUE} />
        }
        showsVerticalScrollIndicator={false}
      >
        {chats.length > 0 ? (
          <View style={styles.filterSection}>
            <Text style={styles.filterTitle}>{copy.filterTitle}</Text>
            <View style={styles.filterRow}>
              {FILTER_OPTIONS.map((option) => {
                const selected = filter === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityLabel={copy.filterOption(copy.filters[option], filterCounts[option])}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setFilter(option)}
                    style={({ pressed }) => [
                      styles.filterButton,
                      selected && styles.filterButtonSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.filterButtonText, selected && styles.filterButtonTextSelected]}>
                      {copy.filters[option]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        {loading && chats.length === 0 ? (
          <View style={styles.statePanel}>
            <LoadingSpinner color={BLUE} size={24} speedMs={680} />
            <Text style={styles.stateText}>{copy.loading}</Text>
          </View>
        ) : loadError && chats.length === 0 ? (
          <View style={styles.statePanel}>
            <Text accessibilityRole="alert" style={styles.stateText}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load("initial")}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : visibleChats.length === 0 ? (
          <View style={styles.statePanel}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons color={BLUE} name="forum" size={34} />
            </View>
            <Text style={styles.stateText}>{chats.length === 0 ? copy.empty : copy.emptyFiltered}</Text>
            {chats.length > 0 && filter !== "all" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setFilter("all")}
                style={({ pressed }) => [styles.clearFilterButton, pressed && styles.pressed]}
              >
                <Text style={styles.clearFilterButtonText}>{copy.showAll}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.chatList}>
            {visibleChats.map((chat) => {
              const lastMessageAt = formatRelative(chat.last_message_at);
              const statusLabel = copy.chatStatus[chat.status];
              const isCompleted = chat.status === "completed";
              const chatName = chat.other_user_name || copy.unknownUser;
              return (
                <Pressable
                  key={chat.id}
                  accessibilityLabel={copy.open(chatName, statusLabel, chat.unread_count)}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/chat/[id]", params: { id: chat.id } })}
                  style={({ pressed }) => [styles.chatCard, pressed && styles.pressed]}
                >
                  <View style={styles.avatarCircle}>
                    <MaterialIcons color="#d4d4d4" name="account-circle" size={52} />
                  </View>
                  <View style={styles.chatText}>
                    <View style={styles.titleRow}>
                      <Text numberOfLines={1} style={styles.chatName}>{chatName}</Text>
                      {chat.unread_count > 0 ? (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadText}>{chat.unread_count}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.statusPill,
                        isCompleted ? styles.statusPillCompleted : styles.statusPillActive,
                      ]}
                    >
                      <MaterialIcons
                        color={isCompleted ? TEXT_GRAY : BLUE}
                        name={isCompleted ? "check-circle-outline" : "schedule"}
                        size={16}
                      />
                      <Text
                        style={[
                          styles.statusText,
                          isCompleted ? styles.statusTextCompleted : styles.statusTextActive,
                        ]}
                      >
                        {statusLabel}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={styles.chatPreview}>
                      {lastMessageAt ? copy.lastMessage(lastMessageAt) : copy.noMessages}
                    </Text>
                    {chat.unread_count > 0 ? (
                      <Text style={styles.unreadLabel}>{copy.unread(chat.unread_count)}</Text>
                    ) : null}
                  </View>
                  <MaterialIcons color={MUTED_GRAY} name="chevron-right" size={30} />
                </Pressable>
              );
            })}
          </View>
        )}
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
    backgroundColor: "#ffffff",
  },
  header: {
    minHeight: 178,
    paddingHorizontal: 24,
    paddingBottom: 26,
    borderBottomLeftRadius: 42,
    borderBottomRightRadius: 42,
  },
  headerTitle: {
    marginTop: 8,
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 34,
  },
  content: {
    minHeight: 620,
    alignItems: "center",
    paddingTop: 36,
    paddingHorizontal: 24,
  },
  filterSection: {
    width: "100%",
    maxWidth: 348,
    marginBottom: 20,
  },
  filterTitle: {
    marginBottom: 9,
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 18,
  },
  filterRow: {
    width: "100%",
    flexDirection: "row",
    gap: 8,
  },
  filterButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 12,
    backgroundColor: "#ffffff",
  },
  filterButtonSelected: {
    borderColor: BLUE,
    backgroundColor: BLUE,
  },
  filterButtonText: {
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 18,
  },
  filterButtonTextSelected: {
    color: "#ffffff",
  },
  chatList: {
    width: "100%",
    maxWidth: 348,
    gap: 16,
  },
  chatCard: {
    minHeight: 112,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingRight: 10,
    paddingLeft: 18,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  avatarCircle: {
    width: 62,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 31,
    backgroundColor: "#ffffff",
  },
  chatText: {
    flex: 1,
    marginLeft: 16,
  },
  titleRow: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chatName: {
    flex: 1,
    color: "#101318",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 22,
  },
  statusPill: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    marginTop: 3,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: 14,
  },
  statusPillActive: {
    borderColor: "#b8e4fb",
    backgroundColor: SOFT_BLUE,
  },
  statusPillCompleted: {
    borderColor: BORDER_GRAY,
    backgroundColor: "#f7f7f7",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 16,
  },
  statusTextActive: {
    color: BLUE,
  },
  statusTextCompleted: {
    color: TEXT_GRAY,
  },
  chatPreview: {
    marginTop: 7,
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 18,
  },
  unreadBadge: {
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: YELLOW,
  },
  unreadText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 15,
  },
  unreadLabel: {
    marginTop: 6,
    color: YELLOW,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 15,
  },
  statePanel: {
    minHeight: 370,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  stateText: {
    maxWidth: 290,
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
  },
  emptyIconCircle: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#caeafd",
    borderRadius: 38,
    backgroundColor: SOFT_BLUE,
  },
  retryButton: {
    minWidth: 92,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 17,
  },
  clearFilterButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 10,
  },
  clearFilterButtonText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
});
