import { useMemo, useState, type ComponentProps } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { MOCK_FOREIGNER_NOTIFICATIONS } from "../../mocks/notifications";
import type {
  ForeignerNotification,
  ForeignerNotificationType,
  NotificationPeriod,
} from "../../types/notification";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const LINK_BLUE = "#168df0";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";
const SOFT_BLUE = "#eff8ff";

type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];
type Filter = "all" | "unread";

type NotificationIconStyle = {
  name: MaterialIconName;
  color: string;
  backgroundColor: string;
  borderColor: string;
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
];

const PERIOD_LABELS: Record<NotificationPeriod, string> = {
  today: "Today",
  past_7_days: "Past 7 days",
};

const NOTIFICATION_ICONS: Record<
  ForeignerNotificationType,
  NotificationIconStyle
> = {
  new_application: {
    name: "how-to-reg",
    color: YELLOW,
    backgroundColor: "#fff8e8",
    borderColor: "#f7dfaa",
  },
  match_confirmed: {
    name: "verified",
    color: LINK_BLUE,
    backgroundColor: SOFT_BLUE,
    borderColor: "#caeafd",
  },
  new_message: {
    name: "chat-bubble-outline",
    color: BLUE,
    backgroundColor: SOFT_BLUE,
    borderColor: "#caeafd",
  },
  application_withdrawn: {
    name: "undo",
    color: MUTED_GRAY,
    backgroundColor: "#f7f7f7",
    borderColor: BORDER_GRAY,
  },
  guide_canceled: {
    name: "event-busy",
    color: "#d45555",
    backgroundColor: "#fff2f2",
    borderColor: "#f1cfcf",
  },
  guide_updated: {
    name: "event-note",
    color: LINK_BLUE,
    backgroundColor: SOFT_BLUE,
    borderColor: "#caeafd",
  },
  guide_reminder: {
    name: "event-available",
    color: BLUE,
    backgroundColor: SOFT_BLUE,
    borderColor: "#caeafd",
  },
  recruitment_expired: {
    name: "hourglass-empty",
    color: MUTED_GRAY,
    backgroundColor: "#f7f7f7",
    borderColor: BORDER_GRAY,
  },
};

function NotificationIcon({ type }: { type: ForeignerNotificationType }) {
  const icon = NOTIFICATION_ICONS[type];

  return (
    <View
      style={[
        styles.iconCircle,
        {
          backgroundColor: icon.backgroundColor,
          borderColor: icon.borderColor,
        },
      ]}
    >
      <MaterialIcons color={icon.color} name={icon.name} size={30} />
    </View>
  );
}

function NotificationCard({
  notification,
  onPress,
}: {
  notification: ForeignerNotification;
  onPress: (notification: ForeignerNotification) => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${notification.title}. ${notification.message}`}
      accessibilityRole="button"
      onPress={() => onPress(notification)}
      style={({ pressed }) => [
        styles.notificationCard,
        notification.unread && styles.notificationCardUnread,
        pressed && styles.pressed,
      ]}
    >
      {notification.unread ? <View style={styles.unreadDot} /> : null}
      <NotificationIcon type={notification.type} />

      <View style={styles.notificationText}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.notificationTitle}>
            {notification.title}
          </Text>
          <Text style={styles.receivedAt}>{notification.receivedAt}</Text>
        </View>
        <Text numberOfLines={2} style={styles.notificationMessage}>
          {notification.message}
        </Text>
      </View>

      <MaterialIcons color={MUTED_GRAY} name="chevron-right" size={30} />
    </Pressable>
  );
}

export default function ForeignerNotificationsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const notifications = useMemo(() => {
    if (filter === "unread") {
      return MOCK_FOREIGNER_NOTIFICATIONS.filter((notification) => notification.unread);
    }

    return MOCK_FOREIGNER_NOTIFICATIONS;
  }, [filter]);
  const notificationGroups = useMemo(
    () =>
      (["today", "past_7_days"] as const)
        .map((period) => ({
          period,
          notifications: notifications.filter(
            (notification) => notification.period === period,
          ),
        }))
        .filter((group) => group.notifications.length > 0),
    [notifications],
  );
  const openNotification = (notification: ForeignerNotification) => {
    if (notification.type !== "new_application") return;

    router.push({
      pathname: "/foreigner/applications/[id]",
      params: { id: notification.targetId },
    });
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <MaterialIcons color="#ffffff" name="chevron-left" size={30} />
        </Pressable>

        <MaterialIcons color="#ffffff" name="notifications-none" size={43} />
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.segmentedControl}>
          {FILTERS.map((item) => {
            const selected = filter === item.key;

            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(item.key)}
                style={({ pressed }) => [
                  styles.segment,
                  selected && styles.segmentSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    selected && styles.segmentTextSelected,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {notificationGroups.length > 0 ? (
          notificationGroups.map((group) => (
            <View key={group.period} style={styles.section}>
              <Text style={styles.sectionTitle}>{PERIOD_LABELS[group.period]}</Text>
              <View style={styles.cardList}>
                {group.notifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onPress={openNotification}
                  />
                ))}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons color={BLUE} name="notifications-none" size={34} />
            </View>
            <Text style={styles.emptyTitle}>No notifications yet</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    position: "relative",
    height: 238,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 38,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: BLUE,
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
  headerTitle: {
    marginTop: 22,
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 36,
    textAlign: "center",
  },
  content: {
    minHeight: 606,
    alignItems: "center",
    paddingTop: 36,
    paddingHorizontal: 19,
    paddingBottom: 42,
  },
  segmentedControl: {
    width: "100%",
    maxWidth: 306,
    height: 48,
    flexDirection: "row",
    padding: 2,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 24,
    backgroundColor: "#ffffff",
  },
  segment: {
    flex: 1,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
  },
  segmentSelected: {
    backgroundColor: BLUE,
  },
  segmentText: {
    color: MUTED_GRAY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  segmentTextSelected: {
    color: "#ffffff",
  },
  section: {
    width: "100%",
    maxWidth: 348,
    marginTop: 34,
  },
  sectionTitle: {
    color: "#30343b",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 27,
  },
  cardList: {
    marginTop: 20,
    gap: 16,
  },
  notificationCard: {
    width: "100%",
    minHeight: 100,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 18,
    paddingRight: 10,
    paddingBottom: 18,
    paddingLeft: 27,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  notificationCardUnread: {
    borderColor: BLUE,
    backgroundColor: "#f4f9fd",
  },
  iconCircle: {
    width: 62,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 31,
  },
  notificationText: {
    flex: 1,
    marginLeft: 17,
  },
  titleRow: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  notificationTitle: {
    flex: 1,
    color: "#101318",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 20,
  },
  unreadDot: {
    position: "absolute",
    left: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: LINK_BLUE,
  },
  notificationMessage: {
    marginTop: 7,
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 18,
  },
  receivedAt: {
    color: MUTED_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 18,
  },
  emptyState: {
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIconCircle: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 38,
    backgroundColor: "#eff8ff",
  },
  emptyTitle: {
    marginTop: 18,
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
});
