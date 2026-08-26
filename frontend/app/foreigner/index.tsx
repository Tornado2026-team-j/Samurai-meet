import { useMemo, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { MOCK_GUIDE_APPLICATIONS } from "../../mocks/applications";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

export default function ForeignerHomeScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<TextInput>(null);
  const pendingApplications = useMemo(
    () =>
      MOCK_GUIDE_APPLICATIONS.filter(
        (application) => application.status === "pending",
      ),
    [],
  );

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
        <View style={styles.actionRow}>
          <View style={styles.searchField}>
            <MaterialIcons
              color="#949494"
              name="search"
              size={22}
              style={styles.searchIcon}
            />
            <TextInput
              ref={searchInputRef}
              accessibilityLabel="Search"
              onChangeText={setQuery}
              onFocus={openSearchPreferences}
              placeholder="What would you like to do?"
              placeholderTextColor="#949494"
              returnKeyType="search"
              showSoftInputOnFocus={false}
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
            <View style={styles.notificationBadge} />
          </Pressable>

          <Pressable
            accessibilityLabel="Profile"
            accessibilityRole="button"
            hitSlop={8}
            style={styles.profileButton}
          >
            <MaterialIcons color="#ffffff" name="account-circle" size={30} />
          </Pressable>
        </View>

        <Text style={styles.title}>Find Your Japan!</Text>
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

        {pendingApplications.length > 0 ? (
          <View style={styles.applicationList}>
            {pendingApplications.map((application) => (
              <Pressable
                key={application.id}
                accessibilityLabel={`Review application from ${application.applicantName}`}
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
                    {application.applicantName}
                  </Text>
                  <Text numberOfLines={2} style={styles.applicationBio}>
                    {application.bio}
                  </Text>
                </View>

                <View style={styles.reviewButton}>
                  <Text style={styles.reviewButtonText}>Review</Text>
                </View>
              </Pressable>
            ))}
          </View>
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
  searchIcon: {
    position: "absolute",
    left: 14.2,
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
  pressed: {
    opacity: 0.72,
  },
});
