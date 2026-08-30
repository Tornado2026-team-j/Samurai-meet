import { useEffect, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
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
const SOFT_BLUE = "#eff8ff";

// TODO: Replace mock monsters with real data from monsters API
const MOCK_MY_MONSTER = { emoji: "🐉", name: "Fire Dragon", color: "#ff6b6b" };
const MOCK_THEIR_MONSTER = { emoji: "🦋", name: "Mystic Butterfly", color: "#9775fa" };

const COPY = {
  ja: {
    title: "モンスターを交換",
    back: "戻る",
    exchanging: "モンスターを交換中…",
    myMonster: "あなたのモンスター",
    theirMonster: "相手のモンスター",
    completeTitle: "モンスターを交換しました！",
    completeDescription: "相手のモンスターを保管庫に追加しました。",
    viewStorage: "保管庫を見る",
    backToResult: "結果画面に戻る",
    storageAlert: "保管庫は今後のアップデートで利用可能になります。",
  },
  en: {
    title: "Exchange Monsters",
    back: "Back",
    exchanging: "Exchanging Monsters...",
    myMonster: "Your monster",
    theirMonster: "Their monster",
    completeTitle: "Monster exchanged!",
    completeDescription: "The other user's monster was added to your storage.",
    viewStorage: "View Storage",
    backToResult: "Back to Result",
    storageAlert: "Storage will be available in a future update.",
  },
} as const;

export default function ExchangeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const matchId = Array.isArray(id) ? id[0] : id;
  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [exchangeDone, setExchangeDone] = useState(false);

  const leftAnim = useRef(new Animated.Value(0)).current;
  const rightAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    if (!language) return;

    // TODO: Replace with real monster trade API call
    // For MVP, simulate the exchange with animation
    Animated.parallel([
      Animated.timing(leftAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: false,
      }),
      Animated.timing(rightAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: false,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: false,
      }),
    ]).start(() => {
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1.15,
          duration: 300,
          useNativeDriver: false,
        }),
      ]).start(() => {
        setExchangeDone(true);
        setShowComplete(true);
      });
    });
  }, [language, fadeAnim, leftAnim, rightAnim, scaleAnim]);

  if (!language) {
    return <View style={styles.loadingScreen}><StatusBar style="dark" /></View>;
  }

  const copy = COPY[language];

  const leftInterpolate = leftAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 0],
  });
  const rightInterpolate = rightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [80, 0],
  });
  const arrowOpacity = fadeAnim;

  const goReview = () => {
    setShowComplete(false);
    if (matchId) {
      router.push({
        pathname: "/match-result/[id]/review",
        params: { id: matchId },
      });
    }
  };

  const viewStorage = () => {
    // TODO: Navigate to storage screen when it exists
    // For MVP, just dismiss the modal
    setShowComplete(false);
  };

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

      <View style={styles.exchangeStage}>
        <View style={styles.monsterRow}>
          {/* My monster (left, moves right) */}
          <Animated.View
            style={[
              styles.monsterContainer,
              {
                transform: [{ translateX: leftInterpolate }, { scale: scaleAnim }],
              },
            ]}
          >
            <Text style={styles.monsterLabel}>{copy.myMonster}</Text>
            <View style={[styles.monsterCard, { borderColor: MOCK_MY_MONSTER.color }]}>
              <Text style={styles.monsterEmoji}>{MOCK_MY_MONSTER.emoji}</Text>
            </View>
            <Text style={styles.monsterName}>{MOCK_MY_MONSTER.name}</Text>
          </Animated.View>

          {/* Center arrow */}
          <Animated.View style={[styles.arrowContainer, { opacity: arrowOpacity }]}>
            <MaterialIcons
              color={exchangeDone ? YELLOW : BLUE}
              name={exchangeDone ? "cached" : "sync"}
              size={32}
            />
          </Animated.View>

          {/* Their monster (right, moves left) */}
          <Animated.View
            style={[
              styles.monsterContainer,
              {
                transform: [{ translateX: rightInterpolate }, { scale: scaleAnim }],
              },
            ]}
          >
            <Text style={styles.monsterLabel}>{copy.theirMonster}</Text>
            <View style={[styles.monsterCard, { borderColor: MOCK_THEIR_MONSTER.color }]}>
              <Text style={styles.monsterEmoji}>{MOCK_THEIR_MONSTER.emoji}</Text>
            </View>
            <Text style={styles.monsterName}>{MOCK_THEIR_MONSTER.name}</Text>
          </Animated.View>
        </View>

        {!exchangeDone ? (
          <Text style={styles.exchangingText}>{copy.exchanging}</Text>
        ) : null}
      </View>

      {/* Completion modal */}
      <Modal
        animationType="fade"
        onRequestClose={() => setShowComplete(false)}
        transparent
        visible={showComplete}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.completePanel}>
            <View style={styles.completeIconCircle}>
              <MaterialIcons color="#3d9a68" name="check-circle" size={44} />
            </View>
            <Text style={styles.completeTitle}>{copy.completeTitle}</Text>
            <Text style={styles.completeDescription}>{copy.completeDescription}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={viewStorage}
              style={({ pressed }) => [styles.storageButton, pressed && styles.pressed]}
            >
              <Text style={styles.storageButtonText}>{copy.viewStorage}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={goReview}
              style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]}
            >
              <Text style={styles.reviewButtonText}>{copy.backToResult}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  exchangeStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 40,
  },
  monsterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  monsterContainer: { alignItems: "center", gap: 10 },
  monsterLabel: { color: MUTED_GRAY, fontSize: 12, fontWeight: "700" },
  monsterCard: {
    width: 100,
    height: 100,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderRadius: 50,
    backgroundColor: SOFT_BLUE,
  },
  monsterEmoji: { fontSize: 42 },
  monsterName: { color: TEXT_GRAY, fontSize: 13, fontWeight: "800", textAlign: "center" },
  arrowContainer: { alignItems: "center", justifyContent: "center" },
  exchangingText: { color: BLUE, fontSize: 16, fontWeight: "800", textAlign: "center" },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  completePanel: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    gap: 14,
    padding: 28,
    borderWidth: 1,
    borderColor: "#cfe9f7",
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  completeIconCircle: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 36,
    backgroundColor: "#eef8f2",
  },
  completeTitle: { color: TEXT_GRAY, fontSize: 20, fontWeight: "900", textAlign: "center" },
  completeDescription: { color: MUTED_GRAY, fontSize: 14, lineHeight: 21, textAlign: "center" },
  storageButton: {
    width: "100%",
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  storageButtonText: { color: BLUE, fontSize: 14, fontWeight: "800" },
  reviewButton: {
    width: "100%",
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  reviewButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
  pressed: { opacity: 0.72 },
});
