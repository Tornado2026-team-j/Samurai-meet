import { useEffect, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Animated,
  Image,
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
const GREEN = "#3d9a68";
const LIGHT_GREEN = "#C6EDC9";
const CREAM = "#FFF7E6";
const MUTED_GRAY = "#8e8e93";

type MonsterView = {
  id: string;
  name: string;
  imageUrl?: string;
  color: string;
};

// TODO:
// モンスターAPI完成後に、ログイン中ユーザーとマッチ相手の
// 実際のモンスターデータへ置き換える。
const myMonster: MonsterView = {
  id: "mock-my-monster",
  name: "My Monster",
  imageUrl: undefined,
  color: "#5ec5f5",
};

const theirMonster: MonsterView = {
  id: "mock-their-monster",
  name: "Partner's Monster",
  imageUrl: undefined,
  color: "#f58eaa",
};

const COPY = {
  ja: {
    header: "Monster Exchange",
    exchanging: "モンスターを交換中…",
    wait: "少々お待ちください。",
    completeTitle: "モンスターを交換しました！",
    completeDescription: "相手のモンスターを保管庫に追加しました。",
    viewStorage: "保管庫を見る",
    backToResult: "結果画面に戻る",
  },
  en: {
    header: "Monster Exchange",
    exchanging: "Exchanging Monsters...",
    wait: "Please wait a moment.",
    completeTitle: "Monster Exchanged!!",
    completeDescription:
      "The other user's monster has been added to your storage.",
    viewStorage: "View Storage",
    backToResult: "Back to Result",
  },
} as const;

function MonsterImage({ monster }: { monster: MonsterView }) {
  if (monster.imageUrl) {
    return (
      <Image
        source={{ uri: monster.imageUrl }}
        style={styles.monsterImage}
        resizeMode="contain"
      />
    );
  }

  return (
    <View
      style={[
        styles.monsterPlaceholder,
        { backgroundColor: monster.color },
      ]}
    >
      <MaterialIcons name="pets" size={54} color="#ffffff" />
    </View>
  );
}

export default function ExchangeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const matchId = Array.isArray(id) ? id[0] : id;

  const [language, setLanguage] = useState<AppLanguage | null>(null);
  const [showComplete, setShowComplete] = useState(false);

  const leftAnim = useRef(new Animated.Value(-55)).current;
  const rightAnim = useRef(new Animated.Value(55)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    if (!language) return;

    Animated.parallel([
      Animated.timing(leftAnim, {
        toValue: 0,
        duration: 1100,
        useNativeDriver: true,
      }),
      Animated.timing(rightAnim, {
        toValue: 0,
        duration: 1100,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 650,
        useNativeDriver: true,
      }),
    ]).start(() => {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.1,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setTimeout(() => setShowComplete(true), 300);
      });
    });
  }, [fadeAnim, language, leftAnim, rightAnim, scaleAnim]);

  if (!language) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
      </View>
    );
  }

  const copy = COPY[language];

  const goReview = () => {
    setShowComplete(false);

    if (!matchId) return;

    router.push({
      pathname: "/match-result/[id]/review",
      params: { id: matchId },
    });
  };

  const viewStorage = () => {
    // TODO: 保管庫画面実装後に遷移へ変更
    setShowComplete(false);
  };

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

      <View style={styles.content}>
        <Text style={styles.exchangingText}>{copy.exchanging}</Text>
        <Text style={styles.waitText}>{copy.wait}</Text>

        <View style={styles.stage}>
          <Animated.View
            style={[
              styles.monsterContainer,
              {
                transform: [
                  { translateX: leftAnim },
                  { scale: scaleAnim },
                ],
              },
            ]}
          >
            <MonsterImage monster={myMonster} />
          </Animated.View>

          <Animated.View
            style={[
              styles.arrowCircle,
              { opacity: fadeAnim },
            ]}
          >
            <MaterialIcons
              name="sync"
              size={42}
              color={YELLOW}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.monsterContainer,
              {
                transform: [
                  { translateX: rightAnim },
                  { scale: scaleAnim },
                ],
              },
            ]}
          >
            <MonsterImage monster={theirMonster} />
          </Animated.View>
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={showComplete}
        onRequestClose={() => setShowComplete(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.completePanel}>
            <View style={styles.completeIconCircle}>
              <MaterialIcons name="check" size={48} color={GREEN} />
            </View>

            <Text style={styles.completeTitle}>
              {copy.completeTitle}
            </Text>

            <Text style={styles.completeDescription}>
              {copy.completeDescription}
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={viewStorage}
              style={({ pressed }) => [
                styles.storageButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.storageButtonText}>
                {copy.viewStorage}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={goReview}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.backButtonText}>
                {copy.backToResult}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  },

  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 32,
  },

  exchangingText: {
    color: "#000000",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },

  waitText: {
    marginTop: 18,
    color: MUTED_GRAY,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },

  stage: {
    width: "100%",
    maxWidth: 330,
    height: 320,
    marginTop: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    borderRadius: 160,
    backgroundColor: CREAM,
  },

  monsterContainer: {
    width: 112,
    alignItems: "center",
    justifyContent: "center",
  },

  monsterImage: {
    width: 112,
    height: 150,
  },

  monsterPlaceholder: {
    width: 112,
    height: 150,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 56,
  },

  arrowCircle: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
  },

  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(0,0,0,0.42)",
  },

  completePanel: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 26,
    borderRadius: 28,
    backgroundColor: "#ffffff",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 8,
  },

  completeIconCircle: {
    width: 92,
    height: 92,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 46,
    backgroundColor: LIGHT_GREEN,
  },

  completeTitle: {
    marginTop: 24,
    color: "#000000",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },

  completeDescription: {
    marginTop: 16,
    maxWidth: 270,
    color: MUTED_GRAY,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
    textAlign: "center",
  },

  storageButton: {
    width: "100%",
    minHeight: 56,
    marginTop: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: YELLOW,
  },

  storageButtonText: {
    color: "#000000",
    fontSize: 18,
    fontWeight: "900",
  },

  backButton: {
    width: "100%",
    minHeight: 52,
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 16,
    backgroundColor: "#ffffff",
  },

  backButtonText: {
    color: BLUE,
    fontSize: 16,
    fontWeight: "900",
  },

  pressed: {
    opacity: 0.72,
  },
});
