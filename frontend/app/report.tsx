import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Header, colors, radius } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import type { ChatReportReason, SafetyReportTargetType } from "../services/chat";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../services/onboarding";
import { reportSafetyIssue } from "../services/safety";

const REASONS: Record<AppLanguage, Array<{ key: ChatReportReason; label: string }>> = {
  ja: [
    { key: "nuisance", label: "迷惑行為・スパム" }, { key: "harassment", label: "嫌がらせ・差別的な言動" },
    { key: "impersonation", label: "なりすまし" }, { key: "inappropriate_photo", label: "不適切な画像" },
    { key: "dangerous", label: "危険な行為・場所" }, { key: "other", label: "その他" },
  ],
  en: [
    { key: "nuisance", label: "Nuisance or spam" }, { key: "harassment", label: "Harassment or discriminatory behavior" },
    { key: "impersonation", label: "Impersonation" }, { key: "inappropriate_photo", label: "Inappropriate photo" },
    { key: "dangerous", label: "Dangerous behavior or location" }, { key: "other", label: "Other" },
  ],
};

const COPY: Record<AppLanguage, { title: string; namedTitle: (name: string) => string; description: string; optionalDetails: string; placeholder: string; submitting: string; submit: string; error: string }> = {
  ja: { title: "通報", namedTitle: (name) => `${name}について報告`, description: "相手には通報者の情報は表示されません。最も近い理由を1つ選んでください。", optionalDetails: "補足（任意）", placeholder: "状況を具体的に入力してください", submitting: "送信中...", submit: "運営へ送信", error: "通報を送信できませんでした。時間をおいて再試行してください。" },
  en: { title: "Report", namedTitle: (name) => `Report ${name}`, description: "The person you report will not see your information. Choose the closest reason.", optionalDetails: "Additional details (optional)", placeholder: "Describe what happened", submitting: "Sending...", submit: "Send to Operations", error: "The report could not be sent. Please try again later." },
};

export default function ReportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string; name?: string }>();
  const { getCurrentSession, session } = useAuth();
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const copy = COPY[language];
  const targetType = (params.targetType === "recruitment_card" ? "recruitment_card" : "user") as SafetyReportTargetType;

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => { if (active) setLanguage(nextLanguage ?? "ja"); });
    void loadLanguage().then((storedLanguage) => { if (active) setLanguage(storedLanguage ?? "ja"); }).catch(() => { if (active) setLanguage("ja"); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const submit = async () => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || !params.targetId || !reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportSafetyIssue(activeSession, {
        target_type: targetType,
        target_id: params.targetId,
        reason,
        comment: comment.trim(),
      });
      router.back();
    } catch {
      setError(copy.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="report-problem" onBack={() => router.back()} title={copy.title} variant="hero" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{params.name ? copy.namedTitle(params.name) : copy.title}</Text>
        <Text style={styles.description}>{copy.description}</Text>
        <View style={styles.reasons}>
          {REASONS[language].map((item) => (
            <Pressable key={item.key} onPress={() => setReason(item.key)} style={[styles.reason, reason === item.key && styles.reasonSelected]}>
              <MaterialIcons color={reason === item.key ? colors.brand.sky : colors.text.muted} name={reason === item.key ? "radio-button-checked" : "radio-button-unchecked"} size={22} />
              <Text style={styles.reasonText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>{copy.optionalDetails}</Text>
        <TextInput
          maxLength={500}
          multiline
          onChangeText={setComment}
          placeholder={copy.placeholder}
          placeholderTextColor={colors.text.muted}
          style={styles.input}
          value={comment}
        />
        <Text style={styles.count}>{comment.length} / 500</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable disabled={!reason || submitting} onPress={() => void submit()} style={[styles.submit, (!reason || submitting) && styles.disabled]}>
          <Text style={styles.submitText}>{submitting ? copy.submitting : copy.submit}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { padding: 22, paddingBottom: 48 },
  title: { color: colors.text.primary, fontSize: 20, fontWeight: "900" },
  description: { marginTop: 8, color: colors.text.subtle, fontSize: 13, lineHeight: 20 },
  reasons: { marginTop: 20, gap: 8 },
  reason: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.md, backgroundColor: colors.surface.default },
  reasonSelected: { borderColor: colors.brand.sky, backgroundColor: colors.surface.blueSoft },
  reasonText: { flex: 1, color: colors.text.secondary, fontSize: 14, fontWeight: "700" },
  label: { marginTop: 22, marginBottom: 8, color: colors.text.secondary, fontSize: 13, fontWeight: "800" },
  input: { minHeight: 120, padding: 14, borderWidth: 1, borderColor: colors.border.default, borderRadius: radius.md, color: colors.text.primary, fontSize: 14, textAlignVertical: "top" },
  count: { marginTop: 5, color: colors.text.muted, fontSize: 11, textAlign: "right" },
  error: { marginTop: 12, color: colors.state.danger, fontSize: 13, fontWeight: "700" },
  submit: { minHeight: 50, marginTop: 18, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.state.danger },
  submitText: { color: colors.text.inverse, fontSize: 15, fontWeight: "900" },
  disabled: { opacity: 0.45 },
});
