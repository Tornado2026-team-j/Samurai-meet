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
const MOCK_MY_MONSTER = { emoji: "🐳", name: "Blue Monster", color: "#5ec5f5" };
const MOCK_THEIR_MONSTER = { emoji: "🐷", name: "Pink Monster", color: "#f58eaa" }; 

const COPY = {
  ja: {
    title: "モンスターを交換",
    back: "戻る",
    exchanging: "モンスターを交換中…",
    wait: "少々お待ちください。",
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
    wait: "Please wait a moment.",
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
        {!exchangeDone ? (
          <>
            <Text style={styles.exchangingText}>{copy.exchanging}</Text>
            <Text style={styles.waitText}>{copy.wait}</Text>
          </>
        ) : null}

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
              color={YELLOW}
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
    minHeight: 156,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingBottom: 24,
    backgroundColor: BLUE,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
  },
  backButton: { position: "absolute", left: 20, bottom: 20, width: 34, height: 34, alignItems: "center", justifyContent: "center", opacity: 0 },
  headerTitle: { color: "#ffffff", fontSize: 20, fontWeight: "900" },
  exchangeStage: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  monsterRow: {
    width: "100%",
    height: 317,
    marginTop: 66,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 160,
    backgroundColor: "#fff7e6",
  },
  monsterContainer: { alignItems: "center", gap: 4 },
  monsterLabel: { display: "none" },
  monsterCard: {
    width: 112,
    height: 150,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  monsterEmoji: { fontSize: 82 },
  monsterName: { display: "none" },
  arrowContainer: { alignItems: "center", justifyContent: "center", marginHorizontal: -2 },
  exchangingText: { marginTop: 30, color: "#000000", fontSize: 24, fontWeight: "900", textAlign: "center" },
  waitText: { marginTop: 19, color: "#8e8e93", fontSize: 18, fontWeight: "900", textAlign: "center" },
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
    gap: 16,
    padding: 28,
    borderRadius: 28,
    backgroundColor: "#ffffff",
    shadowColor: "#24556b",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  completeIconCircle: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 38,
    backgroundColor: "#fff7e6",
  },
  completeTitle: { color: "#000000", fontSize: 22, fontWeight: "900", textAlign: "center" },
  completeDescription: { color: "#8e8e93", fontSize: 15, lineHeight: 22, textAlign: "center" },
  storageButton: {
    width: "100%",
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: BLUE,
    borderRadius: 14,
    backgroundColor: "#ffffff",
  },
  storageButtonText: { color: BLUE, fontSize: 15, fontWeight: "900" },
  reviewButton: {
    width: "100%",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: YELLOW,
  },
  reviewButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
  pressed: { opacity: 0.72 },
});
