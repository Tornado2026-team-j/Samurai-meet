import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";

export default function ForeignerHomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 24) }]}>
        <Text style={styles.headerTitle}>Home</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.welcomeText}>Samurai Meet</Text>
        <Link href="/match-result/demo" asChild>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>View Guide Result</Text>
          </Pressable>
        </Link>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  header: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 18,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    backgroundColor: BLUE,
  },
  headerTitle: { color: "#ffffff", fontSize: 22, fontWeight: "900" },
  content: { alignItems: "center", paddingHorizontal: 18, paddingTop: 28, gap: 14 },
  welcomeText: { color: TEXT_GRAY, fontSize: 18, fontWeight: "800" },
  primaryButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "900" },
  pressed: { opacity: 0.72 },
});
