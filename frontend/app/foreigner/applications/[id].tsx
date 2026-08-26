import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  findMockGuideApplicationById,
  MOCK_GUIDE_APPLICATIONS,
} from "../../../mocks/applications";
import type { GuideApplicationStatus } from "../../../types/application";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

export default function ForeignerApplicationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const applicationId = Array.isArray(id) ? id[0] : id;
  const application =
    findMockGuideApplicationById(applicationId) ?? MOCK_GUIDE_APPLICATIONS[0];
  const [decision, setDecision] = useState<GuideApplicationStatus>(
    application?.status ?? "pending",
  );

  if (!application) {
    return null;
  }

  const choseGuide = decision === "accepted";
  const declined = decision === "declined";
  const decided = choseGuide || declined;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
        </Pressable>

        <Text style={styles.headerTitle}>Application detail</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <MaterialIcons color="#d4d4d4" name="account-circle" size={92} />
          </View>

          <Text numberOfLines={1} style={styles.name}>
            {application.applicantName}
          </Text>
          <Text style={styles.country}>{application.applicantCountry}</Text>

          <View style={styles.divider} />

          <Text style={styles.sectionLabel}>About this guide</Text>
          <Text style={styles.bio}>{application.bio}</Text>
        </View>
      </ScrollView>

      <View style={styles.bottomActions}>
        {decided ? (
          <View
            accessibilityRole="text"
            style={[styles.resultBanner, declined && styles.resultBannerDeclined]}
          >
            <MaterialIcons
              color={choseGuide ? BLUE : MUTED_GRAY}
              name={choseGuide ? "verified" : "block"}
              size={21}
            />
            <Text
              style={[
                styles.resultText,
                declined && styles.resultTextDeclined,
              ]}
            >
              {choseGuide ? "Guide chosen" : "Application declined"}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: decided }}
          disabled={decided}
          onPress={() => setDecision("accepted")}
          style={({ pressed }) => [
            styles.primaryButton,
            decided && styles.disabledButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>Choose this guide</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: decided }}
          disabled={decided}
          onPress={() => setDecision("declined")}
          style={({ pressed }) => [
            styles.secondaryButton,
            decided && styles.disabledSecondaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.secondaryButtonText,
              decided && styles.disabledSecondaryButtonText,
            ]}
          >
            Decline
          </Text>
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
  header: {
    position: "relative",
    height: 214,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 36,
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
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 32,
    textAlign: "center",
  },
  content: {
    alignItems: "center",
    paddingTop: 44,
    paddingHorizontal: 24,
    paddingBottom: 210,
  },
  profileCard: {
    width: "100%",
    maxWidth: 342,
    alignItems: "center",
    paddingTop: 28,
    paddingRight: 24,
    paddingBottom: 30,
    paddingLeft: 24,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  avatarCircle: {
    width: 108,
    height: 108,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 54,
    backgroundColor: "#ffffff",
  },
  name: {
    maxWidth: "100%",
    marginTop: 20,
    color: "#101318",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 30,
    textAlign: "center",
  },
  country: {
    marginTop: 4,
    color: MUTED_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 17,
  },
  divider: {
    width: "100%",
    height: 1,
    marginTop: 24,
    backgroundColor: BORDER_GRAY,
  },
  sectionLabel: {
    alignSelf: "flex-start",
    marginTop: 22,
    color: BLUE,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 17,
  },
  bio: {
    marginTop: 10,
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 22,
  },
  bottomActions: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    paddingTop: 18,
    paddingRight: 32,
    paddingBottom: 34,
    paddingLeft: 32,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    backgroundColor: "#ffffff",
  },
  resultBanner: {
    width: "100%",
    maxWidth: 326,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#caeafd",
    borderRadius: 10,
    backgroundColor: SOFT_BLUE,
  },
  resultBannerDeclined: {
    borderColor: BORDER_GRAY,
    backgroundColor: "#f7f7f7",
  },
  resultText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 17,
  },
  resultTextDeclined: {
    color: MUTED_GRAY,
  },
  primaryButton: {
    width: "100%",
    maxWidth: 326,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  secondaryButton: {
    width: "100%",
    maxWidth: 326,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  secondaryButtonText: {
    color: BLUE,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  disabledButton: {
    borderColor: BORDER_GRAY,
    backgroundColor: BORDER_GRAY,
  },
  disabledSecondaryButton: {
    borderColor: BORDER_GRAY,
  },
  disabledSecondaryButtonText: {
    color: MUTED_GRAY,
  },
  pressed: {
    opacity: 0.72,
  },
});
