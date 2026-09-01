import { requestAPI } from "./api-client";
import type { Session } from "./auth-contract";
import type {
  NotificationDestination,
  NotificationRecord,
  NotificationType,
  NotificationView,
} from "../types/notification";

type NotificationResponse = { data?: unknown };

const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "new_application",
  "match_confirmed",
  "application_rejected",
  "new_message",
  "application_withdrawn",
  "guide_canceled",
  "guide_updated",
  "guide_reminder",
  "recruitment_expired",
];

const NOTIFICATION_DESTINATIONS: readonly NotificationDestination[] = [
  "applicants",
  "application_detail",
  "guide_detail",
  "chat",
  "recruitment_detail",
];

function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && NOTIFICATION_TYPES.includes(value as NotificationType);
}

function isNotificationDestination(value: unknown): value is NotificationDestination {
  return typeof value === "string"
    && NOTIFICATION_DESTINATIONS.includes(value as NotificationDestination);
}

export function isNotificationRecord(value: unknown): value is NotificationRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && candidate.id.length > 0
    && isNotificationType(candidate.type)
    && typeof candidate.target_id === "string"
    && candidate.target_id.length > 0
    && isNotificationDestination(candidate.destination)
    && typeof candidate.created_at === "string"
    && candidate.created_at.length > 0
    && (candidate.recruitment_id === undefined || typeof candidate.recruitment_id === "string")
    && (candidate.actor_name === undefined || typeof candidate.actor_name === "string")
    && (candidate.context === undefined || typeof candidate.context === "string")
    && (candidate.read_at === undefined || typeof candidate.read_at === "string");
}

export async function listNotifications(
  session: Session,
  options: { unreadOnly?: boolean; limit?: number } = {},
  signal?: AbortSignal,
): Promise<NotificationRecord[]> {
  const query = new URLSearchParams();
  if (options.unreadOnly !== undefined) query.set("unread_only", String(options.unreadOnly));
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await requestAPI<NotificationResponse>(
    `/notifications${suffix}`,
    session,
    { method: "GET", signal },
  );
  if (!Array.isArray(response?.data)) return [];
  return response.data.filter(isNotificationRecord);
}

export async function markNotificationRead(
  session: Session,
  notificationID: string,
  signal?: AbortSignal,
): Promise<void> {
  await requestAPI<null>(
    `/notifications/${encodeURIComponent(notificationID)}/read`,
    session,
    { method: "POST", signal },
  );
}

type NotificationCopy = {
  title: string;
  message: (actor: string) => string;
};

export type NotificationNavigation =
  | {
      pathname: "/chat/[id]";
      params: { id: string };
    }
  | {
      pathname: "/foreigner/applications/[id]";
      params: { id: string; recruitmentId?: string };
    }
  | {
      pathname: "/japanese/guide-requested";
      params: { matchId: string; recruitmentId?: string };
    };

type NotificationRouter = {
  push: (navigation: NotificationNavigation) => void;
};

type NotificationPressInput = Pick<
  NotificationView,
  "type" | "targetId" | "recruitmentId"
>;

// Navigation is determined from the server's stable notification contract.
// Localized title/message text must never affect the destination.
export function getNotificationNavigation(
  notification: NotificationPressInput,
): NotificationNavigation | null {
  const targetID = notification.targetId.trim();
  if (!targetID) return null;

  switch (notification.type) {
    case "new_application":
    case "application_withdrawn":
      return {
        pathname: "/foreigner/applications/[id]",
        params: {
          id: targetID,
          ...(notification.recruitmentId?.trim()
            ? { recruitmentId: notification.recruitmentId.trim() }
            : {}),
        },
      };
    case "match_confirmed":
    case "application_rejected":
      return {
        pathname: "/japanese/guide-requested",
        params: {
          matchId: targetID,
          ...(notification.recruitmentId?.trim()
            ? { recruitmentId: notification.recruitmentId.trim() }
            : {}),
        },
      };
    case "new_message":
      return {
        pathname: "/chat/[id]",
        params: { id: targetID },
      };
    default:
      return null;
  }
}

function navigateFromNotificationScreen(
  mode: "japanese" | "foreigner",
  router: NotificationRouter,
  notification: NotificationPressInput,
): void {
  // Keep the screen role explicit at the call site. Destinations are based on
  // the server contract, not on the display language or role-specific copy.
  if (mode !== "japanese" && mode !== "foreigner") return;
  const navigation = getNotificationNavigation(notification);
  if (navigation) router.push(navigation);
}

export function navigateFromJapaneseNotifications(
  router: NotificationRouter,
  notification: NotificationPressInput,
): void {
  navigateFromNotificationScreen("japanese", router, notification);
}

export function navigateFromForeignerNotifications(
  router: NotificationRouter,
  notification: NotificationPressInput,
): void {
  navigateFromNotificationScreen("foreigner", router, notification);
}

