import { useEffect, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
import { loadLanguage, subscribeLanguage } from "../../../services/onboarding";
import type { AppLanguage } from "../../../services/onboarding-contract";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const GREEN = "#3d9a68";
const LIGHT_GREEN = "#C6EDC9";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#8e8e93";
const BORDER_GRAY = "#d9d9d9";

type ReportReason = {
  key: string;
  ja: string;
  en: string;
};

const REPORT_REASONS: ReportReason[] = [
  {
    key: "no_show",
    ja: "相手が来なかった",
    en: "The other person didn't show up",
  },
  {
    key: "inappropriate",
    ja: "不快な発言・行動があった",
    en: "Inappropriate words or behavior",
  },
  {
    key: "unsafe",
    ja: "危険を感じた",
    en: "I felt unsafe",
  },
  {
    key: "profile_problem",
    ja: "写真やプロフィールに問題がある",
    en: "Problem with photos or profile",
  },
  {
    key: "other",
    ja: "その他",
    en: "Other",
  },
];

const COPY = {
  ja: {
    header: "Report to support",
    title: "運営に報告する",
    selectReason: "報告理由を選択してください",
    details: "補足説明（任意）",
    submit: "報告を送信",
    submitting: "送信中…",
    submittedHeader: "Report submitted",
    submitted: "報告を受け付けました。",
    submittedDescription:
      "運営チームが内容を確認します。必要に応じて追加のご連絡をする場合があります。",
    backHome: "ホームに戻る",
  },
  en: {
    header: "Report to support",
    title: "Report to support",
    selectReason: "Select a reason for your report",
    details: "Additional details (optional)",
    submit: "Submit report",
    submitting: "Submitting…",
    submittedHeader: "Report submitted",
    submitted: "Your report has been submitted.",
    submittedDescription:
      "Our support team will review your report. We may contact you if more information is needed.",
    backHome: "Back to Home",
  },
} as const;

export default function ReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;

    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage ?? "ja");
    });

    void loadLanguage()
      .then((storedLanguage) => {
        if (active) setLanguage(storedLanguage ?? "ja");
      })
      .catch(() => {
        if (active) setLanguage("ja");
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!language) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
      </View>
    );
  }

  const copy = COPY[language];

  const handleSubmit = async () => {
    if (!selectedReason || submitting) return;

    setSubmitting(true);

    // TODO:
    // Backend API 完成後に POST /reports へ接続する
    await new Promise((resolve) => setTimeout(resolve, 500));

    setSubmitting(false);
    setSubmitted(true);
  };

  const goHome = () => {
    router.replace("/japanese");
  };

  if (submitted) {
    return (
      <View style={styles.screen}>
        <StatusBar style="light" />

        <View
          style={[
            styles.header,
            { paddingTop: Math.max(insets.top, 24) },
          ]}
        >
          <Text style={styles.headerTitle}>
            {copy.submittedHeader}
          </Text>
        </View>

        <View style={styles.submittedContainer}>
          <View style={styles.checkCircle}>
            <MaterialIcons
              name="check"
              size={52}
              color={GREEN}
            />
          </View>

          <Text style={styles.submittedTitle}>
            {copy.submitted}
          </Text>

          <Text style={styles.submittedDescription}>
            {copy.submittedDescription}
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={goHome}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {copy.backHome}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top, 24) },
        ]}
      >
        <Text style={styles.headerTitle}>{copy.header}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{copy.title}</Text>

        <Text style={styles.selectReasonLabel}>
          {copy.selectReason}
        </Text>

        <View style={styles.reasonList}>
          {REPORT_REASONS.map((reason) => {
            const selected = selectedReason === reason.key;

            return (
              <Pressable
                key={reason.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSelectedReason(reason.key)}
                style={({ pressed }) => [
                  styles.reasonRow,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.radioOuter,
                    selected && styles.radioOuterSelected,
                  ]}
                >
                  {selected ? (
                    <View style={styles.radioInner} />
                  ) : null}
                </View>

                <Text style={styles.reasonText}>
                  {language === "ja" ? reason.ja : reason.en}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          multiline
          value={comment}
          onChangeText={setComment}
          placeholder={copy.details}
          placeholderTextColor={MUTED_GRAY}
          style={styles.commentInput}
          textAlignVertical="top"
        />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled: !selectedReason || submitting,
          }}
          disabled={!selectedReason || submitting}
          onPress={() => void handleSubmit()}
          style={({ pressed }) => [
            styles.primaryButton,
            (!selectedReason || submitting) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {submitting ? (
            <ActivityIndicator
              size="small"
              color="#000000"
            />
          ) : null}

          <Text style={styles.primaryButtonText}>
            {submitting ? copy.submitting : copy.submit}
          </Text>
        </Pressable>
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
    backgroundColor: "#ffffff",
  },

  header: {
    minHeight: 156,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 24,
    backgroundColor: BLUE,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
  },

  headerTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },

  content: {
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 30,
  },

  title: {
    color: "#000000",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },

  selectReasonLabel: {
    width: "100%",
    maxWidth: 330,
    marginTop: 28,
    color: TEXT_GRAY,
    fontSize: 16,
    fontWeight: "800",
  },

  reasonList: {
    width: "100%",
    maxWidth: 330,
    marginTop: 18,
  },

  reasonRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },

  radioOuter: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
    borderWidth: 2,
    borderColor: "#bcbcbc",
    borderRadius: 11,
    backgroundColor: "#ffffff",
  },

  radioOuterSelected: {
    borderColor: BLUE,
  },

  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: BLUE,
  },

  reasonText: {
    flex: 1,
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },

  commentInput: {
    width: "100%",
    maxWidth: 330,
    minHeight: 110,
    marginTop: 24,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 14,
    color: TEXT_GRAY,
    fontSize: 14,
    backgroundColor: "#ffffff",
  },

  primaryButton: {
    width: "100%",
    maxWidth: 330,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 34,
    borderRadius: 16,
    backgroundColor: YELLOW,
  },

  primaryButtonText: {
    color: "#000000",
    fontSize: 18,
    fontWeight: "900",
  },

  submittedContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 34,
  },

  checkCircle: {
    width: 104,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 52,
    backgroundColor: LIGHT_GREEN,
  },

  submittedTitle: {
    marginTop: 26,
    color: "#000000",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },

  submittedDescription: {
    marginTop: 16,
    maxWidth: 300,
    color: MUTED_GRAY,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
    textAlign: "center",
  },

  disabled: {
    opacity: 0.55,
  },

  pressed: {
    opacity: 0.72,
  },
});
