import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MatchCardData } from "../types/match";
import { formatTimeRange } from "../utils/time";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";

type MatchCardProps = {
  match: MatchCardData;
  onOpen?: (match: MatchCardData) => void;
};

export default function MatchCard({ match, onOpen }: MatchCardProps) {
  return (
    <Pressable
      accessibilityLabel={`${match.authorName}の募集詳細を開く`}
      accessibilityRole={onOpen ? "button" : undefined}
      disabled={!onOpen}
      onPress={() => onOpen?.(match)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.profileRow}>
        <MaterialIcons color="#d4d4d4" name="account-circle" size={26} />
        <Text numberOfLines={1} style={styles.authorName}>
          {match.authorName}
        </Text>
        <Text style={styles.countryFlag}>{match.countryFlag}</Text>
      </View>

      <View style={styles.openButton}>
        <MaterialIcons color={TEXT_GRAY} name="open-in-new" size={18} />
      </View>

      <Text numberOfLines={1} style={[styles.detailLine, styles.dateLine]}>
        <Text style={styles.detailLabel}>Date</Text>
        {`   ${match.date}`}
      </Text>
      <Text numberOfLines={1} style={[styles.detailLine, styles.timeLine]}>
        <Text style={styles.detailLabel}>Time</Text>
        {`   ${formatTimeRange(match.startTime, match.durationHours)}`}
      </Text>

      <View style={styles.tags}>
        {match.tags.map((tag) => (
          <View key={tag} style={styles.tag}>
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              numberOfLines={1}
              style={styles.tagText}
            >
              {tag}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.expiry}>{match.expiresAt}まで</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 307,
    maxWidth: "78.72%",
    height: 132,
    borderWidth: 1,
    borderColor: "#949494",
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  profileRow: {
    position: "absolute",
    top: 7,
    left: 24,
    right: 44,
    height: 27,
    flexDirection: "row",
    alignItems: "center",
  },
  authorName: {
    maxWidth: 126,
    marginLeft: 12,
    color: "#000000",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
  },
  countryFlag: {
    marginLeft: 11,
    color: "#000000",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
  },
  openButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  detailLine: {
    position: "absolute",
    left: 22,
    right: 16,
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 15,
  },
  detailLabel: {
    fontWeight: "900",
  },
  dateLine: {
    top: 42,
  },
  timeLine: {
    top: 66,
  },
  tags: {
    position: "absolute",
    top: 93,
    left: 22,
    right: 74,
    height: 25,
    flexDirection: "row",
    gap: 6,
  },
  tag: {
    minWidth: 55,
    maxWidth: 68,
    height: 25,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 5,
    backgroundColor: "#ffffff",
  },
  tagText: {
    color: TEXT_GRAY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 12,
  },
  expiry: {
    position: "absolute",
    right: 10,
    bottom: 7,
    color: YELLOW,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 12,
  },
  pressed: {
    opacity: 0.72,
  },
});
