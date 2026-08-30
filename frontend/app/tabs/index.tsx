import { useEffect, useMemo, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../hooks/useAuth";
import { APIError } from "../../services/api-client";
import { getCurrentCoordinates } from "../../services/location";
import {
  loadLanguage,
  loadLocalProfile,
  subscribeLanguage,
  type AppLanguage,
} from "../../services/onboarding";
import { updateMyProfile } from "../../services/profile";
import {
  createRecruitmentPreview,
  defaultRecruitmentSchedule,
  formatRecruitmentDateInput,
  formatRecruitmentISODate,
  getRecruitmentScheduleIssue,
  parseRecruitmentDateInput,
  publishRecruitment,
  recruitmentDateTimeToInstant,
  shiftRecruitmentDate,
  JST_TIME_ZONE,
  type RecruitmentSelection,
  type RecruitmentScheduleIssue,
} from "../../services/recruitment";
import type {
  RecruitmentDistanceKm,
  RecruitmentDraft,
  RecruitmentPreview,
} from "../../types/recruitment";
import type { MatchCategory } from "../../types/match";
import { formatTimeRange } from "../../utils/time";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const PLACEHOLDER_GRAY = "#949494";
const BORDER_GRAY = "#d4d4d4";
const COLLAPSED_HEADER_HEIGHT = 156;
const EXPANDED_HEADER_HEIGHT = 653;
const CONFIRMATION_HEADER_HEIGHT = 542;
const EXPANSION_DURATION = 360;
const RECRUITMENT_CATEGORIES: readonly MatchCategory[] = [
  "Food",
  "Places",
  "Activity",
  "Other",
];

const RECRUITMENT_COPY = {
  en: {
    backToHome: "Back to home",
    back: "BACK",
    activityLabel: "What would you like to do?",
    activityAccessibilityLabel: "Activity description",
    activityPlaceholder:
      "Please tell us more about what you'd like to do or see",
    whereLabel: "Where",
    locationAccessibilityLabel: "Location",
    locationPlaceholder: "Osaka,Umeda",
    useCurrentLocationAccessibilityLabel: "Use my current location",
    useCurrentLocation: "Use my current location",
    dateLabel: "Date",
    dateAccessibilityHint: "Opens the date picker",
    chooseRecruitmentDateAccessibilityLabel: "Choose recruitment date",
    startTimeLabel: "Start Time",
    startTimeAccessibilityLabel: "Start time",
    startTimeAccessibilityHint:
      "Opens the time picker. Times can be selected in five-minute intervals.",
    durationLabel: "Duration",
    durationAccessibilityLabel: "Duration",
    durationAccessibilityHint:
      "Opens a menu with durations from one to eight hours.",
    distanceLabel: "Distance",
    next: "NEXT",
    confirmationTitle: "Is everything correct?",
    confirmationExpiry: "Visible until the event ends:",
    categoryLabel: "Guide category",
    keywordLabel: "Suggested keywords",
    keywordHint: "Tap a keyword to select or remove it.",
    tryAgain: "TRY AGAIN",
    summaryDate: "Date",
    summaryTime: "Time",
    publishing: "Publishing...",
    go: "GO!",
    backToFilters: "Back to search filters",
    compactActivityPlaceholder: "What would you like to do?",
    profile: "Profile",
    closeDatePicker: "Close date picker",
    pickerCancel: "Cancel",
    pickerDateTitle: "Choose date",
    pickerDone: "Done",
    closeTimePicker: "Close time picker",
    pickerTimeTitle: "Choose start time",
    closeDurationMenu: "Close duration menu",
    durationQuestion: "How long would you like to meet?",
    durationCancel: "Cancel",
    closeScheduleWarning: "Close schedule warning",
    pastStartTitle: "This start time has passed.",
    midnightTitle: "This duration crosses midnight.",
    pastStartQuestion: "Change it to tomorrow?",
    midnightQuestion: "Change it to tomorrow at 09:00?",
    suggestedSchedule: "Suggested schedule",
    useSuggestion: "YES, USE THIS",
    editSchedule: "NO, EDIT",
    invalidDate: "Choose a valid recruitment date.",
    invalidTime: "Choose a valid start time.",
    invalidDuration: "Choose a duration from 1 to 8 hours.",
    activityRequired: "Tell us what you would like to do before continuing.",
    pastDate: "The selected start time has already passed. Choose another time.",
    crossesMidnight:
      "The selected duration crosses midnight. Choose an earlier time or shorter duration.",
    invalidDetails: "Check the recruitment details.",
    previewError: "Preview could not be prepared. Please try again.",
		classificationUnavailable: "Automatic category selection is not available yet. Please try again later.",
		classificationRateLimited: "Please wait a moment before checking the category again.",
		classificationFailed: "We could not determine a guide category. Please reword the activity and try again.",
    requestTimeout:
      "The server request timed out. Check your connection and try again.",
    expiredSession: "Your session expired. Sign in again on this API environment.",
    incompleteProfile: "Complete your profile before publishing.",
    invalidProfile:
      "Your profile could not be synchronized. Check your name and nationality.",
    expiredRecruitment:
      "The recruitment time has passed. Choose a new date and time.",
    invalidMatchingRequest:
      "Review the entire recruitment details and try again.",
    publishFailed:
      "The server could not publish this recruitment. Try again shortly.",
    signInAgain: "Your session expired. Sign in again before publishing.",
    notSignedIn: "Please sign in again before publishing.",
    connectionFailed:
      "The server could not be reached. Check your iPhone network connection and try again.",
    expiryFallback: "...",
  },
  ja: {
    backToHome: "ホームに戻る",
    back: "戻る",
    activityLabel: "何をしたいですか？",
    activityAccessibilityLabel: "したいことの説明",
    activityPlaceholder: "したいことや見たいものを教えてください",
    whereLabel: "場所",
    locationAccessibilityLabel: "場所",
    locationPlaceholder: "大阪・梅田",
    useCurrentLocationAccessibilityLabel: "現在地を使う",
    useCurrentLocation: "現在地を使う",
    dateLabel: "日付",
    dateAccessibilityHint: "日付選択を開きます",
    chooseRecruitmentDateAccessibilityLabel: "募集日を選択",
    startTimeLabel: "開始時刻",
    startTimeAccessibilityLabel: "開始時刻",
    startTimeAccessibilityHint: "時刻選択を開きます。5分単位で選択できます。",
    durationLabel: "所要時間",
    durationAccessibilityLabel: "所要時間",
    durationAccessibilityHint: "1時間から8時間の選択メニューを開きます。",
    distanceLabel: "距離",
    next: "次へ",
    confirmationTitle: "この内容でよろしいですか？",
    confirmationExpiry: "イベント終了まで公開されます：",
    categoryLabel: "案内カテゴリー",
    keywordLabel: "キーワード候補",
    keywordHint: "タップしてキーワードを選択・解除できます。",
    tryAgain: "再試行",
    summaryDate: "日付",
    summaryTime: "時間",
    publishing: "公開中…",
    go: "公開する",
    backToFilters: "募集条件に戻る",
    compactActivityPlaceholder: "何をしたいですか？",
    profile: "プロフィール",
    closeDatePicker: "日付選択を閉じる",
    pickerCancel: "キャンセル",
    pickerDateTitle: "日付を選択",
    pickerDone: "完了",
    closeTimePicker: "時刻選択を閉じる",
    pickerTimeTitle: "開始時刻を選択",
    closeDurationMenu: "所要時間メニューを閉じる",
    durationQuestion: "何時間会いたいですか？",
    durationCancel: "キャンセル",
    closeScheduleWarning: "日時の確認を閉じる",
    pastStartTitle: "開始時刻が過ぎています。",
    midnightTitle: "所要時間が日付をまたぎます。",
    pastStartQuestion: "明日に変更しますか？",
    midnightQuestion: "明日の09:00に変更しますか？",
    suggestedSchedule: "変更案",
    useSuggestion: "はい、これを使う",
    editSchedule: "いいえ、編集する",
    invalidDate: "有効な募集日を選択してください。",
    invalidTime: "有効な開始時刻を選択してください。",
    invalidDuration: "所要時間は1〜8時間から選択してください。",
    activityRequired: "したいことを入力してから次へ進んでください。",
    pastDate: "選択した開始時刻は過ぎています。別の時刻を選択してください。",
    crossesMidnight:
      "所要時間が日付をまたぎます。早い時刻または短い所要時間を選択してください。",
    invalidDetails: "募集内容を確認してください。",
    previewError: "プレビューを作成できませんでした。もう一度お試しください。",
		classificationUnavailable: "案内カテゴリの自動判定を準備中です。しばらくしてからもう一度お試しください。",
		classificationRateLimited: "カテゴリを再判定する前に少しお待ちください。",
		classificationFailed: "案内カテゴリを判定できませんでした。したいことを少し言い換えてもう一度お試しください。",
    requestTimeout:
      "サーバーへのリクエストがタイムアウトしました。接続を確認してもう一度お試しください。",
    expiredSession: "セッションの有効期限が切れました。このAPI環境で再度ログインしてください。",
    incompleteProfile: "公開前にプロフィールを完成させてください。",
    invalidProfile: "プロフィールを同期できませんでした。名前と国籍を確認してください。",
    expiredRecruitment: "募集時刻が過ぎています。新しい日付と時刻を選択してください。",
    invalidMatchingRequest: "募集内容全体を確認してもう一度お試しください。",
    publishFailed: "募集を公開できませんでした。しばらくしてからもう一度お試しください。",
    signInAgain: "セッションの有効期限が切れました。公開前に再度ログインしてください。",
    notSignedIn: "公開前にもう一度ログインしてください。",
    connectionFailed:
      "サーバーに接続できませんでした。iPhoneのネットワーク接続を確認してもう一度お試しください。",
    expiryFallback: "…",
  },
} as const;

type PreviewStatus = "idle" | "loading" | "success" | "error";
type PublishStatus = "idle" | "publishing";
type ScheduleWarning = {
  issue: RecruitmentScheduleIssue;
  suggestedDate: string;
  suggestedStartTime: string;
  fromConfirmation: boolean;
};

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function isSessionRefreshFailure(error: unknown): boolean {
  return error instanceof Error && /^(401|409):/u.test(error.message);
}

function recruitmentInputMessage(
  error: unknown,
  language: AppLanguage,
): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const copy = RECRUITMENT_COPY[language];

  switch (error.message) {
    case "invalid_recruitment_date":
      return copy.invalidDate;
    case "invalid_recruitment_time":
      return copy.invalidTime;
    case "invalid_recruitment_duration":
      return copy.invalidDuration;
    case "recruitment_date_in_past":
      return copy.pastDate;
    case "recruitment_must_end_same_day":
      return copy.crossesMidnight;
    default:
      return null;
  }
}