const ENGLISH_COPY: Record<NotificationType, NotificationCopy> = {
  new_application: {
    title: "New application",
    message: (actor) => `${actor} applied to your recruitment.`,
  },
  match_confirmed: {
    title: "Guide confirmed",
    message: (actor) => `${actor} accepted your application.`,
  },
  application_rejected: {
    title: "Application update",
    message: () => "Your application was not accepted this time.",
  },
  new_message: {
    title: "New message",
    message: (actor) => `${actor}: You have a new encrypted message.`,
  },
  application_withdrawn: {
    title: "Application withdrawn",
    message: (actor) => `${actor} withdrew an application.`,
  },
  guide_canceled: {
    title: "Guide canceled",
    message: (actor) => `${actor} canceled the guide plan.`,
  },
  guide_updated: {
    title: "Guide details updated",
    message: () => "The guide details have been updated.",
  },
  guide_reminder: {
    title: "Guide reminder",
    message: () => "Your guide plan is coming up soon.",
  },
  recruitment_expired: {
    title: "Recruitment closed",
    message: () => "Your recruitment has ended.",
  },
};

const JAPANESE_COPY: Record<NotificationType, NotificationCopy> = {
  new_application: {
    title: "新しい応募",
    message: (actor) => `${actor}さんがあなたの募集に応募しました`,
  },
  match_confirmed: {
    title: "案内が決定しました",
    message: (actor) => `${actor}さんがあなたの応募を承認しました`,
  },
  application_rejected: {
    title: "今回はマッチングに至りませんでした",
    message: () => "応募結果を確認できます",
  },
  new_message: {
    title: "新しいメッセージ",
    message: (actor) => `${actor}さんから新しい暗号化メッセージがあります`,
  },
  application_withdrawn: {
    title: "応募が取り下げられました",
    message: (actor) => `${actor}さんが応募を取り下げました`,
  },
  guide_canceled: {
    title: "案内がキャンセルされました",
    message: (actor) => `${actor}さんが案内予定をキャンセルしました`,
  },
  guide_updated: {
    title: "案内内容が変更されました",
    message: () => "案内の詳細が変更されました",
  },
  guide_reminder: {
    title: "案内予定のお知らせ",
    message: () => "案内予定が近づいています",
  },
  recruitment_expired: {
    title: "募集が終了しました",
    message: () => "募集の掲載期間が終了しました",
  },
};

function actorLabel(actorName: string | undefined, language: "en" | "ja"): string {
  const trimmed = actorName?.trim();
  if (trimmed) return trimmed;
  return language === "ja" ? "ユーザー" : "Someone";
}

const JST_TIME_ZONE = "Asia/Tokyo";

function jstDateKey(value: Date): string {
  if (Number.isNaN(value.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: JST_TIME_ZONE,
    year: "numeric",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftJstDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return "";
  const shifted = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
    12,
  ));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function isYesterdayInJst(first: Date, second: Date): boolean {
  return jstDateKey(first) === shiftJstDateKey(jstDateKey(second), -1);
}

function relativeTime(createdAt: Date, now: Date, language: "en" | "ja"): string {
  const elapsed = Math.max(0, now.getTime() - createdAt.getTime());
  if (isYesterdayInJst(createdAt, now)) return language === "ja" ? "昨日" : "Yesterday";
  if (elapsed < 60_000) return language === "ja" ? "今" : "now";
  if (elapsed < 60 * 60_000) {
    const minutes = Math.floor(elapsed / 60_000);
    return language === "ja" ? `${minutes}分前` : `${minutes}m`;
  }
  if (elapsed < 24 * 60 * 60_000) {
    const hours = Math.floor(elapsed / (60 * 60_000));
    return language === "ja" ? `${hours}時間前` : `${hours}h`;
  }
  const days = Math.max(1, Math.floor(elapsed / (24 * 60 * 60_000)));
  return language === "ja" ? `${days}日前` : `${days}d`;
}

export function toNotificationView(
  record: NotificationRecord,
  language: "en" | "ja",
  now = new Date(),
): NotificationView {
  const createdAt = new Date(record.created_at);
  const validCreatedAt = Number.isNaN(createdAt.getTime()) ? now : createdAt;
  const copy = (language === "ja" ? JAPANESE_COPY : ENGLISH_COPY)[record.type];
  const actor = actorLabel(record.actor_name, language);
  const createdDateKey = jstDateKey(validCreatedAt);
  const nowDateKey = jstDateKey(now);
  return {
    id: record.id,
    type: record.type,
    title: copy.title,
    message: copy.message(actor),
    receivedAt: relativeTime(validCreatedAt, now, language),
    unread: !record.read_at,
    period: createdDateKey === nowDateKey ? "today" : "past_7_days",
    destination: record.destination,
    targetId: record.target_id,
    recruitmentId: record.recruitment_id,
  };
}
