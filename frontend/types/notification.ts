export type ForeignerNotificationType =
  | "new_application"
  | "match_confirmed"
  | "new_message"
  | "application_withdrawn"
  | "guide_canceled"
  | "guide_updated"
  | "guide_reminder"
  | "recruitment_expired";

export type JapaneseNotificationType =
  | "application_rejected"
  | "match_confirmed"
  | "new_message"
  | "guide_canceled"
  | "guide_updated"
  | "guide_reminder";

export type NotificationDestination =
  | "applicants"
  | "application_detail"
  | "guide_detail"
  | "chat"
  | "recruitment_detail";

export type NotificationPeriod = "today" | "past_7_days";

export type ForeignerNotification = {
  id: string;
  type: ForeignerNotificationType;
  title: string;
  message: string;
  receivedAt: string;
  unread: boolean;
  period: NotificationPeriod;
  destination: NotificationDestination;
  targetId: string;
};

export type JapaneseNotification = {
  id: string;
  type: JapaneseNotificationType;
  title: string;
  message: string;
  receivedAt: string;
  unread: boolean;
  period: NotificationPeriod;
  destination: NotificationDestination;
  targetId: string;
};
