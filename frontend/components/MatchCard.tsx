import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MatchCardData } from "../types/match";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../services/onboarding";
import { getMatchCardCopy, getMatchCardStatusLabel } from "../services/matching";
import { Card, Pill, colors, radius, typography } from "./ui";
import { formatTimeRange } from "../utils/time";
import { translateLocationLabel } from "../utils/location-labels";
import { translateRecruitmentTag } from "../utils/recruitment-tags";

type MatchCardProps = {
  language?: AppLanguage;
  match: MatchCardData;
  onOpen?: (match: MatchCardData) => void;
};

const MONTH_INDEX: Readonly<Record<string, number>> = {
  april: 4,
  august: 8,
  december: 12,
  february: 2,
  january: 1,
  july: 7,
  june: 6,
  march: 3,
  may: 5,
  november: 11,
  october: 10,
  september: 9,
};

function formatCardDate(value: string): string {
  const slashMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (slashMatch) {
    return `${slashMatch[1]}/${Number(slashMatch[2])}/${Number(slashMatch[3])}`;
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (isoMatch) {
    return `${isoMatch[1]}/${Number(isoMatch[2])}/${Number(isoMatch[3])}`;
  }

  const monthNameMatch = /^([A-Za-z]+),?\s*(\d{1,2}),?\s+(\d{4})$/.exec(value.trim());
  if (monthNameMatch) {
    const month = MONTH_INDEX[monthNameMatch[1]!.toLocaleLowerCase()];
    if (month) return `${monthNameMatch[3]}/${month}/${Number(monthNameMatch[2])}`;
  }

  return value;
}

function useSelectedAppLanguage(explicitLanguage?: AppLanguage): AppLanguage {
  const [storedLanguage, setStoredLanguage] = useState<AppLanguage>(explicitLanguage ?? "ja");

  useEffect(() => {
    if (explicitLanguage) {
      setStoredLanguage(explicitLanguage);
      return;
    }

    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active && nextLanguage) setStoredLanguage(nextLanguage);
    });
    void loadLanguage().then((nextLanguage) => {
      if (active && nextLanguage) setStoredLanguage(nextLanguage);
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [explicitLanguage]);

  return explicitLanguage ?? storedLanguage;
}

export default function MatchCard({ match, onOpen, language: explicitLanguage }: MatchCardProps) {
  const language = useSelectedAppLanguage(explicitLanguage);
  const copy = getMatchCardCopy(language);
  const locationName = match.locationName
    ? translateLocationLabel(match.locationName, language)
    : "";
  const statusLabel = getMatchCardStatusLabel(match.applicationStatus, language);
  return (
    <Card
      accessibilityLabel={copy.openDetails(match.authorName)}
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
          <Text style={styles.detailLabel}>{copy.date}</Text>
          {`   ${formatCardDate(match.date)}`}
        </Text>
        <Text numberOfLines={1} style={styles.detailLine}>
          <Text style={styles.detailLabel}>{copy.time}</Text>
          {`   ${formatTimeRange(match.startTime, match.durationHours)}`}
        </Text>
      </View>

      <View style={styles.tags}>
        {match.tags.map((tag) => (
          <Pill key={tag} style={styles.tag} textStyle={styles.tagText} variant="primary">
            {translateRecruitmentTag(tag, language)}
          </Pill>
        ))}
      </View>

      <View style={styles.footer}>
        {locationName ? <View style={styles.locationRow}><MaterialIcons color={colors.text.muted} name="place" size={12} style={styles.locationIcon} /><Text ellipsizeMode="tail" numberOfLines={1} style={styles.locationText}>{locationName}</Text></View> : <View style={styles.footerSpacer} />}
        <View style={styles.footerMeta}>
          {match.isToday ? <Text style={styles.today}>{copy.today}</Text> : null}
          <Text adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={1} style={styles.expiry}>{copy.expiry(match.expiresAt)}</Text>
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
    gap: 6,
  },
  locationRow: {
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    overflow: "hidden",
  },
  locationIcon: {
    flexShrink: 0,
  },
  locationText: {
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
    color: colors.text.muted,
    ...typography.micro,
  },
  footerSpacer: {
    minWidth: 0,
    flex: 1,
  },
  footerMeta: {
    maxWidth: "54%",
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
