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
      <View style={styles.headerRow}>
        <View style={styles.profileRow}>
          <MaterialIcons color={colors.border.default} name="account-circle" size={26} />
          <Text numberOfLines={1} style={styles.authorName}>
            {match.authorName}
          </Text>
          <Text style={styles.countryFlag}>{match.countryFlag}</Text>
        </View>

        {statusLabel ? <View style={[styles.statusBadge, match.applicationStatus === "accepted" && styles.statusAccepted]}><Text style={[styles.statusText, match.applicationStatus === "accepted" && styles.statusAcceptedText]}>{statusLabel}</Text></View> : <View style={styles.openButton}><MaterialIcons color={colors.text.secondary} name="open-in-new" size={18} /></View>}
      </View>

      <View style={styles.details}>
        <Text numberOfLines={1} style={styles.detailLine}>
          <Text style={styles.detailLabel}>Date</Text>
          {`   ${match.date}`}
        </Text>
        <Text numberOfLines={1} style={styles.detailLine}>
          <Text style={styles.detailLabel}>Time</Text>
          {`   ${formatTimeRange(match.startTime, match.durationHours)}`}
        </Text>
      </View>

      <View style={styles.tags}>
        {match.tags.map((tag) => (
          <Pill key={tag} style={styles.tag} textStyle={styles.tagText} variant="primary">
            {tag}
          </Pill>
        ))}
      </View>

      <View style={styles.footer}>
        {match.locationName ? <View style={styles.locationRow}><MaterialIcons color={colors.text.muted} name="place" size={12} /><Text numberOfLines={1} style={styles.locationText}>{match.locationName}</Text></View> : <View style={styles.footerSpacer} />}
        <View style={styles.footerMeta}>
          {match.isToday ? <Text style={styles.today}>今日</Text> : null}
          <Text style={styles.expiry}>{match.expiresAt}まで</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 307,
    maxWidth: "78.72%",
    minHeight: 132,
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderColor: colors.border.muted,
    borderRadius: radius["2xl"],
  },
  headerRow: {
    width: "100%",
    minHeight: 27,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  profileRow: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  authorName: {
    minWidth: 0,
    flex: 1,
    marginLeft: 8,
    color: colors.text.black,
    ...typography.subheading,
    lineHeight: 19,
  },
  countryFlag: {
    flexShrink: 0,
    marginLeft: 8,
    color: colors.text.black,
    ...typography.subheading,
    lineHeight: 19,
  },
  openButton: {
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBadge: {
    flexShrink: 0,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.goldSoft,
  },
  statusAccepted: { backgroundColor: colors.surface.blueSoft },
  statusText: { color: colors.brand.gold, ...typography.micro, fontWeight: "900" },
  statusAcceptedText: { color: colors.brand.sky },
  details: {
    gap: 4,
  },
  detailLine: {
    color: colors.text.secondary,
    ...typography.smallStrong,
    lineHeight: 15,
  },
  detailLabel: {
    fontWeight: "900",
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tag: {
    minWidth: 55,
    maxWidth: "100%",
    minHeight: 25,
    paddingHorizontal: 6,
    paddingVertical: 4,
    flexShrink: 1,
    borderRadius: radius.xs,
  },
  tagText: {
    flexShrink: 1,
    color: colors.text.secondary,
    ...typography.micro,
  },
  footer: {
    width: "100%",
    minHeight: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  locationRow: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  locationText: {
    minWidth: 0,
    flex: 1,
    color: colors.text.muted,
    ...typography.micro,
  },
  footerSpacer: {
    minWidth: 0,
    flex: 1,
  },
  footerMeta: {
    flexShrink: 0,
    alignItems: "flex-end",
    gap: 1,
  },
  today: {
    color: colors.state.danger,
    ...typography.micro,
    fontWeight: "900",
  },
  expiry: {
    color: colors.brand.gold,
    ...typography.micro,
    fontWeight: "600",
    letterSpacing: 0,
  },
});
