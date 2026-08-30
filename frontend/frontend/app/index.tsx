import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";

export default function IndexScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 24) }]}>
        <Text style={styles.headerTitle}>Samurai Meet</Text>
        <Text style={styles.headerSubtitle}>案内終了後の結果フロー</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>Preview</Text>
        <Text style={styles.sectionDescription}>
         案内結果フローの各画面を確認できます。
        </Text>

        <Link href="/match-result/demo" asChild>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>結果フローを開始</Text>
          </Pressable>
        </Link>

        <Link href="/match-result/demo/exchange" asChild>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>モンスター交換</Text>
          </Pressable>
        </Link>

        <Link href="/match-result/demo/review" asChild>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>相互評価</Text>
          </Pressable>
        </Link>

        <Link href="/match-result/demo/report" asChild>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>運営への報告</Text>
          </Pressable>
        </Link>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  header: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 24,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    backgroundColor: BLUE,
  },
  headerTitle: { color: "#ffffff", fontSize: 28, fontWeight: "900" },
  headerSubtitle: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "700" },
  content: { alignItems: "center", paddingHorizontal: 18, paddingTop: 28, gap: 14 },
  sectionTitle: { color: TEXT_GRAY, fontSize: 18, fontWeight: "900" },
  sectionDescription: { color: MUTED_GRAY, fontSize: 13, lineHeight: 19, textAlign: "center" },
  primaryButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: YELLOW,
    marginTop: 8,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "900" },
  secondaryButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  secondaryButtonText: { color: BLUE, fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.72 },
});
