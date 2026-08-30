import { useEffect, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
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
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";

type ReportReason = {
  key: string;
  ja: string;
  en: string;
};

const REPORT_REASONS: ReportReason[] = [
  { key: "no_show", ja: "相手が来なかった", en: "The other person didn't show up" },
  { key: "inappropriate", ja: "不快な発言・行動があった", en: "Inappropriate words or behavior" },
  { key: "unsafe", ja: "危険を感じた", en: "I felt unsafe" },
  { key: "profile_problem", ja: "写真やプロフィールに問題がある", en: "Problem with photos or profile" },
  { key: "other", ja: "その他", en: "Other" },
];

const COPY = {
  ja: {
    title: "運営に報告する",
    back: "戻る",
    selectReason: "報告理由を選択してください",
    commentPlaceholder: "補足説明（任意）",
    submit: "報告を送信",
    submitting: "送信中…",
    submitted: "報告を受け付けました",
    submittedDescription: "運営チームが確認いたします。必要に応じて追加の連絡をいたします。",
    backToResult: "結果画面に戻る",
  },
  en: {
    title: "Report to support",
    back: "Back",
    selectReason: "Select a reason for your report",
    commentPlaceholder: "Additional details (optional)",
    submit: "Submit report",
    submitting: "Submitting…",
    submitted: "Your report has been submitted.",
    submittedDescription: "Our support team will review it. We may contact you for additional information.",
    backToResult: "Back to Result",
  },
} as const;

export default function ReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const matchId = Array.isArray(id) ? id[0] : id;
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

  if (!language) {
    return <View style={styles.loadingScreen}><StatusBar style="dark" /></View>;
  }

  const copy = COPY[language];

  const handleSubmit = async () => {
    if (!selectedReason || submitting) return;
    setSubmitting(true);
    // TODO: Connect to POST /reports when backend API is ready
    // For MVP, simulate submission locally
    await new Promise((resolve) => setTimeout(resolve, 600));
    setSubmitting(false);
    setSubmitted(true);
  };

  const backToResult = () => {
    if (matchId) {
      router.replace({
        pathname: "/match-result/[id]",
        params: { id: matchId },
      });
    } else {
      router.back();
    }
  };

  if (submitted) {
    return (
      <View style={styles.screen}>
        <StatusBar style="light" />
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 18) }]}>
          <Text style={styles.headerTitle}>{copy.title}</Text>
        </View>
        <View style={styles.submittedContainer}>
          <View style={styles.submittedIconCircle}>
            <MaterialIcons color="#3d9a68" name="check-circle" size={44} />
          </View>
          <Text style={styles.submittedTitle}>{copy.submitted}</Text>
          <Text style={styles.submittedDescription}>{copy.submittedDescription}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={backToResult}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>{copy.backToResult}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 18) }]}>
        <Pressable
          accessibilityLabel={copy.back}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="arrow-back-ios-new" size={20} />
        </Pressable>
        <Text style={styles.headerTitle}>{copy.title}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.selectReasonLabel}>{copy.selectReason}</Text>

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
                  styles.reasonCard,
                  selected && styles.reasonCardSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                  {language === "ja" ? reason.ja : reason.en}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          accessibilityLabel={copy.commentPlaceholder}
          multiline
          onChangeText={setComment}
          placeholder={copy.commentPlaceholder}
          placeholderTextColor={MUTED_GRAY}
          style={styles.commentInput}
          textAlignVertical="top"
          value={comment}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !selectedReason || submitting }}
          disabled={!selectedReason || submitting}
          onPress={() => void handleSubmit()}
          style={({ pressed }) => [
            styles.primaryButton,
            (!selectedReason || submitting) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {submitting ? <ActivityIndicator color="#ffffff" size="small" /> : null}
          <Text style={styles.primaryButtonText}>
            {submitting ? copy.submitting : copy.submit}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
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
  selectReasonLabel: { alignSelf: "stretch", color: TEXT_GRAY, fontSize: 15, fontWeight: "800", maxWidth: 390 },
  reasonList: { width: "100%", maxWidth: 390, gap: 10 },
  reasonCard: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 12,
    backgroundColor: "#ffffff",
  },
  reasonCardSelected: { borderColor: BLUE, backgroundColor: "#f5fbff" },
  radioOuter: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: BORDER_GRAY,
    borderRadius: 11,
  },
  radioOuterSelected: { borderColor: BLUE },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: BLUE },
  reasonText: { flex: 1, color: TEXT_GRAY, fontSize: 14, fontWeight: "600" },
  reasonTextSelected: { color: BLUE, fontWeight: "800" },
  commentInput: {
    width: "100%",
    maxWidth: 390,
    minHeight: 90,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 12,
    color: TEXT_GRAY,
    fontSize: 14,
    backgroundColor: "#ffffff",
  },
  primaryButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.72 },
  submittedContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 16,
  },
  submittedIconCircle: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 36,
    backgroundColor: "#eef8f2",
  },
  submittedTitle: { color: TEXT_GRAY, fontSize: 20, fontWeight: "900", textAlign: "center" },
  submittedDescription: { color: MUTED_GRAY, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 300 },
});
