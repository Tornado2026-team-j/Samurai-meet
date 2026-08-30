import { MaterialIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import type { MatchCardData } from "../types/match";
import { Card, Pill, colors, radius, typography } from "./ui";
import { formatTimeRange } from "../utils/time";

type MatchCardProps = {
  match: MatchCardData;
  onOpen?: (match: MatchCardData) => void;
};

export default function MatchCard({ match, onOpen }: MatchCardProps) {
  const statusLabel = match.applicationStatus === "pending" ? "応募中"
    : match.applicationStatus === "accepted" ? "承認済み"
      : match.applicationStatus === "completed" ? "完了"
        : match.applicationStatus ? "結果確定" : null;
  return (
    <Card
      accessibilityLabel={`${match.authorName}の募集詳細を開く`}
      accessibilityRole={onOpen ? "button" : undefined}
      disabled={!onOpen}
      onPress={onOpen ? () => onOpen(match) : undefined}
      style={styles.card}
    >
      <View style={styles.profileRow}>
        <MaterialIcons color={colors.border.default} name="account-circle" size={26} />
        <Text numberOfLines={1} style={styles.authorName}>
          {match.authorName}
        </Text>
        <Text style={styles.countryFlag}>{match.countryFlag}</Text>
      </View>

      {statusLabel ? <View style={[styles.statusBadge, match.applicationStatus === "accepted" && styles.statusAccepted]}><Text style={[styles.statusText, match.applicationStatus === "accepted" && styles.statusAcceptedText]}>{statusLabel}</Text></View> : <View style={styles.openButton}><MaterialIcons color={colors.text.secondary} name="open-in-new" size={18} /></View>}

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
          <Pill key={tag} style={styles.tag} textStyle={styles.tagText} variant="primary">
            {tag}
          </Pill>
        ))}
      </View>

      <Text style={styles.expiry}>{match.expiresAt}まで</Text>
      {match.locationName ? <View style={styles.locationRow}><MaterialIcons color={colors.text.muted} name="place" size={12} /><Text numberOfLines={1} style={styles.locationText}>{match.locationName}</Text></View> : null}
      {match.isToday ? <Text style={styles.today}>今日</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 307,
    maxWidth: "78.72%",
    height: 132,
    padding: 0,
    borderColor: colors.border.muted,
    borderRadius: radius["2xl"],
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
    color: colors.text.black,
    ...typography.subheading,
    lineHeight: 19,
  },
  countryFlag: {
    marginLeft: 11,
    color: colors.text.black,
    ...typography.subheading,
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
  statusBadge: {
    position: "absolute",
    top: 8,
    right: 9,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.goldSoft,
  },
  statusAccepted: { backgroundColor: colors.surface.blueSoft },
  statusText: { color: colors.brand.gold, ...typography.micro, fontWeight: "900" },
  statusAcceptedText: { color: colors.brand.sky },
  today: {
    position: "absolute",
    right: 10,
    bottom: 24,
    color: colors.state.danger,
    ...typography.micro,
    fontWeight: "900",
  },
  detailLine: {
    position: "absolute",
    left: 22,
    right: 16,
    color: colors.text.secondary,
    ...typography.smallStrong,
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
    minHeight: 25,
    paddingHorizontal: 6,
    borderRadius: radius.xs,
  },
  tagText: {
    color: colors.text.secondary,
    ...typography.micro,
  },
  expiry: {
    position: "absolute",
    right: 10,
    bottom: 7,
    color: colors.brand.gold,
    ...typography.micro,
    fontWeight: "600",
    letterSpacing: 0,
  },
  locationRow: {
    position: "absolute",
    left: 22,
    right: 96,
    bottom: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  locationText: {
    flex: 1,
    color: colors.text.muted,
    ...typography.micro,
  },
});
