import { useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import type { AppLanguage } from "../services/onboarding-contract";
import { Button, colors, opacity, radius, typography } from "./ui";

type IdentityVerificationPromptProps = {
  language: AppLanguage;
  onLater: () => Promise<void>;
  onProceed: () => Promise<void>;
};

export default function IdentityVerificationPrompt({
  language,
  onLater,
  onProceed,
}: IdentityVerificationPromptProps) {
  const insets = useSafeAreaInsets();
  const [pendingAction, setPendingAction] = useState<"proceed" | "later" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = language === "ja"
    ? {
        eyebrow: "任意のステップ",
        title: "本人確認をしますか？",
        subtitle: "より安心して交流を始めるために",
        recommendation: "本人確認をおすすめします",
        description:
          "本人確認済みであることは、相手が交流を始める際の安心材料になります。確認後はプロフィールや募集カードに本人確認済みの状態が表示されます。",
        privacy: "確認書類や個人情報が、ほかのユーザーに公開されることはありません。",
        caution: "本人確認済みの表示は、相手の安全性を保証するものではありません。",
        proceed: "本人確認に進む",
        later: "あとで行う",
        error: "選択を保存できませんでした。もう一度お試しください。",
      }
    : {
        eyebrow: "OPTIONAL STEP",
        title: "Verify your identity?",
        subtitle: "Help everyone connect with greater confidence",
        recommendation: "Identity verification is recommended",
        description:
          "A verified status gives others more context when deciding to connect. Once approved, your status can appear on your profile and recruitment cards.",
        privacy: "Your identity documents and personal details are never shown to other users.",
        caution: "A verified status does not guarantee another person's safety.",
        proceed: "Continue to verification",
        later: "Do this later",
        error: "We could not save your choice. Please try again.",
      };

  const run = async (
    action: "proceed" | "later",
    operation: () => Promise<void>,
  ) => {
    if (pendingAction) return;
    setError(null);
    setPendingAction(action);
    try {
      await operation();
    } catch {
      setError(copy.error);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { paddingTop: Math.max(insets.top, 20) }]}>
          <View style={styles.shieldCircle}>
            <MaterialIcons color={colors.text.inverse} name="verified-user" size={58} />
          </View>
          <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>
        </View>

        <View style={styles.content}>
          <View>
            <Text style={styles.recommendation}>{copy.recommendation}</Text>
            <Text style={styles.description}>{copy.description}</Text>

            <View style={styles.assuranceList}>
              <View style={styles.assuranceRow}>
                <MaterialIcons color={colors.brand.sky} name="lock-outline" size={22} />
                <Text style={styles.assuranceText}>{copy.privacy}</Text>
              </View>
              <View style={styles.assuranceRow}>
                <MaterialIcons color={colors.text.subtle} name="info-outline" size={22} />
                <Text style={styles.assuranceText}>{copy.caution}</Text>
              </View>
            </View>

            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <Button
              disabled={pendingAction !== null}
              iconLeft={<MaterialIcons color={colors.text.inverse} name="verified-user" size={21} />}
              loading={pendingAction === "proceed"}
              onPress={() => void run("proceed", onProceed)}
              size="lg"
              style={styles.primaryButton}
              textStyle={styles.primaryButtonText}
            >
              {copy.proceed}
            </Button>

            <Button
              disabled={pendingAction !== null}
              loading={pendingAction === "later"}
              onPress={() => void run("later", onLater)}
              size="lg"
              style={styles.secondaryButton}
              textStyle={styles.secondaryButtonText}
              variant="secondary"
            >
              {copy.later}
            </Button>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.screen,
  },
  scrollContent: {
    flexGrow: 1,
  },
  hero: {
    minHeight: 350,
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderBottomLeftRadius: 44,
    borderBottomRightRadius: 44,
    backgroundColor: colors.brand.sky,
  },
  shieldCircle: {
    width: 106,
    height: 106,
    marginBottom: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.82)",
    borderRadius: 53,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  eyebrow: {
    marginBottom: 6,
    color: "rgba(255, 255, 255, 0.84)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0,
  },
  title: {
    color: colors.text.inverse,
    ...typography.title1,
    textAlign: "center",
  },
  subtitle: {
    maxWidth: 330,
    marginTop: 8,
    color: "rgba(255, 255, 255, 0.94)",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    letterSpacing: 0,
    textAlign: "center",
  },
  content: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    paddingTop: 27,
    paddingHorizontal: 24,
    paddingBottom: 25,
    alignSelf: "center",
    justifyContent: "space-between",
  },
  recommendation: {
    color: colors.text.secondary,
    ...typography.heading,
  },
  description: {
    marginTop: 10,
    color: colors.text.secondary,
    ...typography.caption,
    fontWeight: "400",
    lineHeight: 21,
  },
  assuranceList: {
    marginTop: 20,
    gap: 13,
  },
  assuranceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  assuranceText: {
    flex: 1,
    color: colors.text.subtle,
    ...typography.small,
    fontWeight: "400",
    lineHeight: 19,
  },
  error: {
    marginTop: 16,
    color: colors.state.danger,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
    textAlign: "center",
  },
  actions: {
    width: "100%",
    marginTop: 28,
    gap: 11,
  },
  primaryButton: {
    minHeight: 54,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: radius.sm,
  },
  primaryButtonText: {
    color: colors.text.inverse,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
  },
  secondaryButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.default,
  },
  secondaryButtonText: {
    color: colors.text.secondary,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
