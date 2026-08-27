export type NotificationType =
  | "new_application"
  | "match_confirmed"
  | "application_rejected"
  | "new_message"
  | "application_withdrawn"
  | "guide_canceled"
  | "guide_updated"
  | "guide_reminder"
  | "recruitment_expired";

export type NotificationDestination =
  | "applicants"
  | "application_detail"
  | "guide_detail"
  | "chat"
  | "recruitment_detail";

export type NotificationPeriod = "today" | "past_7_days";

export type NotificationRecord = {
  id: string;
  type: NotificationType;
  target_id: string;
  recruitment_id?: string;
  destination: NotificationDestination;
  actor_name?: string;
  context?: string;
  created_at: string;
  read_at?: string;
};

export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  receivedAt: string;
  unread: boolean;
  period: NotificationPeriod;
  destination: NotificationDestination;
  targetId: string;
  recruitmentId?: string;
};

// Keep the old screen-facing names as aliases while both roles consume the
// same server contract.
export type ForeignerNotificationType = NotificationType;
export type JapaneseNotificationType = NotificationType;
export type ForeignerNotification = NotificationView;
export type JapaneseNotification = NotificationView;
