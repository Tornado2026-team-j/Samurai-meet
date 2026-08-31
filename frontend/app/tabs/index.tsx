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
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DismissKeyboardView from "../../components/DismissKeyboardView";
import { Button, Card, Pill, colors, opacity, radius, shadows, spacing, typography } from "../../components/ui";
import ForeignerHomeScreen from "../foreigner";
import { useAuth } from "../../hooks/useAuth";
import { APIError } from "../../services/api-client";
import {
  resolveCurrentLocationDisplay,
  searchLocationSuggestions,
  type LocationSearchSuggestion,
} from "../../services/location";
import type { Coordinates } from "../../services/matching";
import {
  loadLanguage,
  loadLocalProfile,
  serializeMonsterSeedForLegacyBio,
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
  saveRecruitmentDraft,
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
import { MATCH_CATEGORIES, type MatchCategory } from "../../types/match";
import { formatTimeRange } from "../../utils/time";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const PLACEHOLDER_GRAY = "#949494";
const BORDER_GRAY = "#d4d4d4";
const COLLAPSED_HEADER_HEIGHT = 156;
const EXPANDED_HEADER_HEIGHT = 760;
const CONFIRMATION_HEADER_HEIGHT = 542;
const EXPANSION_DURATION = 360;
const RECRUITMENT_CATEGORIES = MATCH_CATEGORIES;
const MIN_DURATION_HOURS = 0.5;
const MAX_DURATION_HOURS = 8;
const DURATION_STEP_HOURS = 0.5;
const LOCATION_SEARCH_DEBOUNCE_MS = 300;

const RECRUITMENT_COPY = {
  en: {
    backToHome: "Back to home",
    back: "BACK",
    activityLabel: "What would you like to do?",
    activityAccessibilityLabel: "Activity description",
    activityPlaceholder: "Describe the plan, place, and details",
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
    decreaseDuration: "Decrease duration",
    increaseDuration: "Increase duration",
    participantsLabel: "People needed",
    participantsAccessibilityLabel: "Number of people needed",
    decreaseParticipants: "Decrease number of people",
    increaseParticipants: "Increase number of people",
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
    saveDraft: "SAVE DRAFT",
    savingDraft: "Saving draft...",
    draftSaved: "Draft saved.",
    draftSaveFailed: "The draft could not be saved. Please try again.",
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
    currentLocationResolving: "Finding your area...",
    currentLocationFallback: "Current location",
    noLocationResults: "No places found",
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
    locationRequired: "Choose a valid place for Where.",
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
    activityPlaceholder: "内容・場所・希望を詳しく入力",
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
    decreaseDuration: "所要時間を短くする",
    increaseDuration: "所要時間を長くする",
    participantsLabel: "募集人数",
    participantsAccessibilityLabel: "募集人数",
    decreaseParticipants: "募集人数を減らす",
    increaseParticipants: "募集人数を増やす",
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
    saveDraft: "下書き保存",
    savingDraft: "下書き保存中…",
    draftSaved: "下書きを保存しました。",
    draftSaveFailed: "下書きを保存できませんでした。もう一度お試しください。",
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
    currentLocationResolving: "現在地を確認中…",
    currentLocationFallback: "現在地",
    noLocationResults: "候補が見つかりません",
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
    locationRequired: "Whereで有効な場所を選択してください。",
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
type DraftSaveStatus = "idle" | "saving" | "saved";
type ScheduleWarning = {
  issue: RecruitmentScheduleIssue;
  suggestedDate: string;
  suggestedStartTime: string;
  fromConfirmation: boolean;
};

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
  if (duration === 0.5) return language === "ja" ? "30分" : "30min";
  const label = Number.isInteger(duration) ? String(duration) : duration.toFixed(1);
  return language === "ja" ? `${label}時間` : `${label}hr`;
}

function clampDuration(value: number): number {
  const stepped = Math.round(value / DURATION_STEP_HOURS) * DURATION_STEP_HOURS;
  return Math.min(MAX_DURATION_HOURS, Math.max(MIN_DURATION_HOURS, stepped));
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
  const { height: windowHeight } = useWindowDimensions();
  const { getCurrentSession, refresh, session, status } = useAuth();
  const { query } = useLocalSearchParams<{ query?: string | string[] }>();
  const initialQuery = Array.isArray(query) ? query[0] : query;
  const [language, setLanguage] = useState<AppLanguage>("en");
  const suggestedSchedule = useMemo(() => defaultRecruitmentSchedule(), []);
  const suggestedDate = suggestedSchedule.date;
  const [description, setDescription] = useState(initialQuery ?? "");
  const [location, setLocation] = useState("");
  const [selectedLocationCoordinates, setSelectedLocationCoordinates] =
    useState<Coordinates | null>(null);
  const [selectedLocationLabel, setSelectedLocationLabel] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSearchSuggestion[]>([]);
  const [locationSearchStatus, setLocationSearchStatus] =
    useState<"idle" | "loading" | "error">("idle");
  const [date, setDate] = useState(suggestedDate);
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);
  const [hour, setHour] = useState(() => Number(suggestedSchedule.startTime.slice(0, 2)));
  const [minute, setMinute] = useState(() => Number(suggestedSchedule.startTime.slice(3, 5)));
  const [duration, setDuration] = useState(suggestedSchedule.durationHours);
  const [participantLimit, setParticipantLimit] = useState(1);
  const [distance, setDistance] = useState<RecruitmentDistanceKm>(3);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
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
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>("idle");
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [savedDraftID, setSavedDraftID] = useState<string | null>(null);
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
  const maximumDate = useMemo(() => {
    const nextMaximum = new Date(minimumDate);
    nextMaximum.setUTCMonth(nextMaximum.getUTCMonth() + 2);
    nextMaximum.setUTCHours(23, 59, 59, 999);
    return nextMaximum;
  }, [minimumDate]);
  const copy = RECRUITMENT_COPY[language];
  const pickerLocale = language === "ja" ? "ja-JP" : "en-US";
  const expandedPanelHeight = Math.min(
    EXPANDED_HEADER_HEIGHT,
    Math.max(COLLAPSED_HEADER_HEIGHT, windowHeight),
  );
  const confirmationPanelHeight = Math.min(
    CONFIRMATION_HEADER_HEIGHT,
    Math.max(COLLAPSED_HEADER_HEIGHT, windowHeight),
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active && nextLanguage) setLanguage(nextLanguage);
    });

    void loadLanguage()
      .then((storedLanguage) => {
        if (!active) return;
        setLanguage(storedLanguage ?? "en");
      })
      .catch(() => {
        if (!active) return;
        setLanguage("en");
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
        toValue: expandedPanelHeight,
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
    expandedPanelHeight,
    panelHeight,
  ]);

  useEffect(() => {
    if (!useCurrentLocation) return;

    let active = true;
    setLocationSearchStatus("loading");
    setLocationSuggestions([]);
    void resolveCurrentLocationDisplay()
      .then((result) => {
        if (!active) return;
        const displayName = result?.displayName ?? copy.currentLocationFallback;
        setLocation(displayName);
        setSelectedLocationLabel(displayName);
        setSelectedLocationCoordinates(result?.coordinates ?? null);
        setLocationSearchStatus("idle");
      })
      .catch(() => {
        if (!active) return;
        setLocation(copy.currentLocationFallback);
        setSelectedLocationLabel(copy.currentLocationFallback);
        setSelectedLocationCoordinates(null);
        setLocationSearchStatus("error");
      });

    return () => {
      active = false;
    };
  }, [copy.currentLocationFallback, useCurrentLocation]);

  useEffect(() => {
    if (useCurrentLocation) return;

    const trimmedLocation = location.trim();
    if (trimmedLocation.length < 2) {
      setLocationSuggestions([]);
      setLocationSearchStatus("idle");
      return;
    }
    if (selectedLocationCoordinates && trimmedLocation === selectedLocationLabel) {
      setLocationSuggestions([]);
      setLocationSearchStatus("idle");
      return;
    }

    let active = true;
    setLocationSearchStatus("loading");
    const timeout = setTimeout(() => {
      void searchLocationSuggestions(trimmedLocation)
        .then((suggestions) => {
          if (!active) return;
          setLocationSuggestions(suggestions);
          setLocationSearchStatus("idle");
        })
        .catch(() => {
          if (!active) return;
          setLocationSuggestions([]);
          setLocationSearchStatus("error");
        });
    }, LOCATION_SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [location, selectedLocationCoordinates, selectedLocationLabel, useCurrentLocation]);

  useEffect(
    () => () => {
      previewRequestRef.current?.abort();
    },
    [],
  );

  const createDraft = (): RecruitmentDraft => ({
    activity: description.trim() || "Explore Osaka with a local",
    location: location.trim() || (useCurrentLocation ? copy.currentLocationFallback : "Osaka,Umeda"),
    useCurrentLocation,
    date: date.trim() || suggestedDate,
    startTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    durationHours: duration,
    participantLimit,
    distanceKm: distance,
  });

  const clearScheduleMessages = () => {
    setFormError(null);
    setPublishError(null);
  };

  const commitDate = (value: Date) => {
    try {
      const nextDate = formatRecruitmentISODate(value);
      const nextPickerDate = safeParseRecruitmentDate(nextDate, minimumDate);
      if (nextPickerDate < minimumDate || nextPickerDate > maximumDate) {
        throw new Error("invalid_recruitment_date");
      }
      setPickerDate(nextPickerDate);
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
        const nextPickerDate = safeParseRecruitmentDate(nextDate, minimumDate);
        if (nextPickerDate <= maximumDate) {
          setPickerDate(nextPickerDate);
        }
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

  const adjustDuration = (amount: number) => {
    setDuration((current) => clampDuration(current + amount));
    clearScheduleMessages();
  };

  const handleLocationChange = (value: string) => {
    setLocation(value);
    setSelectedLocationCoordinates(null);
    setSelectedLocationLabel("");
  };

  const selectLocationSuggestion = (suggestion: LocationSearchSuggestion) => {
    setLocation(suggestion.label);
    setSelectedLocationLabel(suggestion.label);
    setSelectedLocationCoordinates(suggestion.coordinates);
    setLocationSuggestions([]);
    setLocationSearchStatus("idle");
    Keyboard.dismiss();
  };

  const toggleUseCurrentLocation = () => {
    setUseCurrentLocation((current) => {
      const next = !current;
      if (!next) {
        setLocation("");
        setSelectedLocationLabel("");
        setSelectedLocationCoordinates(null);
        setLocationSuggestions([]);
        setLocationSearchStatus("idle");
      }
      return next;
    });
  };

  const resolveWhereCoordinates = async (): Promise<Coordinates | null> => {
    if (selectedLocationCoordinates) return selectedLocationCoordinates;

    setLocationSearchStatus("loading");
    try {
      if (useCurrentLocation) {
        const result = await resolveCurrentLocationDisplay();
        if (!result) return null;
        setLocation(result.displayName);
        setSelectedLocationLabel(result.displayName);
        setSelectedLocationCoordinates(result.coordinates);
        return result.coordinates;
      }

      if (location.trim().length < 2) return null;
      const [suggestion] = await searchLocationSuggestions(location);
      if (!suggestion) return null;
      setLocation(suggestion.label);
      setSelectedLocationLabel(suggestion.label);
      setSelectedLocationCoordinates(suggestion.coordinates);
      setLocationSuggestions([]);
      return suggestion.coordinates;
    } finally {
      setLocationSearchStatus("idle");
    }
  };

  const closeToHome = () => {
    Keyboard.dismiss();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/foreigner");
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

  const showConfirmation = async (draft = createDraft()) => {
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

    const coordinates = await resolveWhereCoordinates();
    if (!coordinates) {
      setFormError(RECRUITMENT_COPY[language].locationRequired);
      return;
    }

    Keyboard.dismiss();
    void loadPreview(draft);
    setDraftSaveStatus("idle");
    setDraftSaveError(null);
    confirmationOpacity.setValue(0);
    confirmationTranslateY.setValue(14);
    setIsConfirmationVisible(true);

    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(panelHeight, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
          toValue: confirmationPanelHeight,
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
    void showConfirmation(nextDraft);
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
    if (
      publishStatus === "publishing" ||
      draftSaveStatus === "saving" ||
      previewStatus !== "success" ||
      !preview
    ) {
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
          bio: serializeMonsterSeedForLegacyBio(localProfile),
        });
      }

      const coordinates = await resolveWhereCoordinates();
      if (!coordinates) {
        setPublishError(RECRUITMENT_COPY[language].locationRequired);
        return;
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
        savedDraftID ?? undefined,
      );
      setSavedDraftID(null);
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

  const saveDraft = async () => {
    if (draftSaveStatus === "saving" || previewStatus !== "success" || !preview) {
      return;
    }

    Keyboard.dismiss();
    setDraftSaveStatus("saving");
    setDraftSaveError(null);
    let saved = false;
    const draft = createDraft();

    try {
      const scheduleIssue = getRecruitmentScheduleIssue(draft);
      if (scheduleIssue === "recruitment_must_end_same_day") {
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

      const coordinates = selectedLocationCoordinates ?? await resolveWhereCoordinates();
      if (!coordinates) {
        setDraftSaveError(RECRUITMENT_COPY[language].locationRequired);
        return;
      }

      const selection: RecruitmentSelection = {
        category: selectedCategory ?? preview.category,
        keywords: selectedKeywords,
      };
      const savedRecruitment = await saveRecruitmentDraft(
        draft,
        preview,
        activeSession,
        coordinates,
        undefined,
        selection,
        savedDraftID ?? undefined,
      );
      setSavedDraftID(savedRecruitment.id);
      setDraftSaveStatus("saved");
      saved = true;
    } catch (error) {
      const localMessage = recruitmentInputMessage(error, language);
      if (error instanceof APIError && error.code === "missing_or_invalid_access_token") {
        setDraftSaveError(RECRUITMENT_COPY[language].expiredSession);
      } else if (error instanceof Error && error.message === "not_signed_in") {
        setDraftSaveError(RECRUITMENT_COPY[language].notSignedIn);
      } else {
        setDraftSaveError(localMessage ?? RECRUITMENT_COPY[language].draftSaveFailed);
      }
    } finally {
      if (!saved) {
        setDraftSaveStatus("idle");
      }
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
        toValue: expandedPanelHeight,
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

  return (
    <View style={styles.screen}>
      <View pointerEvents="none" style={styles.homeLayer}>
        <ForeignerHomeScreen />
      </View>
      <Pressable
        accessibilityLabel={copy.backToHome}
        accessibilityRole="button"
        onPress={closeToHome}
        style={styles.homeDismissLayer}
      />
      <StatusBar style="light" />

      <Animated.View
        style={[styles.panel, { height: panelHeight }]}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
          style={styles.formKeyboardAvoiding}
        >
          <DismissKeyboardView style={styles.formDismissLayer}>
            <ScrollView
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={[
                styles.formScrollContent,
                {
                  paddingBottom: Math.max(insets.bottom + 24, 40),
                  paddingTop: Math.max(insets.top + 10, 41),
                },
              ]}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              style={styles.formScroll}
            >
              <Animated.View
                accessibilityElementsHidden={isConfirmationVisible}
                importantForAccessibility={
                  isConfirmationVisible ? "no-hide-descendants" : "auto"
                }
                pointerEvents={isConfirmationVisible ? "none" : "auto"}
                style={[
                  styles.content,
                  {
                    opacity: contentOpacity,
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
                placeholderTextColor={colors.text.muted}
                returnKeyType="done"
                style={[styles.input, styles.descriptionInput]}
                value={description}
              />
            </View>

            <View style={styles.whereGroup}>
              <Text style={styles.label}>{copy.whereLabel}</Text>
              <View style={[
                styles.input,
                styles.locationField,
                useCurrentLocation && styles.locationFieldDisabled,
              ]}>
                <MaterialIcons
                  color={colors.text.muted}
                  name="search"
                  size={27}
                  style={styles.locationSearchIcon}
                />
                <TextInput
                  accessibilityLabel={copy.locationAccessibilityLabel}
                  blurOnSubmit
                  editable={!useCurrentLocation}
                  onChangeText={handleLocationChange}
                  onSubmitEditing={() => Keyboard.dismiss()}
                  placeholder={
                    useCurrentLocation
                      ? copy.currentLocationResolving
                      : copy.locationPlaceholder
                  }
                  placeholderTextColor={colors.text.muted}
                  returnKeyType="search"
                  style={styles.locationInput}
                  value={location}
                />
                {locationSearchStatus === "loading" ? (
                  <ActivityIndicator
                    color={colors.brand.gold}
                    size="small"
                    style={styles.locationStatusIcon}
                  />
                ) : null}
              </View>

              <Pressable
                accessibilityLabel={copy.useCurrentLocationAccessibilityLabel}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: useCurrentLocation }}
                onPress={toggleUseCurrentLocation}
                style={({ pressed }) => [
                  styles.currentLocation,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.currentLocationCheckbox}>
                  {useCurrentLocation ? (
                    <MaterialIcons color={colors.brand.gold} name="check" size={21} />
                  ) : null}
                </View>
                <Text style={styles.currentLocationText}>{copy.useCurrentLocation}</Text>
              </Pressable>

              {!useCurrentLocation && location.trim().length >= 2 ? (
                <View style={styles.locationSuggestions}>
                  {locationSuggestions.length > 0 ? (
                    locationSuggestions.map((suggestion) => (
                      <Pressable
                        key={suggestion.id}
                        accessibilityRole="button"
                        onPress={() => selectLocationSuggestion(suggestion)}
                        style={({ pressed }) => [
                          styles.locationSuggestion,
                          pressed && styles.pressed,
                        ]}
                      >
                        <MaterialIcons color={colors.brand.gold} name="place" size={18} />
                        <View style={styles.locationSuggestionTextGroup}>
                          <Text numberOfLines={1} style={styles.locationSuggestionLabel}>
                            {suggestion.label}
                          </Text>
                          <Text numberOfLines={1} style={styles.locationSuggestionSubtitle}>
                            {suggestion.subtitle}
                          </Text>
                        </View>
                      </Pressable>
                    ))
                  ) : locationSearchStatus === "idle" ? (
                    <Text style={styles.locationSuggestionEmpty}>
                      {copy.noLocationResults}
                    </Text>
                  ) : null}
                </View>
              ) : null}
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
                  <MaterialIcons color={colors.text.inverse} name="calendar-today" size={25} />
                </Pressable>
              </View>
            </View>

            <View style={styles.startTimeGroup}>
              <Text style={styles.label}>{copy.startTimeLabel}</Text>
              <View style={styles.timeRow}>
                <Pressable
                  accessibilityLabel={copy.startTimeAccessibilityLabel}
                  accessibilityHint={copy.startTimeAccessibilityHint}
                  accessibilityRole="button"
                  onPress={openTimePicker}
                  style={({ pressed }) => [
                    styles.timePickerButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <MaterialIcons color={colors.brand.gold} name="access-time" size={18} />
                  <Text style={styles.pickerValue}>
                    {`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}
                  </Text>
                  <MaterialIcons color={colors.brand.gold} name="expand-more" size={20} />
                </Pressable>
              </View>
            </View>

            <View style={styles.durationGroup}>
              <Text style={styles.label}>{copy.durationLabel}</Text>
              <View style={styles.durationStepper}>
                <Pressable
                  accessibilityLabel={copy.decreaseDuration}
                  accessibilityRole="button"
                  disabled={duration <= MIN_DURATION_HOURS}
                  onPress={() => adjustDuration(-DURATION_STEP_HOURS)}
                  style={({ pressed }) => [
                    styles.durationStepButton,
                    duration <= MIN_DURATION_HOURS && styles.buttonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.durationStepText}>-</Text>
                </Pressable>
                <Text
                  accessibilityLabel={copy.durationAccessibilityLabel}
                  style={styles.durationValue}
                >
                  {formatDurationLabel(duration, language)}
                </Text>
                <Pressable
                  accessibilityLabel={copy.increaseDuration}
                  accessibilityRole="button"
                  disabled={duration >= MAX_DURATION_HOURS}
                  onPress={() => adjustDuration(DURATION_STEP_HOURS)}
                  style={({ pressed }) => [
                    styles.durationStepButton,
                    duration >= MAX_DURATION_HOURS && styles.buttonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.durationStepText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.participantsGroup}>
              <Text style={styles.label}>{copy.participantsLabel}</Text>
              <View style={styles.durationStepper}>
                <Pressable
                  accessibilityLabel={copy.decreaseParticipants}
                  accessibilityRole="button"
                  disabled={participantLimit <= 1}
                  onPress={() => setParticipantLimit((current) => Math.max(1, current - 1))}
                  style={({ pressed }) => [
                    styles.durationStepButton,
                    participantLimit <= 1 && styles.buttonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.durationStepText}>-</Text>
                </Pressable>
                <Text accessibilityLabel={copy.participantsAccessibilityLabel} style={styles.durationValue}>
                  {language === "ja" ? `${participantLimit}人` : `${participantLimit}`}
                </Text>
                <Pressable
                  accessibilityLabel={copy.increaseParticipants}
                  accessibilityRole="button"
                  disabled={participantLimit >= 10}
                  onPress={() => setParticipantLimit((current) => Math.min(10, current + 1))}
                  style={({ pressed }) => [
                    styles.durationStepButton,
                    participantLimit >= 10 && styles.buttonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.durationStepText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.distanceGroup}>
              <Text style={styles.label}>{copy.distanceLabel}</Text>
              <View style={styles.distanceRow}>
                {[1, 3, 5].map((option) => {
                  const selected = distance === option;

                  return (
                    <Pill
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setDistance(option as RecruitmentDistanceKm)}
                      selected={selected}
                      style={styles.distanceButton}
                      textStyle={[styles.distanceText, selected && styles.distanceTextSelected]}
                    >
                      {`${option}km`}
                    </Pill>
                  );
                })}
              </View>
            </View>

            <Button
              disabled={previewStatus === "loading" || locationSearchStatus === "loading"}
              onPress={() => {
                void showConfirmation();
              }}
              size="sm"
              style={styles.nextButton}
              textStyle={styles.nextText}
              variant="secondary"
            >
              {copy.next}
            </Button>

            {formError ? (
              <Text accessibilityRole="alert" style={styles.formError}>
                {formError}
              </Text>
            ) : null}
              </View>
              </Animated.View>
            </ScrollView>
          </DismissKeyboardView>
        </KeyboardAvoidingView>

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
              contentContainerStyle={[
                styles.confirmationScrollContent,
                { paddingTop: Math.max(insets.top + 20, 34) },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              style={styles.confirmationScroll}
            >
              <Text style={styles.confirmationTitle}>{copy.confirmationTitle}</Text>
              <Text style={styles.confirmationExpiry}>
                {copy.confirmationExpiry} {preview ? formatPreviewExpiry(preview, language) : copy.expiryFallback}
              </Text>

              <Card style={styles.summaryCard}>
                {previewStatus === "loading" && (
                  <View style={styles.previewState}>
                    <ActivityIndicator color={BLUE} size="small" />
                  </View>
                )}

                {previewStatus === "error" && (
                  <View style={styles.previewState}>
                    <Text style={styles.previewError}>{previewError}</Text>
                    <Button onPress={() => void loadPreview()} size="sm" style={styles.retryButton} textStyle={styles.retryButtonText} variant="secondary">
                      {copy.tryAgain}
                    </Button>
                  </View>
                )}

                {previewStatus === "success" && preview && (
                  <>
                    <View style={styles.summaryProfileRow}>
                      {preview.author.avatarUrl ? (
                        <Image accessibilityLabel={`${preview.author.displayName}'s profile image`} source={{ uri: preview.author.avatarUrl }} style={styles.summaryAvatar} />
                      ) : (
                        <MaterialIcons color={colors.border.default} name="account-circle" size={30} />
                      )}
                      <Text numberOfLines={1} style={styles.summaryName}>{preview.author.displayName}</Text>
                      <Text style={styles.summaryFlag}>{countryCodeToFlag(preview.author.countryCode)}</Text>
                    </View>
                    <Text style={[styles.summaryLine, styles.summaryCategory]}>
                      <Text style={styles.summaryLabel}>{copy.categoryLabel}</Text>
                      {`   ${selectedCategory ?? preview.category}`}
                    </Text>
                    <Text numberOfLines={1} style={[styles.summaryLine, styles.summaryDate]}>
                      <Text style={styles.summaryLabel}>{copy.summaryDate}</Text>
                      {`   ${formatRecruitmentDateForDisplay(preview.conditions.date, language)}`}
                    </Text>
                    <Text style={[styles.summaryLine, styles.summaryTime]}>
                      <Text style={styles.summaryLabel}>{copy.summaryTime}</Text>
                      {`   ${formatTimeRange(preview.conditions.startTime, preview.conditions.durationHours)}`}
                    </Text>
                    <View style={styles.summaryTags}>
                      {selectedKeywords.map((tag) => (
                        <Pill key={tag} style={styles.summaryTag} textStyle={styles.summaryTagText} variant="primary">
                          {translatePreviewTag(tag, language)}
                        </Pill>
                      ))}
                    </View>
                  </>
                )}
              </Card>

              {previewStatus === "success" && preview ? (
                <>
                  <Text style={styles.categorySelectionLabel}>{copy.categoryLabel}</Text>
                  <View accessibilityLabel={copy.categoryLabel} accessibilityRole="radiogroup" style={styles.categorySelectionRow}>
                    {RECRUITMENT_CATEGORIES.map((category) => {
                      const selected = selectedCategory === category;
                      return (
                        <Pressable key={category} accessibilityLabel={category} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setSelectedCategory(category)} style={({ pressed }) => [styles.categorySelectionButton, selected && styles.categorySelectionButtonSelected, pressed && styles.pressed]}>
                          <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={[styles.categorySelectionText, selected && styles.categorySelectionTextSelected]}>{category}</Text>
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
                        <Pressable key={tag} accessibilityLabel={translatePreviewTag(tag, language)} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => setSelectedKeywords((current) => selected ? current.filter((keyword) => keyword !== tag) : [...current, tag])} style={({ pressed }) => [styles.keywordSelectionButton, selected && styles.keywordSelectionButtonSelected, pressed && styles.pressed]}>
                          <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={[styles.keywordSelectionText, selected && styles.keywordSelectionTextSelected]}>{translatePreviewTag(tag, language)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <Button
                accessibilityLabel={draftSaveStatus === "saving" ? copy.savingDraft : copy.saveDraft}
                accessibilityState={{
                  disabled:
                    previewStatus !== "success" ||
                    publishStatus === "publishing" ||
                    draftSaveStatus === "saving",
                  busy: draftSaveStatus === "saving",
                }}
                disabled={
                  previewStatus !== "success" ||
                  publishStatus === "publishing" ||
                  draftSaveStatus === "saving"
                }
                loading={draftSaveStatus === "saving"}
                onPress={() => void saveDraft()}
                size="sm"
                style={styles.draftButton}
                textStyle={styles.draftButtonText}
                variant="secondary"
              >
                {copy.saveDraft}
              </Button>
              {draftSaveStatus === "saved" ? (
                <Text style={styles.draftSaved}>{copy.draftSaved}</Text>
              ) : null}
              {draftSaveError ? (
                <Text accessibilityRole="alert" style={styles.draftSaveError}>
                  {draftSaveError}
                </Text>
              ) : null}

              <Button
                accessibilityState={{
                  disabled:
                    previewStatus !== "success" ||
                    publishStatus === "publishing" ||
                    draftSaveStatus === "saving",
                }}
                disabled={
                  previewStatus !== "success" ||
                  publishStatus === "publishing" ||
                  draftSaveStatus === "saving"
                }
                onPress={() => void publish()}
                size="sm"
                style={styles.goButton}
                textStyle={styles.goButtonText}
              >
                {publishStatus === "publishing" ? copy.publishing : copy.go}
              </Button>

              {publishError ? (
                <Text accessibilityRole="alert" style={styles.publishError}>
                  {publishError}
                </Text>
              ) : null}

            </ScrollView>
            <View
              style={[
                styles.confirmationFooter,
                { paddingBottom: Math.max(insets.bottom, 14) },
              ]}
            >
              <Button
                accessibilityLabel={copy.backToFilters}
                iconLeft={<MaterialIcons color={colors.brand.gold} name="arrow-back" size={18} />}
                onPress={showFilters}
                size="sm"
                style={styles.backButton}
                textStyle={styles.backButtonText}
                variant="secondary"
              >
                {copy.back}
              </Button>
            </View>
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
          maximumDate={maximumDate}
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
              accessibilityLabel={copy.closeDatePicker}
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
                 locale={pickerLocale}
                maximumDate={maximumDate}
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
              accessibilityLabel={copy.closeTimePicker}
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
                <Text style={styles.pickerTitle}>{copy.pickerTimeTitle}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => commitTime(pickerTime)}
                  style={styles.pickerHeaderButton}
                >
                  <Text style={styles.pickerDoneText}>{copy.pickerDone}</Text>
                </Pressable>
              </View>
              <DateTimePicker
                accentColor={BLUE}
                display="spinner"
                is24Hour
                 locale={pickerLocale}
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
        onRequestClose={editSchedule}
        transparent
        visible={scheduleWarning !== null}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel={copy.closeScheduleWarning}
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
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  confirmationScroll: {
    flex: 1,
  },
  categorySelectionLabel: {
    width: "100%",
    maxWidth: 340,
    marginTop: 20,
    color: '#1E3A8A',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  categorySelectionRow: {
    width: "100%",
    maxWidth: 340,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  categorySelectionButton: {
    maxWidth: "100%",
    flexShrink: 1,
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
    flexShrink: 1,
    color: '#1E3A8A',
    fontSize: 14,
    fontWeight: '600',
  },
  categorySelectionTextSelected: {
    color: '#FFFFFF',
  },
  keywordSelectionLabel: {
    width: "100%",
    maxWidth: 340,
    marginTop: 4,
    color: '#1E3A8A',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  keywordSelectionHint: {
    width: "100%",
    maxWidth: 340,
    color: '#6B7280',
    fontSize: 13,
    marginBottom: 8,
  },
  keywordSelectionRow: {
    width: "100%",
    maxWidth: 340,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  keywordSelectionButton: {
    maxWidth: "100%",
    flexShrink: 1,
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
    flexShrink: 1,
    color: '#1E3A8A',
    fontSize: 14,
    fontWeight: '600',
  },
  keywordSelectionTextSelected: {
    color: '#1E3A8A',
  },
  screen: {
    flex: 1,
    backgroundColor: colors.surface.screen,
  },
  homeLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  homeDismissLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    backgroundColor: "transparent",
  },
  panel: {
    width: "100%",
    zIndex: 2,
    overflow: "hidden",
    backgroundColor: colors.brand.sky,
    borderBottomLeftRadius: radius.header,
    borderBottomRightRadius: radius.header,
  },
  menuBackButton: {
    position: "absolute",
    left: 18,
    zIndex: 2,
    width: 76,
    height: 30,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.default,
    ...shadows.action,
  },
  menuBackButtonText: {
    color: colors.brand.gold,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
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
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface.default,
    ...shadows.control,
  },
  compactSearchIcon: {
    position: "absolute",
    left: 14.2,
  },
  compactSearchPlaceholder: {
    paddingRight: 8,
    paddingLeft: 45.34,
    color: colors.text.muted,
    ...typography.small,
    fontWeight: "400",
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
    color: colors.text.inverse,
    ...typography.subheading,
    lineHeight: 19,
    textAlign: "center",
  },
  confirmationContent: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  confirmationTitle: {
    width: "100%",
    color: colors.text.inverse,
    ...typography.body,
    fontWeight: "900",
    lineHeight: 18,
    textAlign: "center",
  },
  confirmationExpiry: {
    width: "100%",
    marginTop: 6,
    color: colors.text.inverse,
    ...typography.subheading,
    lineHeight: 19,
    textAlign: "center",
  },
  summaryCard: {
    width: "100%",
    maxWidth: 340,
    minHeight: 132,
    marginTop: 18,
    padding: 16,
    borderWidth: 0,
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface.default,
    boxShadow: "none",
  },
  summaryProfileRow: {
    width: "100%",
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
  },
  summaryAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  summaryName: {
    minWidth: 0,
    flex: 1,
    marginLeft: 8,
    color: colors.text.black,
    ...typography.subheading,
    lineHeight: 19,
  },
  summaryFlag: {
    flexShrink: 0,
    marginLeft: 8,
    color: colors.text.black,
    ...typography.subheading,
    lineHeight: 19,
  },
  summaryLine: {
    width: "100%",
    marginTop: 10,
    color: colors.text.secondary,
    ...typography.smallStrong,
    lineHeight: 15,
  },
  summaryLabel: {
    fontWeight: "900",
  },
  summaryDate: {
    marginTop: 13,
  },
  summaryCategory: {
    marginTop: 10,
  },
  summaryTime: {
    marginTop: 5,
  },
  summaryTags: {
    width: "100%",
    marginTop: 11,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  summaryTag: {
    minHeight: 25,
    maxWidth: "100%",
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
  },
  summaryTagText: {
    flexShrink: 1,
    color: colors.text.secondary,
    ...typography.micro,
  },
  previewState: {
    minHeight: 100,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 10,
  },
  previewError: {
    color: colors.text.secondary,
    ...typography.small,
    lineHeight: 15,
    textAlign: "center",
  },
  retryButton: {
    minWidth: 82,
    height: 25,
    minHeight: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.brand.sky,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.default,
  },
  retryButtonText: {
    color: colors.brand.sky,
    ...typography.micro,
    fontWeight: "900",
  },
  goButton: {
    marginTop: 20,
    alignSelf: "center",
    width: 159,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brand.gold,
    ...shadows.action,
  },
  draftButton: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 340,
    minHeight: 40,
    marginTop: spacing.xl,
    borderColor: colors.brand.gold,
    borderRadius: radius.pill,
  },
  draftButtonText: {
    color: colors.brand.gold,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
  },
  draftSaved: {
    width: "100%",
    maxWidth: 340,
    marginTop: spacing.sm,
    color: colors.text.inverse,
    ...typography.small,
    textAlign: "center",
  },
  draftSaveError: {
    width: "100%",
    maxWidth: 340,
    marginTop: spacing.sm,
    color: colors.text.inverse,
    ...typography.small,
    textAlign: "center",
  },
  goButtonText: {
    color: colors.text.inverse,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  publishError: {
    width: "100%",
    maxWidth: 340,
    marginTop: 8,
    color: colors.text.inverse,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    textAlign: "center",
  },
  confirmationFooter: {
    flexShrink: 0,
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 8,
    backgroundColor: colors.brand.sky,
  },
  backButton: {
    width: 110,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.default,
    ...shadows.action,
  },
  backButtonText: {
    color: colors.brand.gold,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  buttonDisabled: {
    opacity: opacity.disabled,
  },
  content: {
    width: "100%",
    alignItems: "center",
  },
  formKeyboardAvoiding: {
    flex: 1,
  },
  formDismissLayer: {
    flex: 1,
  },
  formScroll: {
    flex: 1,
  },
  formScrollContent: {
    flexGrow: 1,
    alignItems: "center",
  },
  form: {
    width: 340,
    maxWidth: "87.18%",
    height: 674,
  },
  label: {
    color: colors.text.inverse,
    ...typography.body,
    fontWeight: "900",
    lineHeight: 18,
    textAlign: "center",
  },
  input: {
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface.default,
    color: colors.text.secondary,
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 0,
    ...shadows.control,
  },
  pickerValue: {
    color: colors.text.secondary,
    ...typography.caption,
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
    borderColor: colors.border.default,
  },
  locationFieldDisabled: {
    backgroundColor: "rgba(255, 255, 255, 0.94)",
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
    color: colors.text.secondary,
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 0,
  },
  locationStatusIcon: {
    position: "absolute",
    right: 12,
  },
  locationSuggestions: {
    position: "absolute",
    top: 66,
    right: 0,
    left: 0,
    zIndex: 3,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.default,
    ...shadows.control,
  },
  locationSuggestion: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  locationSuggestionTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  locationSuggestionLabel: {
    color: colors.text.secondary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 17,
  },
  locationSuggestionSubtitle: {
    color: colors.text.muted,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 13,
  },
  locationSuggestionEmpty: {
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 16,
    textAlign: "center",
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
  currentLocationCheckbox: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.text.inverse,
    borderRadius: radius.xs,
    backgroundColor: colors.text.inverse,
  },
  currentLocationText: {
    color: colors.text.inverse,
    ...typography.body,
    fontWeight: "900",
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
    borderColor: colors.border.default,
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
    borderColor: colors.border.default,
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface.default,
    ...shadows.control,
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
    width: 152,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface.default,
    ...shadows.control,
  },
  durationStepButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  durationStepText: {
    color: colors.brand.gold,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 22,
  },
  durationValue: {
    flex: 1,
    color: colors.text.secondary,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 17,
    textAlign: "center",
  },
  participantsGroup: {
    position: "absolute",
    top: 463,
    right: 0,
    left: 0,
    height: 51,
  },
  distanceGroup: {
    position: "absolute",
    top: 536,
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
    minHeight: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.default,
  },
  distanceButtonSelected: {
    borderColor: colors.brand.gold,
    backgroundColor: colors.brand.gold,
    ...shadows.action,
  },
  distanceText: {
    color: colors.text.secondary,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  distanceTextSelected: {
    color: colors.text.inverse,
  },
  nextButton: {
    position: "absolute",
    top: 619,
    alignSelf: "center",
    width: 110,
    height: 25,
    minHeight: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.default,
    ...shadows.action,
  },
  nextText: {
    color: colors.brand.gold,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  formError: {
    position: "absolute",
    top: 654,
    right: 14,
    left: 14,
    color: colors.text.inverse,
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
    backgroundColor: colors.surface.default,
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
