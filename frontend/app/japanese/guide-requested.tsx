import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

const HEADER_BLUE = "#5ec5f5";
const YELLOW = "#e7b454";

export default function JapaneseGuideRequestedScreen() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.canvas}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            旅行者が応募を確認するまでお待ちください
          </Text>
        </View>

        <View style={styles.main}>
          <View style={styles.mainContent}>
            <View style={styles.illustrationStage}>
              <View style={styles.illustrationCircle} />
              <Image
                accessibilityLabel="応募確認待ちの手紙"
                resizeMode="contain"
                source={require("../../assets/images/letter.png")}
                style={styles.letterImage}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/japanese")}
              style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]}
            >
              <MaterialIcons color="#ffffff" name="home" size={21} />
              <Text style={styles.homeButtonText}>ホームに戻る</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  canvas: {
    position: "relative",
    width: "100%",
    maxWidth: 390,
    minHeight: "100%",
    backgroundColor: "#ffffff",
  },
  header: {
    height: 238,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 38,
    overflow: "hidden",
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: HEADER_BLUE,
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 30,
    textAlign: "center",
  },
  main: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 38,
    paddingBottom: 72,
    backgroundColor: "#ffffff",
  },
  mainContent: {
    alignItems: "center",
  },
  illustrationStage: {
    width: 270,
    height: 270,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 45,
  },
  illustrationCircle: {
    position: "absolute",
    width: 224,
    height: 224,
    borderRadius: 112,
    backgroundColor: "#5EC5F5",
  },
  letterImage: {
    width: 260,
    height: 191,
  },
  homeButton: {
    width: 258,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  homeButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
});
