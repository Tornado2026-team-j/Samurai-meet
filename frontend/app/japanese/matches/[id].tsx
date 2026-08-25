import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  findMockMatchById,
  MOCK_MATCHES,
} from "../../../mocks/matches";
import { formatTimeRange } from "../../../utils/time";

const BLUE = "#00aeff";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#949494";
const HEADER_BLUE = "#5ec5f5";
const CATEGORY_ICONS = {
  Food: "restaurant",
  Places: "place",
  Activity: "directions-run",
  Other: "category",
} as const;
const CATEGORY_IMAGES = {
  Food: require("../../../assets/images/food.png"),
  Places: require("../../../assets/images/places-category.png"),
  Activity: require("../../../assets/images/activity-category.png"),
  Other: require("../../../assets/images/other-category.png"),
} as const;

export default function JapaneseMatchDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const matchId = Array.isArray(id) ? id[0] : id;
  const match = findMockMatchById(matchId) ?? MOCK_MATCHES[0];
  const [isRequested, setIsRequested] = useState(false);

  if (!match) {
    return null;
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.canvas}>
          <View style={styles.header}>
            <Image
              accessibilityLabel={`${match.category}カテゴリのイラスト`}
              resizeMode="contain"
              source={CATEGORY_IMAGES[match.category]}
              style={styles.categoryImage}
            />

            <Pressable
              accessibilityLabel="前の画面に戻る"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.pressed,
              ]}
            >
              <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
            </Pressable>

            <View style={styles.categoryBadge}>
              <MaterialIcons
                color={YELLOW}
                name={CATEGORY_ICONS[match.category]}
                size={19}
              />
              <Text style={styles.categoryText}>{match.category}</Text>
            </View>
          </View>

          <View style={styles.profileGroup}>
            <MaterialIcons color="#d4d4d4" name="account-circle" size={50} />
            <View style={styles.profileText}>
              <View style={styles.nameRow}>
                <Text numberOfLines={1} style={styles.name}>
                  {match.authorName}
                </Text>
                <Text style={styles.flag}>{match.countryFlag}</Text>
              </View>
              <Text style={styles.country}>{match.countryName}</Text>
              <View style={styles.ratingRow}>
                <MaterialIcons color={YELLOW} name="thumb-up-off-alt" size={17} />
                <Text style={styles.rating}>{match.rating}</Text>
              </View>
            </View>
          </View>

          <View style={styles.schedulePanel}>
            <View style={styles.scheduleRow}>
              <MaterialIcons color="#168df0" name="calendar-today" size={25} />
              <View style={styles.scheduleText}>
                <Text style={styles.scheduleLabel}>Date</Text>
                <Text style={styles.scheduleValue}>{match.detailDate}</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={[styles.scheduleRow, styles.timeRow]}>
              <MaterialIcons color="#168df0" name="schedule" size={27} />
              <View style={styles.scheduleText}>
                <Text style={styles.scheduleLabel}>Time</Text>
                <Text style={styles.scheduleValue}>
                  {formatTimeRange(match.startTime, match.durationHours)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.descriptionPanel}>
            <Text style={styles.descriptionLabel}>したいこと</Text>
            <Text style={styles.description}>{match.description}</Text>
          </View>

          <View style={styles.keywordsPanel}>
            <View style={styles.keywordsTitleRow}>
              <MaterialIcons color="#168df0" name="sell" size={21} />
              <Text style={styles.keywordsTitle}>Keywords</Text>
            </View>
            <View style={styles.keywordsRow}>
              {match.detailTags.map((tag) => (
                <View key={tag} style={styles.keyword}>
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    numberOfLines={1}
                    style={styles.keywordText}
                  >
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isRequested }}
            disabled={isRequested}
            onPress={() => setIsRequested(true)}
            style={({ pressed }) => [
              styles.guideButton,
              isRequested && styles.guideButtonRequested,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.guideButtonText}>
              {isRequested ? "案内リクエストを送信しました" : "この人を案内したい！"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  scrollContent: {
    minHeight: 844,
    alignItems: "center",
  },
  canvas: {
    position: "relative",
    width: "100%",
    maxWidth: 390,
    height: 844,
    backgroundColor: "#ffffff",
  },
  header: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    height: 238,
    overflow: "hidden",
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: HEADER_BLUE,
  },
  backButton: {
    position: "absolute",
    top: 49,
    left: 18,
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryImage: {
    position: "absolute",
    top: 49,
    alignSelf: "center",
    width: 383,
    height: 209,
  },
  categoryBadge: {
    position: "absolute",
    top: 46,
    alignSelf: "center",
    width: 95,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  categoryText: {
    color: "#535353",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 18,
  },
  profileGroup: {
    position: "absolute",
    top: 257,
    left: 38,
    right: 38,
    height: 77,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  profileText: {
    marginLeft: 17,
  },
  nameRow: {
    height: 25,
    flexDirection: "row",
    alignItems: "center",
  },
  name: {
    maxWidth: 154,
    color: "#000000",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 24,
  },
  flag: {
    marginLeft: 13,
    color: "#000000",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 24,
  },
  country: {
    marginTop: 2,
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  ratingRow: {
    marginTop: 5,
    height: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  rating: {
    marginLeft: 5,
    color: YELLOW,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  schedulePanel: {
    position: "absolute",
    top: 348,
    left: 45.5,
    width: 299,
    height: 152,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e4e4e4",
    borderRadius: 12,
    backgroundColor: "#ffffff",
  },
  scheduleRow: {
    position: "absolute",
    top: 20,
    left: 24,
    right: 18,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
  },
  timeRow: {
    top: 87,
  },
  scheduleText: {
    marginLeft: 17,
  },
  scheduleLabel: {
    color: "#3d3d3d",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  scheduleValue: {
    marginTop: 3,
    color: "#000000",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 24,
  },
  divider: {
    position: "absolute",
    top: 75,
    right: 23,
    left: 23,
    height: 1,
    backgroundColor: "#e6e6e6",
  },
  descriptionPanel: {
    position: "absolute",
    top: 516,
    left: 56,
    width: 278,
    height: 124,
    paddingTop: 8,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 20,
    backgroundColor: "#f4f9fd",
  },
  descriptionLabel: {
    color: BLUE,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  description: {
    marginTop: 10,
    color: "#000000",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  keywordsPanel: {
    position: "absolute",
    top: 656,
    left: 57,
    width: 276,
    height: 77,
  },
  keywordsTitleRow: {
    height: 25,
    flexDirection: "row",
    alignItems: "center",
  },
  keywordsTitle: {
    marginLeft: 7,
    color: "#168df0",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  keywordsRow: {
    marginTop: 11,
    height: 30,
    flexDirection: "row",
    gap: 8,
  },
  keyword: {
    minWidth: 59,
    maxWidth: 74,
    height: 30,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#eff8ff",
  },
  keywordText: {
    color: "#222222",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  guideButton: {
    position: "absolute",
    top: 772,
    left: 66,
    width: 258,
    height: 29,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: YELLOW,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  guideButtonRequested: {
    opacity: 0.72,
  },
  guideButtonText: {
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