function recruitmentPreviewMessage(error: unknown, language: AppLanguage): string {
	const copy = RECRUITMENT_COPY[language];
	if (!(error instanceof APIError)) return copy.previewError;
	switch (error.code) {
		case "recruitment_classification_unavailable":
			return copy.classificationUnavailable;
		case "recruitment_classification_rate_limited":
			return copy.classificationRateLimited;
		case "recruitment_classification_failed":
			return copy.classificationFailed;
		default:
			return copy.previewError;
	}
}

function safeParseRecruitmentDate(value: string, fallback: Date): Date {
  try {
    return parseRecruitmentDateInput(value);
  } catch {
    return fallback;
  }
}

function safeCurrentJSTPickerDate(): Date {
  try {
    return parseRecruitmentDateInput(formatRecruitmentISODate(new Date()));
  } catch {
    return new Date(0);
  }
}

function formatRecruitmentDateForDisplay(
  value: string,
  language: AppLanguage,
): string {
  try {
    const date = parseRecruitmentDateInput(value);
    if (language === "ja") {
      return new Intl.DateTimeFormat("ja-JP", {
        day: "numeric",
        month: "long",
        timeZone: JST_TIME_ZONE,
        year: "numeric",
      }).format(date);
    }
    return formatRecruitmentDateInput(date);
  } catch {
    return language === "ja" ? "—" : "—";
  }
}

function formatDurationLabel(duration: number, language: AppLanguage): string {
  return language === "ja" ? `${duration}時間` : `${duration} hr`;
}

function translatePreviewTag(tag: string, language: AppLanguage): string {
  if (language === "en") return tag;

  const translations: Readonly<Record<string, string>> = {
    activity: "アクティビティ",
    anime: "アニメ",
    culture: "文化",
    experience: "体験",
    food: "食事",
    local: "地域",
    museum: "美術館",
    nightlife: "夜遊び",
    other: "その他",
    places: "観光地",
    shopping: "買い物",
    takoyaki: "たこ焼き",
    walking: "散歩",
  };

  return translations[tag.trim().toLowerCase()] ?? tag;
}

function formatPreviewExpiry(
  preview: RecruitmentPreview,
  language: AppLanguage,
): string {
  if (language === "en") return preview.expiresAt;

  try {
    const [, endTime = preview.conditions.startTime] = formatTimeRange(
      preview.conditions.startTime,
      preview.conditions.durationHours,
    ).split("~");
    return `${formatRecruitmentDateForDisplay(preview.conditions.date, language)} ${endTime}`;
  } catch {
    return preview.expiresAt;
  }
}

function getJSTTimeParts(value: Date): { hour: number; minute: number } {
  if (Number.isNaN(value.getTime())) {
    return { hour: 0, minute: 0 };
  }

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone: JST_TIME_ZONE,
    })
      .formatToParts(value)
      .reduce<Record<string, string>>((result, part) => {
        if (part.type !== "literal") result[part.type] = part.value;
        return result;
      }, {});
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);

    if (
      Number.isInteger(hour) &&
      hour >= 0 &&
      hour <= 23 &&
      Number.isInteger(minute) &&
      minute >= 0 &&
      minute <= 59
    ) {
      return { hour, minute };
    }
  } catch {
    // Keep the picker renderable even if the platform formatter is unavailable.
  }

  return { hour: 0, minute: 0 };
}

function makeTimePickerValue(
  date: string,
  hour: number,
  minute: number,
): Date {
  const safeHour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0;
  const safeMinute =
    Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0;

  try {
    return recruitmentDateTimeToInstant(
      date,
      `${String(safeHour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")}`,
    );
  } catch {
    return new Date(0);
  }
}

function roundPickerTime(value: Date): { hour: number; minute: number } {
  const jstTime = getJSTTimeParts(value);
  let hour = jstTime.hour;
  let minute = Math.round(jstTime.minute / 5) * 5;

  if (minute === 60) {
    hour = (hour + 1) % 24;
    minute = 0;
  }

  return { hour, minute };
}

