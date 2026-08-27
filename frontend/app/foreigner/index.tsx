import { useCallback, useMemo, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../hooks/useAuth";
import { useUnreadNotifications } from "../../hooks/useUnreadNotifications";
import { APIError } from "../../services/api-client";
import { listMatches, type MatchView } from "../../services/matching";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

export default function ForeignerHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const hasUnreadNotifications = useUnreadNotifications();
  const [query, setQuery] = useState("");
  const [applications, setApplications] = useState<MatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput>(null);
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

  const loadApplications = useCallback(() => {
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (status !== "signed_in" || !activeSession) {
        if (!cancelled) {
          setLoading(false);
          setLoadError("ログイン後に応募を表示できます。");
        }
        return;
      }

      setLoading(true);
      setLoadError(null);
      try {
        let result;
        try {
          result = await listMatches(
            activeSession,
            { role: "owner", limit: 50 },
            controller.signal,
          );
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 401) throw error;
          await refresh();
          const refreshedSession = getCurrentSession();
          if (!refreshedSession) throw error;
          result = await listMatches(
            refreshedSession,
            { role: "owner", limit: 50 },
            controller.signal,
          );
        }
        if (!cancelled) setApplications(result);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!cancelled) {
          setLoadError("応募を読み込めませんでした。時間をおいて再試行してください。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [getCurrentSession, refresh, session, status]);

  useFocusEffect(loadApplications);

  const openSearchPreferences = () => {
    searchInputRef.current?.blur();
    router.push({
      pathname: "/tabs",
      params: { query },
    });
  };
  const openApplication = (applicationId: string) => {
    router.push({
      pathname: "/foreigner/applications/[id]",
      params: { id: applicationId },
    });
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View
          style={[
            styles.actionRow,
            { top: Math.max(insets.top + 8, 45) },
          ]}
        >
          <View style={styles.searchField}>
            <Pressable
              accessibilityLabel="Open search preferences"
              accessibilityRole="button"
              hitSlop={8}
              onPress={openSearchPreferences}
              style={({ pressed }) => [
                styles.searchIconButton,
                pressed && styles.pressed,
              ]}
            >
              <MaterialIcons color="#949494" name="search" size={22} />
            </Pressable>
            <TextInput
              ref={searchInputRef}
              accessibilityLabel="Search"
              onChangeText={setQuery}
              onSubmitEditing={openSearchPreferences}
              placeholder="What would you like to do?"
              placeholderTextColor="#949494"
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />
          </View>

          <Pressable
            accessibilityLabel="Notifications"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/foreigner/notifications")}
            style={({ pressed }) => [
              styles.notificationButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons
              color="#ffffff"
              name="notifications-none"
              size={30}
            />
            {hasUnreadNotifications ? <View style={styles.notificationBadge} /> : null}
          </Pressable>

          <Pressable
            accessibilityLabel="Profile"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/profile")}
            style={styles.profileButton}
          >
            <MaterialIcons color="#ffffff" name="account-circle" size={30} />
          </Pressable>
        </View>

        <Text
          style={[
            styles.title,
            { top: Math.max(insets.top + 71, 108) },
          ]}
        >
          Find Your Japan!
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pendingHeader}>
          <View style={styles.pendingIconCircle}>
            <MaterialIcons color={YELLOW} name="how-to-reg" size={28} />
          </View>
          <View style={styles.pendingHeaderText}>
            <Text style={styles.pendingEyebrow}>Needs your response</Text>
            <Text style={styles.pendingTitle}>
              {pendingApplications.length === 1
                ? "1 new application"
                : `${pendingApplications.length} new applications`}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.emptyPanel}>
            <ActivityIndicator color={BLUE} size="small" />
            <Text style={styles.emptyTitle}>応募を読み込み中...</Text>
          </View>
        ) : loadError ? (
          <View style={styles.emptyPanel}>
            <Text accessibilityRole="alert" style={styles.emptyTitle}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={loadApplications}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : pendingApplications.length > 0 || matchedApplications.length > 0 ? (
          <>
            {pendingApplications.length > 0 ? (
              <View style={styles.applicationSection}>
                <Text style={styles.sectionTitle}>Review applications</Text>
                <View style={styles.applicationList}>
                  {pendingApplications.map((application) => (
                    <Pressable
                      key={application.id}
                      accessibilityLabel={`Review application from ${application.other_user.name}`}
                      accessibilityRole="button"
                      onPress={() => openApplication(application.id)}
                      style={({ pressed }) => [
                        styles.applicationCard,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.avatarCircle}>
                        <MaterialIcons color="#d4d4d4" name="account-circle" size={52} />
                      </View>

                      <View style={styles.applicationText}>
                        <Text numberOfLines={1} style={styles.applicantName}>
                          {application.other_user.name}
                        </Text>
                        <Text numberOfLines={2} style={styles.applicationBio}>
                          {application.other_user.bio || "No introduction provided."}
                        </Text>
                      </View>

                      <View style={styles.reviewButton}>
                        <Text style={styles.reviewButtonText}>Review</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {matchedApplications.length > 0 ? (
              <View style={styles.applicationSection}>
                <Text style={styles.sectionTitle}>Your matches</Text>
                <View style={styles.applicationList}>
                  {matchedApplications.map((application) => (
                    <Pressable
                      key={application.id}
                      accessibilityLabel={`Open match with ${application.other_user.name}`}
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
                        <Text style={styles.reviewButtonText}>
                          {application.status === "completed" ? "Completed" : "Matched"}
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
            <Text style={styles.emptyTitle}>All applications are handled</Text>
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
  header: {
    position: "relative",
    width: "100%",
    height: 156,
    backgroundColor: BLUE,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
  },
  actionRow: {
    position: "absolute",
    top: 45,
    left: 19,
    right: 19,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 19,
  },
  searchField: {
    flex: 1,
    height: 30,
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  searchIconButton: {
    position: "absolute",
    left: 12,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  searchInput: {
    width: "100%",
    height: 30,
    paddingTop: 0,
    paddingRight: 12,
    paddingBottom: 0,
    paddingLeft: 45.34,
    color: "#1f1f1f",
    fontSize: 12,
    fontWeight: "400",
    letterSpacing: 0,
  },
  notificationButton: {
    width: 21,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
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
    width: 24.56,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  title: {
    position: "absolute",
    top: 108,
    left: 0,
    right: 0,
    color: "#ffffff",
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
    borderColor: "#caeafd",
    borderRadius: 20,
    backgroundColor: SOFT_BLUE,
  },
  pendingIconCircle: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#f7dfaa",
    borderRadius: 29,
    backgroundColor: "#fff8e8",
  },
  pendingHeaderText: {
    flex: 1,
    marginLeft: 16,
  },
  pendingEyebrow: {
    color: BLUE,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 15,
  },
  pendingTitle: {
    marginTop: 5,
    color: "#101318",
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
    color: TEXT_GRAY,
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
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  avatarCircle: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 29,
    backgroundColor: "#ffffff",
  },
  applicationText: {
    flex: 1,
    marginLeft: 14,
  },
  applicantName: {
    color: "#101318",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 20,
  },
  applicationBio: {
    marginTop: 6,
    color: TEXT_GRAY,
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
    backgroundColor: YELLOW,
  },
  reviewButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 15,
  },
  matchedButton: {
    backgroundColor: BLUE,
  },
  emptyPanel: {
    width: "100%",
    maxWidth: 342,
    minHeight: 126,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  emptyTitle: {
    marginTop: 12,
    color: MUTED_GRAY,
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