function countryCodeToFlag(countryCode: string): string {
  const normalizedCode = countryCode.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalizedCode)) {
    return "";
  }

  return String.fromCodePoint(
    ...[...normalizedCode].map((character) => character.charCodeAt(0) + 127397),
  );
}

export default function SearchPreferencesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const { query } = useLocalSearchParams<{ query?: string | string[] }>();
  const initialQuery = Array.isArray(query) ? query[0] : query;
  const [language, setLanguage] = useState<AppLanguage>("en");
  const [languageLoaded, setLanguageLoaded] = useState(false);
  const suggestedSchedule = useMemo(() => defaultRecruitmentSchedule(), []);
  const suggestedDate = suggestedSchedule.date;
  const [description, setDescription] = useState(initialQuery ?? "");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(suggestedDate);
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);
  const [hour, setHour] = useState(() => Number(suggestedSchedule.startTime.slice(0, 2)));
  const [minute, setMinute] = useState(() => Number(suggestedSchedule.startTime.slice(3, 5)));
  const [duration, setDuration] = useState(suggestedSchedule.durationHours);
  const [distance, setDistance] = useState<RecruitmentDistanceKm>(3);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [durationPickerVisible, setDurationPickerVisible] = useState(false);
  const [pickerDate, setPickerDate] = useState(() =>
    safeParseRecruitmentDate(suggestedDate, safeCurrentJSTPickerDate()),
  );
  const [pickerTime, setPickerTime] = useState(() => {
    return makeTimePickerValue(
      suggestedDate,
      Number(suggestedSchedule.startTime.slice(0, 2)),
      Number(suggestedSchedule.startTime.slice(3, 5)),
    );
  });
  const [scheduleWarning, setScheduleWarning] = useState<ScheduleWarning | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isCompactHeaderVisible, setIsCompactHeaderVisible] = useState(true);
  const [isConfirmationVisible, setIsConfirmationVisible] = useState(false);
  const [preview, setPreview] = useState<RecruitmentPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<MatchCategory | null>(null);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const previewRequestRef = useRef<AbortController | null>(null);
  const panelHeight = useMemo(
    () => new Animated.Value(COLLAPSED_HEADER_HEIGHT),
    [],
  );
  const compactContentOpacity = useMemo(() => new Animated.Value(1), []);
  const compactContentTranslateY = useMemo(() => new Animated.Value(0), []);
  const contentOpacity = useMemo(() => new Animated.Value(0), []);
  const contentTranslateY = useMemo(() => new Animated.Value(14), []);
  const confirmationOpacity = useMemo(() => new Animated.Value(0), []);
  const confirmationTranslateY = useMemo(() => new Animated.Value(14), []);
  const minimumDate = useMemo(() => {
    try {
      const today = formatRecruitmentISODate(new Date());
      return recruitmentDateTimeToInstant(today, "00:00");
    } catch {
      return safeCurrentJSTPickerDate();
    }
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active && nextLanguage) setLanguage(nextLanguage);
    });

    void loadLanguage()
      .then((storedLanguage) => {
        if (!active) return;
        setLanguage(storedLanguage ?? "en");
        setLanguageLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setLanguage("en");
        setLanguageLoaded(true);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(panelHeight, {
        duration: EXPANSION_DURATION,
        easing: Easing.out(Easing.cubic),
        toValue: EXPANDED_HEADER_HEIGHT,
        useNativeDriver: false,
      }),
      Animated.timing(compactContentOpacity, {
        duration: 120,
        easing: Easing.out(Easing.quad),
        toValue: 0,
        useNativeDriver: false,
      }),
      Animated.timing(compactContentTranslateY, {
        duration: 150,
        easing: Easing.out(Easing.quad),
        toValue: -8,
        useNativeDriver: false,
      }),
      Animated.timing(contentOpacity, {
        delay: 100,
        duration: 240,
        toValue: 1,
        useNativeDriver: false,
      }),
      Animated.timing(contentTranslateY, {
        delay: 100,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: false,
      }),
    ]);
    const frame = requestAnimationFrame(() =>
      animation.start(({ finished }) => {
        if (finished) {
          setIsCompactHeaderVisible(false);
        }
      }),
    );

    return () => {
      cancelAnimationFrame(frame);
      animation.stop();
    };
  }, [
    compactContentOpacity,
    compactContentTranslateY,
    contentOpacity,
    contentTranslateY,
    panelHeight,
  ]);

  useEffect(
    () => () => {
      previewRequestRef.current?.abort();
    },
    [],
  );

  const createDraft = (): RecruitmentDraft => ({
    activity: description.trim() || "Explore Osaka with a local",
    location: location.trim() || "Osaka,Umeda",
    useCurrentLocation,
    date: date.trim() || suggestedDate,
    startTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    durationHours: duration,
    distanceKm: distance,
  });

  const clearScheduleMessages = () => {
    setFormError(null);
    setPublishError(null);
  };

  const commitDate = (value: Date) => {
    try {
      const nextDate = formatRecruitmentISODate(value);
      setPickerDate(safeParseRecruitmentDate(nextDate, minimumDate));
      setDate(nextDate);
    } catch {
      setFormError(recruitmentInputMessage(new Error("invalid_recruitment_date"), language));
      return;
    }
    setDatePickerVisible(false);
    clearScheduleMessages();
  };

  const commitTime = (value: Date) => {
    const nextTime = roundPickerTime(value);
    setPickerTime(makeTimePickerValue(date, nextTime.hour, nextTime.minute));
    setHour(nextTime.hour);
    setMinute(nextTime.minute);
    setTimePickerVisible(false);
    clearScheduleMessages();
  };

  const openDatePicker = () => {
    Keyboard.dismiss();
    setPickerDate(safeParseRecruitmentDate(date, minimumDate));
    setDatePickerVisible(true);
  };

  const openTimePicker = () => {
    Keyboard.dismiss();
    setPickerTime(makeTimePickerValue(date, hour, minute));
    setTimePickerVisible(true);
  };

  const handleDatePickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === "android") {
      setDatePickerVisible(false);
      if (event.type === "set" && value) {
        commitDate(value);
      }
      return;
    }

    if (event.type === "set" && value) {
      try {
        const nextDate = formatRecruitmentISODate(value);
        setPickerDate(safeParseRecruitmentDate(nextDate, minimumDate));
      } catch {
        // Ignore an invalid native event and keep the last valid picker value.
      }
    }
  };

  const handleTimePickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === "android") {
      setTimePickerVisible(false);
      if (event.type === "set" && value) {
        commitTime(value);
      }
      return;
    }

    if (event.type === "set" && value) {
      setPickerTime(value);
    }
  };

  const selectDuration = (value: number) => {
    setDuration(value);
    setDurationPickerVisible(false);
    clearScheduleMessages();
  };

  const openScheduleWarning = (
    draft: RecruitmentDraft,
    issue: RecruitmentScheduleIssue,
    fromConfirmation = false,
  ) => {
    const suggestedDate = shiftRecruitmentDate(draft.date, 1);
    const suggestedStartTime =
      issue === "recruitment_must_end_same_day" ? "09:00" : draft.startTime;

    setScheduleWarning({
      issue,
      suggestedDate,
      suggestedStartTime,
      fromConfirmation,
    });
  };

  const showConfirmation = (draft = createDraft()) => {
    if (previewStatus === "loading") {
      return;
    }

    if (!description.trim()) {
      setFormError(RECRUITMENT_COPY[language].activityRequired);
      return;
    }

    try {
      const issue = getRecruitmentScheduleIssue(draft);
      if (issue) {
        openScheduleWarning(draft, issue);
        return;
      }
    } catch (error) {
      setFormError(
        recruitmentInputMessage(error, language) ?? RECRUITMENT_COPY[language].invalidDetails,
      );
      return;
    }

    Keyboard.dismiss();
    void loadPreview(draft);
    confirmationOpacity.setValue(0);
    confirmationTranslateY.setValue(14);
    setIsConfirmationVisible(true);

    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(panelHeight, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
          toValue: CONFIRMATION_HEADER_HEIGHT,
          useNativeDriver: false,
        }),
        Animated.timing(contentOpacity, {
          duration: 140,
          toValue: 0,
          useNativeDriver: false,
        }),
        Animated.timing(contentTranslateY, {
          duration: 180,
          easing: Easing.out(Easing.quad),
          toValue: -12,
          useNativeDriver: false,
        }),
        Animated.timing(confirmationOpacity, {
          delay: 80,
          duration: 220,
          toValue: 1,
          useNativeDriver: false,
        }),
        Animated.timing(confirmationTranslateY, {
          delay: 80,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: false,
        }),
      ]).start();
    });
  };

  const applyScheduleSuggestion = () => {
    if (!scheduleWarning) {
      return;
    }

    const currentDraft = createDraft();
    const nextDraft: RecruitmentDraft = {
      ...currentDraft,
      date: scheduleWarning.suggestedDate,
      startTime: scheduleWarning.suggestedStartTime,
    };
    const [nextHourValue = "0", nextMinuteValue = "0"] =
      scheduleWarning.suggestedStartTime.split(":");
    const nextHour = Number(nextHourValue);
    const nextMinute = Number(nextMinuteValue);

    setDate(nextDraft.date);
    setPickerDate(safeParseRecruitmentDate(nextDraft.date, minimumDate));
    setHour(nextHour);
    setMinute(nextMinute);
    setPickerTime(makeTimePickerValue(nextDraft.date, nextHour, nextMinute));
    setFormError(null);
    setPublishError(null);
    setScheduleWarning(null);
    showConfirmation(nextDraft);
  };

  const editSchedule = () => {
    const returnToConfirmation = scheduleWarning?.fromConfirmation ?? false;
    setScheduleWarning(null);
    if (returnToConfirmation) {
      showFilters();
    }
  };

  const loadPreview = async (draft = createDraft()) => {
    previewRequestRef.current?.abort();
    const controller = new AbortController();
    previewRequestRef.current = controller;
    setPreview(null);
    setPreviewError(null);
    setPublishError(null);
    setPreviewStatus("loading");

	try {
		const activeSession = getCurrentSession() ?? session;
		if (!activeSession) {
			throw new Error("not_signed_in");
		}
		const result = await createRecruitmentPreview(draft, activeSession, controller.signal);
      const localProfile = activeSession
        ? await loadLocalProfile(activeSession.user_id)
        : null;
      const personalizedResult = localProfile
        ? {
            ...result,
            author: {
              ...result.author,
              id: activeSession?.user_id ?? result.author.id,
              displayName: localProfile.name,
              countryCode: localProfile.nationalityCode,
            },
          }
        : result;

      if (previewRequestRef.current === controller) {
        setPreview(personalizedResult);
        setSelectedCategory(personalizedResult.category);
        setSelectedKeywords(personalizedResult.tags);
        setPreviewStatus("success");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      if (previewRequestRef.current === controller) {
		setPreviewError(recruitmentPreviewMessage(error, language));
        setPreviewStatus("error");
      }
    } finally {
      if (previewRequestRef.current === controller) {
        previewRequestRef.current = null;
      }
    }
  };

  const publish = async () => {
    if (publishStatus === "publishing" || previewStatus !== "success" || !preview) {
      return;
    }

    Keyboard.dismiss();
    setPublishStatus("publishing");
    setPublishError(null);
    const draft = createDraft();

    try {
      const scheduleIssue = getRecruitmentScheduleIssue(draft);
      if (scheduleIssue) {
        openScheduleWarning(draft, scheduleIssue, true);
        return;
      }

      if (status !== "signed_in") {
        throw new Error("not_signed_in");
      }
      await refresh();
      const activeSession = getCurrentSession();
      if (!activeSession) {
        throw new Error("not_signed_in");
      }

      const localProfile = await loadLocalProfile(activeSession.user_id);
      if (localProfile?.completed) {
        await updateMyProfile(activeSession, {
          name: localProfile.name,
          nationality_code: localProfile.nationalityCode,
          bio: localProfile.bio,
        });
      }

      let coordinates = null;
      if (useCurrentLocation) {
        try {
          coordinates = await getCurrentCoordinates();
        } catch {
          coordinates = null;
        }
      }

      const selection: RecruitmentSelection | undefined = selectedCategory
        ? { category: selectedCategory, keywords: selectedKeywords }
        : undefined;
      await publishRecruitment(
        draft,
        preview,
        activeSession,
        coordinates,
        undefined,
        selection,
      );
      router.replace("/foreigner");
    } catch (error) {
      const localMessage = recruitmentInputMessage(error, language);
      if (error instanceof Error && error.name === "AbortError") {
        setPublishError(RECRUITMENT_COPY[language].requestTimeout);
        return;
      }
      if (error instanceof APIError) {
        switch (error.code) {
          case "missing_or_invalid_access_token":
            setPublishError(RECRUITMENT_COPY[language].expiredSession);
            break;
          case "profile_incomplete":
            setPublishError(RECRUITMENT_COPY[language].incompleteProfile);
            break;
          case "invalid_profile":
            setPublishError(RECRUITMENT_COPY[language].invalidProfile);
            break;
          case "recruitment_expired":
            setPublishError(RECRUITMENT_COPY[language].expiredRecruitment);
            break;
          case "invalid_matching_request":
            setPublishError(RECRUITMENT_COPY[language].invalidMatchingRequest);
            break;
          default:
            setPublishError(RECRUITMENT_COPY[language].publishFailed);
        }
      } else if (isSessionRefreshFailure(error)) {
        setPublishError(RECRUITMENT_COPY[language].signInAgain);
      } else if (localMessage) {
        setPublishError(localMessage);
      } else if (error instanceof Error && error.message === "not_signed_in") {
        setPublishError(RECRUITMENT_COPY[language].notSignedIn);
      } else {
        setPublishError(RECRUITMENT_COPY[language].connectionFailed);
      }
    } finally {
      setPublishStatus("idle");
    }
  };

  const showFilters = () => {
    previewRequestRef.current?.abort();
    setScheduleWarning(null);
    setFormError(null);
    Animated.parallel([
      Animated.timing(panelHeight, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
        toValue: EXPANDED_HEADER_HEIGHT,
        useNativeDriver: false,
      }),
      Animated.timing(confirmationOpacity, {
        duration: 140,
        toValue: 0,
        useNativeDriver: false,
      }),
      Animated.timing(confirmationTranslateY, {
        duration: 180,
        easing: Easing.out(Easing.quad),
        toValue: 12,
        useNativeDriver: false,
      }),
      Animated.timing(contentOpacity, {
        delay: 70,
        duration: 220,
        toValue: 1,
        useNativeDriver: false,
      }),
      Animated.timing(contentTranslateY, {
        delay: 70,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setIsConfirmationVisible(false);
        setPreview(null);
        setPreviewError(null);
        setPublishError(null);
        setFormError(null);
        setPreviewStatus("idle");
        setPublishStatus("idle");
      }
    });
  };

  const copy = RECRUITMENT_COPY[language];

  if (!languageLoaded) {
    return (
      <View style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.languageLoading}>
          <ActivityIndicator color={BLUE} size="small" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <Animated.View
        style={[styles.panel, { height: panelHeight }]}
      >
        {!isConfirmationVisible ? (
          <Pressable
            accessibilityLabel={copy.backToHome}
            accessibilityRole="button"
            onPress={() => {
              Keyboard.dismiss();
              router.back();
            }}
            style={({ pressed }) => [
              styles.menuBackButton,
              { top: Math.max(insets.top + 4, 16) },
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons color="#ffffff" name="arrow-back" size={16} />
            <Text style={styles.menuBackButtonText}>{copy.back}</Text>
          </Pressable>
        ) : null}
        <Animated.View
          accessibilityElementsHidden={isConfirmationVisible}
          importantForAccessibility={
            isConfirmationVisible ? "no-hide-descendants" : "auto"
          }
          style={[
            styles.content,
            {
              opacity: contentOpacity,
              pointerEvents: isConfirmationVisible ? "none" : "auto",
              top: Math.max(insets.top + 10, 41),
              transform: [{ translateY: contentTranslateY }],
            },
          ]}
        >
          <View style={styles.form}>
            <View style={styles.descriptionGroup}>
              <Text style={styles.label}>{copy.activityLabel}</Text>
              <TextInput
                accessibilityLabel={copy.activityAccessibilityLabel}
                blurOnSubmit
                maxLength={160}
                onChangeText={setDescription}
                onSubmitEditing={() => Keyboard.dismiss()}
                placeholder={copy.activityPlaceholder}
                placeholderTextColor={PLACEHOLDER_GRAY}
                returnKeyType="done"
                style={[styles.input, styles.descriptionInput]}
                value={description}
              />
            </View>

            <View style={styles.whereGroup}>
              <Text style={styles.label}>{copy.whereLabel}</Text>
              <View style={[styles.input, styles.locationField]}>
                <MaterialIcons
                  color={PLACEHOLDER_GRAY}
                  name="search"
                  size={27}
                  style={styles.locationSearchIcon}
                />
                <TextInput
                accessibilityLabel={copy.locationAccessibilityLabel}
                  blurOnSubmit
                  onChangeText={setLocation}
                  onSubmitEditing={() => Keyboard.dismiss()}
                placeholder={copy.locationPlaceholder}
                  placeholderTextColor={PLACEHOLDER_GRAY}
                  returnKeyType="search"
                  style={styles.locationInput}
                  value={location}
                />
              </View>

              <Pressable
              accessibilityLabel={copy.useCurrentLocationAccessibilityLabel}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: useCurrentLocation }}
                onPress={() => setUseCurrentLocation((current) => !current)}
                style={({ pressed }) => [
                  styles.currentLocation,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialIcons
                  color="#ffffff"
                  name={useCurrentLocation ? "check-box" : "check-box-outline-blank"}
                  size={24}
                />
                <Text style={styles.currentLocationText}>{copy.useCurrentLocation}</Text>
              </Pressable>
            </View>

            <View style={styles.dateGroup}>
              <Text style={styles.label}>{copy.dateLabel}</Text>
              <View style={styles.dateRow}>
                <Pressable
                  accessibilityLabel={copy.dateLabel}
                  accessibilityHint={copy.dateAccessibilityHint}
                  accessibilityRole="button"
                  onPress={openDatePicker}
                  style={[styles.input, styles.dateInput]}
                >
                  <Text numberOfLines={1} style={styles.pickerValue}>
                    {formatRecruitmentDateForDisplay(date, language)}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={copy.chooseRecruitmentDateAccessibilityLabel}
                  accessibilityRole="button"
                  hitSlop={5}
                  onPress={openDatePicker}
                  style={({ pressed }) => [
                    styles.calendarButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <MaterialIcons color="#ffffff" name="calendar-today" size={25} />
                </Pressable>
              </View>
            </View>

            <View style={styles.startTimeGroup}>
              <Text style={styles.label}>{copy.startTimeLabel}</Text>
              <View style={styles.timeRow}>
                <Pressable
                  accessibilityLabel="Start time"
                  accessibilityHint="Opens the time picker. Times can be selected in five-minute intervals."
                  accessibilityRole="button"
                  onPress={openTimePicker}
                  style={({ pressed }) => [
                    styles.timePickerButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <MaterialIcons color={YELLOW} name="access-time" size={18} />
                  <Text style={styles.pickerValue}>
                    {`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}
                  </Text>
                  <MaterialIcons color={YELLOW} name="expand-more" size={20} />
                </Pressable>
              </View>
            </View>

            <View style={styles.durationGroup}>
              <Text style={styles.label}>{copy.durationLabel}</Text>
              <View style={styles.durationStepper}>
                <Pressable
                  accessibilityLabel={copy.durationAccessibilityLabel}
                  accessibilityHint="Opens a menu with durations from one to eight hours."
                  accessibilityRole="button"
                  onPress={() => {
                    Keyboard.dismiss();
                    setDurationPickerVisible(true);
                  }}
                  style={({ pressed }) => [
                    styles.durationPickerButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.pickerValue}>{formatDurationLabel(duration, language)}</Text>
                  <MaterialIcons color={YELLOW} name="expand-more" size={20} />
                </Pressable>
              </View>
            </View>

            <View style={styles.distanceGroup}>
              <Text style={styles.label}>{copy.distanceLabel}</Text>
              <View style={styles.distanceRow}>
                {[1, 3, 5].map((option) => {
                  const selected = distance === option;

                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setDistance(option as RecruitmentDistanceKm)}
                      style={({ pressed }) => [
                        styles.distanceButton,
                        selected && styles.distanceButtonSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.distanceText,
                          selected && styles.distanceTextSelected,
                        ]}
                      >
                        {option}km
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={previewStatus === "loading"}
              onPress={() => showConfirmation()}
              style={({ pressed }) => [
                styles.nextButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.nextText}>{copy.next}</Text>
            </Pressable>

            {formError ? (
              <Text accessibilityRole="alert" style={styles.formError}>
                {formError}
              </Text>
            ) : null}
          </View>
        </Animated.View>

        {isConfirmationVisible && (
          <Animated.View
            style={[
              styles.confirmationContent,
              {
                opacity: confirmationOpacity,
                transform: [{ translateY: confirmationTranslateY }],
              },
            ]}
          >
            <ScrollView
              contentContainerStyle={styles.confirmationScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              style={styles.confirmationScroll}
            >
              <Text style={styles.confirmationTitle}>{copy.confirmationTitle}</Text>
              <Text style={styles.confirmationExpiry}>
                {copy.confirmationExpiry} {preview ? formatPreviewExpiry(preview, language) : copy.expiryFallback}
              </Text>

              <View style={styles.summaryCard}>
                {previewStatus === "loading" && (
                  <View style={styles.previewState}>
                    <ActivityIndicator color={BLUE} size="small" />
                  </View>
                )}

                {previewStatus === "error" && (
                  <View style={styles.previewState}>
                    <Text style={styles.previewError}>{previewError}</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void loadPreview()}
                      style={({ pressed }) => [
                        styles.retryButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.retryButtonText}>{copy.tryAgain}</Text>
                    </Pressable>
                  </View>
                )}

                {previewStatus === "success" && preview && (
                  <>
                    <View style={styles.summaryProfileRow}>
                      {preview.author.avatarUrl ? (
                        <Image
                          accessibilityLabel={`${preview.author.displayName}'s profile image`}
                          source={{ uri: preview.author.avatarUrl }}
                          style={styles.summaryAvatar}
                        />
                      ) : (
                        <MaterialIcons
                          color={BORDER_GRAY}
                          name="account-circle"
                          size={30}
                        />
                      )}
                      <Text numberOfLines={1} style={styles.summaryName}>
                        {preview.author.displayName}
                      </Text>
                      <Text style={styles.summaryFlag}>
                        {countryCodeToFlag(preview.author.countryCode)}
                      </Text>
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[styles.summaryLine, styles.summaryDate]}
                    >
                      <Text style={styles.summaryLabel}>{copy.summaryDate}</Text>
                      {`   ${formatRecruitmentDateForDisplay(preview.conditions.date, language)}`}
                    </Text>
                    <Text style={[styles.summaryLine, styles.summaryTime]}>
                      <Text style={styles.summaryLabel}>{copy.summaryTime}</Text>
                      {`   ${formatTimeRange(
                        preview.conditions.startTime,
                        preview.conditions.durationHours,
                      )}`}
                    </Text>
                    <View style={styles.summaryTags}>
                      {selectedKeywords.map((tag) => (
                        <View key={tag} style={styles.summaryTag}>
                          <Text
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                            numberOfLines={1}
                            style={styles.summaryTagText}
                          >
                            {translatePreviewTag(tag, language)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </View>

              {previewStatus === "success" && preview ? (
                <>
                  <Text style={styles.categorySelectionLabel}>{copy.categoryLabel}</Text>
                  <View
                    accessibilityLabel={copy.categoryLabel}
                    accessibilityRole="radiogroup"
                    style={styles.categorySelectionRow}
                  >
                    {RECRUITMENT_CATEGORIES.map((category) => {
                      const selected = selectedCategory === category;
                      return (
                        <Pressable
                          key={category}
                          accessibilityLabel={category}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          onPress={() => setSelectedCategory(category)}
                          style={({ pressed }) => [
                            styles.categorySelectionButton,
                            selected && styles.categorySelectionButtonSelected,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text
                            adjustsFontSizeToFit
                            minimumFontScale={0.8}
                            numberOfLines={1}
                            style={[
                              styles.categorySelectionText,
                              selected && styles.categorySelectionTextSelected,
                            ]}
                          >
                            {category}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.keywordSelectionLabel}>{copy.keywordLabel}</Text>
                  <Text style={styles.keywordSelectionHint}>{copy.keywordHint}</Text>
                  <View style={styles.keywordSelectionRow}>
                    {preview.tags.map((tag) => {
                      const selected = selectedKeywords.includes(tag);
                      return (
                        <Pressable
                          key={tag}
                          accessibilityLabel={translatePreviewTag(tag, language)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                          onPress={() =>
                            setSelectedKeywords((current) =>
                              selected
                                ? current.filter((keyword) => keyword !== tag)
                                : [...current, tag],
                            )
                          }
                          style={({ pressed }) => [
                            styles.keywordSelectionButton,
                            selected && styles.keywordSelectionButtonSelected,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text
                            adjustsFontSizeToFit
                            minimumFontScale={0.8}
                            numberOfLines={1}
                            style={[
                              styles.keywordSelectionText,
                              selected && styles.keywordSelectionTextSelected,
                            ]}
                          >
                            {translatePreviewTag(tag, language)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <Pressable
                accessibilityState={{
                  disabled: previewStatus !== "success" || publishStatus === "publishing",
                }}
                accessibilityRole="button"
                disabled={previewStatus !== "success" || publishStatus === "publishing"}
                onPress={() => void publish()}
                style={({ pressed }) => [
                  styles.goButton,
                  (previewStatus !== "success" || publishStatus === "publishing") &&
                    styles.buttonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.goButtonText}>
                  {publishStatus === "publishing" ? copy.publishing : copy.go}
                </Text>
              </Pressable>

              {publishError ? (
                <Text accessibilityRole="alert" style={styles.publishError}>
                  {publishError}
                </Text>
              ) : null}

              <Pressable
                accessibilityLabel="Back to search filters"
                accessibilityRole="button"
                onPress={showFilters}
                style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              >
                <MaterialIcons color={YELLOW} name="arrow-back" size={18} />
                <Text style={styles.backButtonText}>{copy.backToFilters}</Text>
              </Pressable>
            </ScrollView>
          </Animated.View>
        )}

        {isCompactHeaderVisible && (
          <Animated.View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.compactContent,
              {
                opacity: compactContentOpacity,
                transform: [{ translateY: compactContentTranslateY }],
              },
            ]}
          >
            <View
              style={[
                styles.compactActionRow,
                {
                  top: Math.max(insets.top + 4, 45),
                  left: Math.max(insets.left + 16, 16),
                  right: Math.max(insets.right + 16, 16),
                },
              ]}
            >
              <View style={styles.compactSearchField}>
                <MaterialIcons
                  color={PLACEHOLDER_GRAY}
                  name="search"
                  size={22}
                  style={styles.compactSearchIcon}
                />
                <Text
                  ellipsizeMode="tail"
                  numberOfLines={1}
                  style={styles.compactSearchPlaceholder}
                >
                  {copy.compactActivityPlaceholder}
                </Text>
              </View>
              <View style={styles.compactNotificationIcon}>
                <MaterialIcons color="#ffffff" name="notifications-none" size={30} />
              </View>
              <Pressable
                accessibilityLabel={copy.profile}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => router.push("/profile")}
                style={({ pressed }) => [
                  styles.compactProfileIcon,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialIcons color="#ffffff" name="account-circle" size={30} />
              </Pressable>
            </View>
            <Text style={[styles.compactTitle, { top: Math.max(insets.top + 64, 108) }]}>{language === "ja" ? "あなたの日本を見つけよう！" : "Find Your Japan!"}</Text>
          </Animated.View>
        )}
      </Animated.View>

      {Platform.OS !== "ios" && datePickerVisible ? (
        <DateTimePicker
          display="default"
          minimumDate={minimumDate}
          mode="date"
          onChange={handleDatePickerChange}
          timeZoneName={JST_TIME_ZONE}
          value={pickerDate}
        />
      ) : null}

      {Platform.OS !== "ios" && timePickerVisible ? (
        <DateTimePicker
          display="default"
          is24Hour
          minuteInterval={5}
          mode="time"
          onChange={handleTimePickerChange}
          timeZoneName={JST_TIME_ZONE}
          value={pickerTime}
        />
      ) : null}

      {Platform.OS === "ios" ? (
        <Modal
          animationType="slide"
          onRequestClose={() => setDatePickerVisible(false)}
          transparent
          visible={datePickerVisible}
        >
          <View style={styles.modalBackdrop}>
            <Pressable
              accessibilityLabel="Close date picker"
              onPress={() => setDatePickerVisible(false)}
              style={StyleSheet.absoluteFillObject}
            />
            <View
              style={[
                styles.pickerSheet,
                { paddingBottom: Math.max(insets.bottom, 16) },
              ]}
            >
              <View style={styles.pickerHeader}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDatePickerVisible(false)}
                  style={styles.pickerHeaderButton}
                >
                  <Text style={styles.pickerCancelText}>{copy.pickerCancel}</Text>
                </Pressable>
                <Text style={styles.pickerTitle}>{copy.pickerDateTitle}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => commitDate(pickerDate)}
                  style={styles.pickerHeaderButton}
                >
                  <Text style={styles.pickerDoneText}>{copy.pickerDone}</Text>
                </Pressable>
              </View>
              <DateTimePicker
                accentColor={BLUE}
                display="spinner"
                locale="en-US"
                minimumDate={minimumDate}
                mode="date"
                onChange={handleDatePickerChange}
                style={styles.nativePicker}
                themeVariant="light"
                timeZoneName={JST_TIME_ZONE}
                value={pickerDate}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {Platform.OS === "ios" ? (
        <Modal
          animationType="slide"
          onRequestClose={() => setTimePickerVisible(false)}
          transparent
          visible={timePickerVisible}
        >
          <View style={styles.modalBackdrop}>
            <Pressable
              accessibilityLabel="Close time picker"
              onPress={() => setTimePickerVisible(false)}
              style={StyleSheet.absoluteFillObject}
            />
            <View
              style={[
                styles.pickerSheet,
                { paddingBottom: Math.max(insets.bottom, 16) },
              ]}
            >
              <View style={styles.pickerHeader}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setTimePickerVisible(false)}
                  style={styles.pickerHeaderButton}
                >
                  <Text style={styles.pickerCancelText}>{copy.pickerCancel}</Text>
                </Pressable>
                <Text style={styles.pickerTitle}>Choose start time</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => commitTime(pickerTime)}
                  style={styles.pickerHeaderButton}
                >
                  <Text style={styles.pickerDoneText}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                accentColor={BLUE}
                display="spinner"
                is24Hour
                minuteInterval={5}
                mode="time"
                onChange={handleTimePickerChange}
                style={styles.nativePicker}
                themeVariant="light"
                timeZoneName={JST_TIME_ZONE}
                value={pickerTime}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setDurationPickerVisible(false)}
        transparent
        visible={durationPickerVisible}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel="Close duration menu"
            onPress={() => setDurationPickerVisible(false)}
            style={StyleSheet.absoluteFillObject}
          />
          <View
            style={[
              styles.selectionSheet,
              { paddingBottom: Math.max(insets.bottom, 18) },
            ]}
          >
              <Text style={styles.selectionTitle}>{copy.durationLabel}</Text>
              <Text style={styles.selectionSubtitle}>{copy.durationQuestion}</Text>
            <View style={styles.durationOptions}>
              {DURATION_OPTIONS.map((option) => {
                const selected = option === duration;

                return (
                  <Pressable
                    key={option}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => selectDuration(option)}
                    style={({ pressed }) => [
                      styles.durationOption,
                      selected && styles.durationOptionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.durationOptionText,
                        selected && styles.durationOptionTextSelected,
                      ]}
                    >
                      {option} hr
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDurationPickerVisible(false)}
              style={({ pressed }) => [styles.modalCancelButton, pressed && styles.pressed]}
            >
              <Text style={styles.modalCancelText}>{copy.durationCancel}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={editSchedule}
        transparent
        visible={scheduleWarning !== null}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel="Close schedule warning"
            onPress={editSchedule}
            style={StyleSheet.absoluteFillObject}
          />
          {scheduleWarning ? (
            <View style={styles.warningSheet}>
              <Text style={styles.selectionTitle}>
                {scheduleWarning.issue === "recruitment_date_in_past"
                  ? copy.pastStartTitle
                  : copy.midnightTitle}
              </Text>
              <Text style={styles.warningMessage}>
                {scheduleWarning.issue === "recruitment_date_in_past"
                  ? copy.pastStartQuestion
                  : copy.midnightQuestion}
              </Text>
              <View style={styles.warningSuggestion}>
                <Text style={styles.warningSuggestionLabel}>{copy.suggestedSchedule}</Text>
                <Text style={styles.warningSuggestionValue}>
                  {`${formatRecruitmentDateForDisplay(scheduleWarning.suggestedDate, language)}${language === "ja" ? " " : " at "}${scheduleWarning.suggestedStartTime}`}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={applyScheduleSuggestion}
                style={({ pressed }) => [styles.warningPrimaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.warningPrimaryText}>{copy.useSuggestion}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={editSchedule}
                style={({ pressed }) => [styles.warningSecondaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.warningSecondaryText}>{copy.editSchedule}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  confirmationScrollContent: {
    paddingBottom: 24,
  },
  confirmationScroll: {
    flex: 1,
  },
  categorySelectionLabel: {
    color: '#1E3A8A',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  categorySelectionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  categorySelectionButton: {
    backgroundColor: '#FFF7CC',
    borderColor: '#F2C94C',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categorySelectionButtonSelected: {
    backgroundColor: '#1E3A8A',
    borderColor: '#1E3A8A',
  },
  categorySelectionText: {
    color: '#1E3A8A',
    fontSize: 14,
    fontWeight: '600',
  },
  categorySelectionTextSelected: {
    color: '#FFFFFF',
  },
  keywordSelectionLabel: {
    color: '#1E3A8A',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  keywordSelectionHint: {
    color: '#6B7280',
    fontSize: 13,
    marginBottom: 8,
  },
  keywordSelectionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  keywordSelectionButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1E3A8A',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  keywordSelectionButtonSelected: {
    backgroundColor: '#F2C94C',
    borderColor: '#F2C94C',
  },
  keywordSelectionText: {
    color: '#1E3A8A',
    fontSize: 14,
    fontWeight: '600',
  },
  keywordSelectionTextSelected: {
    color: '#1E3A8A',
  },
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  panel: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: BLUE,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
  },
  menuBackButton: {
    position: "absolute",
    left: 18,
    zIndex: 2,
    width: 76,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.82)",
    borderRadius: 15,
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
  menuBackButtonText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  compactContent: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: "box-none",
  },
  compactActionRow: {
    position: "absolute",
    top: 45,
    right: 19,
    left: 19,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  compactSearchField: {
    flex: 1,
    minWidth: 0,
    height: 30,
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  compactSearchIcon: {
    position: "absolute",
    left: 14.2,
  },
  compactSearchPlaceholder: {
    paddingRight: 8,
    paddingLeft: 45.34,
    color: PLACEHOLDER_GRAY,
    fontSize: 12,
    fontWeight: "400",
    letterSpacing: 0,
    lineHeight: 15,
  },
  compactNotificationIcon: {
    flexShrink: 0,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  compactProfileIcon: {
    flexShrink: 0,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  compactTitle: {
    position: "absolute",
    top: 108,
    right: 0,
    left: 0,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
    textAlign: "center",
  },
  confirmationContent: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    height: CONFIRMATION_HEADER_HEIGHT,
  },
  confirmationTitle: {
    position: "absolute",
    top: 130,
    right: 0,
    left: 0,
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: "center",
  },
  confirmationExpiry: {
    position: "absolute",
    top: 167,
    right: 0,
    left: 0,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
    textAlign: "center",
  },
  summaryCard: {
    position: "absolute",
    top: 205,
    alignSelf: "center",
    width: 307,
    maxWidth: "78.72%",
    height: 132,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  summaryProfileRow: {
    position: "absolute",
    top: 7,
    left: 22,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
  },
  summaryAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  summaryName: {
    maxWidth: 178,
    marginLeft: 8,
    color: "#000000",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
  },
  summaryFlag: {
    marginLeft: 12,
    color: "#000000",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
  },
  summaryLine: {
    position: "absolute",
    left: 23,
    right: 23,
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 15,
  },
  summaryLabel: {
    fontWeight: "900",
  },
  summaryDate: {
    top: 44,
  },
  summaryTime: {
    top: 68,
  },
  summaryTags: {
    position: "absolute",
    top: 95,
    left: 23,
    height: 25,
    flexDirection: "row",
    gap: 21,
  },
  summaryTag: {
    minWidth: 55,
    maxWidth: 100,
    height: 25,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 5,
    backgroundColor: "#ffffff",
  },
  summaryTagText: {
    color: TEXT_GRAY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 12,
  },
  previewState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 10,
  },
  previewError: {
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
    textAlign: "center",
  },
  retryButton: {
    minWidth: 82,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  retryButtonText: {
    color: BLUE,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 12,
  },
  goButton: {
    position: "absolute",
    top: 359,
    alignSelf: "center",
    width: 159,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: YELLOW,
    boxShadow: "0 4px 2px rgba(0, 0, 0, 0.25)",
  },
  goButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  publishError: {
    position: "absolute",
    top: 393,
    right: 28,
    left: 28,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    textAlign: "center",
  },
  backButton: {
    position: "absolute",
    top: 474,
    left: 30,
    minWidth: 164,
    height: 38,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    boxShadow: "0 4px 2px rgba(0, 0, 0, 0.25)",
  },
  backButtonText: {
    color: YELLOW,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  content: {
    position: "absolute",
    top: 41,
    right: 0,
    left: 0,
    alignItems: "center",
  },
  form: {
    width: 340,
    maxWidth: "87.18%",
    height: 577,
  },
  label: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: "center",
  },
  input: {
    borderRadius: 20,
    backgroundColor: "#ffffff",
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 0,
    boxShadow: "0 4px 4px rgba(0, 0, 0, 0.25)",
  },
  pickerValue: {
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
  },
  descriptionGroup: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    height: 82,
  },
  descriptionInput: {
    position: "absolute",
    top: 27,
    width: "100%",
    height: 59,
    paddingHorizontal: 16,
    paddingVertical: 0,
  },
  whereGroup: {
    position: "absolute",
    top: 101,
    right: 0,
    left: 0,
    height: 82,
  },
  locationField: {
    position: "absolute",
    top: 28,
    width: "100%",
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
  },
  locationSearchIcon: {
    position: "absolute",
    left: 16,
  },
  locationInput: {
    width: "100%",
    height: 34,
    paddingTop: 0,
    paddingRight: 12,
    paddingBottom: 0,
    paddingLeft: 57,
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 0,
  },
  currentLocation: {
    position: "absolute",
    top: 70,
    alignSelf: "center",
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  currentLocationText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  dateGroup: {
    position: "absolute",
    top: 213,
    right: 0,
    left: 0,
    height: 59,
  },
  dateRow: {
    position: "absolute",
    top: 24,
    alignSelf: "center",
    width: 302,
    height: 35,
    flexDirection: "row",
    alignItems: "center",
  },
  dateInput: {
    alignItems: "flex-start",
    justifyContent: "center",
    width: 259,
    height: 35,
    paddingTop: 0,
    paddingRight: 18,
    paddingBottom: 0,
    paddingLeft: 18,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
  },
  calendarButton: {
    width: 43,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
  },
  startTimeGroup: {
    position: "absolute",
    top: 301,
    right: 0,
    left: 0,
    height: 57,
  },
  timeRow: {
    position: "absolute",
    top: 27,
    alignSelf: "center",
    width: 234,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  timePickerButton: {
    width: 190,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    boxShadow: "0 4px 4px rgba(0, 0, 0, 0.25)",
  },
  durationGroup: {
    position: "absolute",
    top: 388,
    right: 0,
    left: 0,
    height: 51,
  },
  durationStepper: {
    position: "absolute",
    top: 22,
    alignSelf: "center",
  },
  durationPickerButton: {
    width: 152,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    boxShadow: "0 4px 4px rgba(0, 0, 0, 0.25)",
  },
  distanceGroup: {
    position: "absolute",
    top: 469,
    right: 0,
    left: 0,
    height: 53,
  },
  distanceRow: {
    position: "absolute",
    top: 28,
    alignSelf: "center",
    width: 236,
    height: 25,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  distanceButton: {
    width: 70,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  distanceButtonSelected: {
    borderColor: YELLOW,
    backgroundColor: YELLOW,
    boxShadow: "0 4px 2px rgba(0, 0, 0, 0.25)",
  },
  distanceText: {
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  distanceTextSelected: {
    color: "#ffffff",
  },
  nextButton: {
    position: "absolute",
    top: 552,
    alignSelf: "center",
    width: 110,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    boxShadow: "0 4px 2px rgba(0, 0, 0, 0.25)",
  },
  nextText: {
    color: YELLOW,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  formError: {
    position: "absolute",
    top: 520,
    right: 14,
    left: 14,
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.28)",
  },
  pickerSheet: {
    minHeight: 286,
    paddingTop: 8,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#ffffff",
  },
  languageLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BLUE,
  },
  pickerHeader: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  pickerHeaderButton: {
    minWidth: 72,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerTitle: {
    flex: 1,
    color: TEXT_GRAY,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  pickerCancelText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "700",
  },
  pickerDoneText: {
    color: BLUE,
    fontSize: 14,
    fontWeight: "900",
  },
  nativePicker: {
    alignSelf: "center",
    width: "100%",
    height: 216,
  },
  selectionSheet: {
    width: "100%",
    paddingTop: 24,
    paddingRight: 22,
    paddingBottom: 18,
    paddingLeft: 22,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#ffffff",
  },
  selectionTitle: {
    color: TEXT_GRAY,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 23,
    textAlign: "center",
  },
  selectionSubtitle: {
    marginTop: 5,
    color: PLACEHOLDER_GRAY,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 17,
    textAlign: "center",
  },
  durationOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginTop: 20,
  },
  durationOption: {
    width: 68,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 14,
    backgroundColor: "#ffffff",
  },
  durationOptionSelected: {
    borderColor: YELLOW,
    backgroundColor: YELLOW,
  },
  durationOptionText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "900",
  },
  durationOptionTextSelected: {
    color: "#ffffff",
  },
  modalCancelButton: {
    alignSelf: "center",
    width: 132,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 19,
    backgroundColor: "#ffffff",
  },
  modalCancelText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "800",
  },
  warningSheet: {
    width: "90%",
    alignSelf: "center",
    padding: 24,
    borderRadius: 24,
    backgroundColor: "#ffffff",
  },
  warningMessage: {
    marginTop: 8,
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },
  warningSuggestion: {
    width: "100%",
    marginTop: 18,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#eff8ff",
  },
  warningSuggestionLabel: {
    color: PLACEHOLDER_GRAY,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 15,
    textAlign: "center",
  },
  warningSuggestionValue: {
    marginTop: 4,
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 20,
    textAlign: "center",
  },
  warningPrimaryButton: {
    width: "100%",
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    borderRadius: 21,
    backgroundColor: YELLOW,
  },
  warningPrimaryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  warningSecondaryButton: {
    width: "100%",
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 21,
    backgroundColor: "#ffffff",
  },
  warningSecondaryText: {
    color: TEXT_GRAY,
    fontSize: 14,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
});
