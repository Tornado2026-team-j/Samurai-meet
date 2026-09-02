import { buildRecruitmentPreview } from "../mocks/recruitment";
import type { Session } from "./auth-contract";
import {
  createRecruitment,
  updateRecruitment,
  type Coordinates,
  type RecruitmentCreateRequest,
} from "./matching";
import { requestAPI } from "./api-client";
import { isMatchCategory, type MatchCategory } from "../types/match";
import type {
  RecruitmentDraft,
  RecruitmentPreview,
} from "../types/recruitment";

type RecruitmentClassificationResponse = {
  data?: {
    category?: unknown;
    keywords?: unknown;
  };
};

export type RecruitmentSelection = {
  category: MatchCategory;
  keywords: string[];
};

export function normalizeRecruitmentKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const keyword = item.trim().replace(/\s+/gu, " ");
    if (!keyword || seen.has(keyword.toLocaleLowerCase())) continue;
    seen.add(keyword.toLocaleLowerCase());
    normalized.push(keyword.slice(0, 80));
    if (normalized.length >= 5) break;
  }
  return normalized;
}

export type RecruitmentPreviewProvider = {
	createPreview: (
		draft: RecruitmentDraft,
		session: Session,
		signal?: AbortSignal,
	) => Promise<RecruitmentPreview>;
};
const geminiPreviewProvider: RecruitmentPreviewProvider = {
	async createPreview(draft, session, signal) {
		const response = await requestAPI<RecruitmentClassificationResponse>(
			"/recruitments/classify",
			session,
			{ method: "POST", body: JSON.stringify({ description: draft.activity }), signal },
		);
		const category = response.data?.category;
		if (!isMatchCategory(category)) {
			throw new Error("recruitment classification response is invalid");
		}

		const preview = buildRecruitmentPreview(draft, category);
		const keywords = normalizeRecruitmentKeywords(response.data?.keywords);
		return {
			...preview,
			tags: keywords.length > 0 ? keywords : preview.tags,
		};
	},
};

const previewProvider: RecruitmentPreviewProvider = geminiPreviewProvider;

export function createRecruitmentPreview(
	draft: RecruitmentDraft,
	session: Session,
	signal?: AbortSignal,
): Promise<RecruitmentPreview> {
	return previewProvider.createPreview(draft, session, signal);
}

export const JST_TIME_ZONE = "Asia/Tokyo";

const JST_OFFSET_MINUTES = 9 * 60;
const MINUTES_PER_DAY = 24 * 60;
const RECRUITMENT_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

type JSTDateTimeParts = CalendarDateParts & {
  hour: number;
  minute: number;
};

const MONTH_NAMES: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function invalidDateError(): Error {
  return new Error("invalid_recruitment_date");
}

function formatISODate(parts: CalendarDateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0",
  )}-${String(parts.day).padStart(2, "0")}`;
}

function validateCalendarDate(parts: CalendarDateParts): string {
  if (
    !Number.isInteger(parts.year) ||
    !Number.isInteger(parts.month) ||
    !Number.isInteger(parts.day) ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31
  ) {
    throw invalidDateError();
  }

  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  if (
    candidate.getUTCFullYear() !== parts.year ||
    candidate.getUTCMonth() !== parts.month - 1 ||
    candidate.getUTCDate() !== parts.day
  ) {
    throw invalidDateError();
  }

  return formatISODate(parts);
}

function parseISODate(value: string): CalendarDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  validateCalendarDate(parts);
  return parts;
}

function getJSTDateTimeParts(instant: Date): JSTDateTimeParts {
  if (Number.isNaN(instant.getTime())) throw invalidDateError();

  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function jstCalendarDateTimeToInstant(
  date: CalendarDateParts,
  hour: number,
  minute: number,
): Date {
  validateCalendarDate(date);
  const wallClock = new Date(0);
  wallClock.setUTCHours(0, 0, 0, 0);
  wallClock.setUTCFullYear(date.year, date.month - 1, date.day);
  wallClock.setUTCHours(hour, minute, 0, 0);
  return new Date(wallClock.getTime() - JST_OFFSET_MINUTES * 60 * 1000);
}

export function formatRecruitmentISODate(date: Date): string {
  const parts = getJSTDateTimeParts(date);
  return validateCalendarDate(parts);
}

export function getRecruitmentJSTTimeParts(date: Date): { hour: number; minute: number } {
  try {
    const parts = getJSTDateTimeParts(date);
    return { hour: parts.hour, minute: parts.minute };
  } catch {
    return { hour: 0, minute: 0 };
  }
}

export function makeRecruitmentTimePickerValue(
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

export function formatRecruitmentDateInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: JST_TIME_ZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});

  if (!parts.month || !parts.day || !parts.year) throw invalidDateError();
  return `${parts.month},${parts.day} ${parts.year}`;
}

export type DefaultRecruitmentSchedule = {
  date: string;
  startTime: string;
  durationHours: number;
};

export type RecruitmentScheduleIssue =
  | "recruitment_date_in_past"
  | "recruitment_deadline_passed"
  | "recruitment_must_end_same_day";

function formatTimeInput(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(
    totalMinutes % 60,
  ).padStart(2, "0")}`;
}

export function defaultRecruitmentSchedule(
  reference = new Date(),
): DefaultRecruitmentSchedule {
  const now = getJSTDateTimeParts(
    new Date(reference.getTime() + RECRUITMENT_LEAD_TIME_MS),
  );
  const roundedMinutes =
    Math.floor((now.hour * 60 + now.minute) / 30) * 30 + 30;
  const nextDate = new Date(0);
  nextDate.setUTCHours(0, 0, 0, 0);
  nextDate.setUTCFullYear(now.year, now.month - 1, now.day);

  let startMinutes = roundedMinutes;
  if (startMinutes >= MINUTES_PER_DAY) {
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    startMinutes -= MINUTES_PER_DAY;
  }

  return {
    date: validateCalendarDate({
      year: nextDate.getUTCFullYear(),
      month: nextDate.getUTCMonth() + 1,
      day: nextDate.getUTCDate(),
    }),
    startTime: formatTimeInput(startMinutes),
    durationHours: 1,
  };
}

export function defaultRecruitmentDate(reference = new Date()): string {
  return defaultRecruitmentSchedule(reference).date;
}

export function normalizeRecruitmentDate(value: string): string {
  const trimmed = value.trim();
  const isoParts = parseISODate(trimmed);
  if (isoParts) {
    return formatISODate(isoParts);
  }

  // Keep accepting the legacy display value while migrating callers to ISO.
  // Parse it explicitly so this path never depends on the host Date parser or TZ.
  const legacyMatch = /^([A-Za-z]+)(?:\s*,\s*|\s+)(\d{1,2})(?:\s*,\s+|\s+)(\d{4})$/.exec(
    trimmed,
  );
  if (!legacyMatch) throw invalidDateError();

  const [, monthName, dayValue, yearValue] = legacyMatch;
  if (!monthName || !dayValue || !yearValue) throw invalidDateError();
  const month = MONTH_NAMES[monthName.toLowerCase()];
  if (!month) throw invalidDateError();
  return validateCalendarDate({
    year: Number(yearValue),
    month,
    day: Number(dayValue),
  });
}

export function parseRecruitmentDateInput(value: string): Date {
  const normalized = normalizeRecruitmentDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw invalidDateError();

  return jstCalendarDateTimeToInstant(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    },
    12,
    0,
  );
}

export function shiftRecruitmentDate(value: string, days: number): string {
  if (!Number.isInteger(days)) throw invalidDateError();
  const normalized = normalizeRecruitmentDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw invalidDateError();

  const shifted = new Date(0);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCFullYear(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
  );
  return validateCalendarDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function timeToMinutes(value: string): number {
  const match = /^(\d{2}):([0-5]\d)$/.exec(value);
  if (!match) throw new Error("invalid_recruitment_time");
  const hour = Number(match[1]);
  if (hour > 23) throw new Error("invalid_recruitment_time");
  return hour * 60 + Number(match[2]);
}

export function recruitmentDateTimeToInstant(
  date: string,
  time: string,
): Date {
  const normalized = normalizeRecruitmentDate(date);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw invalidDateError();

  const startMinutes = timeToMinutes(time);
  return jstCalendarDateTimeToInstant(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    },
    Math.floor(startMinutes / 60),
    startMinutes % 60,
  );
}

export function getRecruitmentScheduleIssue(
  draft: RecruitmentDraft,
  now = new Date(),
): RecruitmentScheduleIssue | null {
  const availableDate = normalizeRecruitmentDate(draft.date);
  const startMinutes = timeToMinutes(draft.startTime);
  const durationMinutes = Math.round(draft.durationHours * 60);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("invalid_recruitment_duration");
  }

  if (startMinutes + durationMinutes >= 24 * 60) {
    return "recruitment_must_end_same_day";
  }

  const dateAtStart = recruitmentDateTimeToInstant(
    availableDate,
    draft.startTime,
  );
  if (dateAtStart <= now) {
    return "recruitment_date_in_past";
  }
  if (dateAtStart.getTime() - RECRUITMENT_LEAD_TIME_MS <= now.getTime()) {
    return "recruitment_deadline_passed";
  }

  return null;
}

export function buildRecruitmentCreateRequest(
  draft: RecruitmentDraft,
  preview: RecruitmentPreview,
  now = new Date(),
  timezone = JST_TIME_ZONE,
  coordinates?: Coordinates | null,
  selection?: RecruitmentSelection,
  status: Extract<RecruitmentCreateRequest["status"], "draft" | "open"> = "open",
): RecruitmentCreateRequest {
  void timezone;
  const description = draft.activity.trim();
  if (!description) {
    throw new Error("invalid_recruitment_description");
  }
  const scheduleIssue = getRecruitmentScheduleIssue(draft, now);
  if (
    scheduleIssue === "recruitment_must_end_same_day" ||
    ((scheduleIssue === "recruitment_date_in_past" ||
      scheduleIssue === "recruitment_deadline_passed") &&
      status === "open")
  ) {
    throw new Error(scheduleIssue);
  }

  const availableDate = normalizeRecruitmentDate(draft.date);
  const startMinutes = timeToMinutes(draft.startTime);
  const durationMinutes = Math.round(draft.durationHours * 60);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("invalid_recruitment_duration");
  }
  if (!Number.isInteger(draft.participantLimit) || draft.participantLimit < 1 || draft.participantLimit > 10) {
    throw new Error("invalid_recruitment_participant_limit");
  }
  const endMinutes = startMinutes + durationMinutes;

  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;
  const selectedKeywords = normalizeRecruitmentKeywords(
    selection ? selection.keywords : preview.tags,
  );
  const input: RecruitmentCreateRequest = {
    category: selection?.category ?? preview.category,
    available_date: availableDate,
    start_time: draft.startTime,
    end_time: `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`,
    timezone: JST_TIME_ZONE,
    keywords: selectedKeywords.length > 0 ? selectedKeywords : ["Experience"],
    description,
    location_name: draft.location.trim(),
    participant_limit: draft.participantLimit,
    visibility_radius_km: draft.distanceKm,
    status,
  };

  if (coordinates) {
    input.latitude = coordinates.latitude;
    input.longitude = coordinates.longitude;
    input.location_accuracy_m = coordinates.accuracy_m;
  }
  return input;
}

export async function publishRecruitment(
  draft: RecruitmentDraft,
  preview: RecruitmentPreview,
  session: Session,
  coordinates?: Coordinates | null,
  signal?: AbortSignal,
  selection?: RecruitmentSelection,
  existingRecruitmentID?: string,
) {
  const input = buildRecruitmentCreateRequest(
    draft,
    preview,
    new Date(),
    undefined,
    coordinates,
    selection,
    "open",
  );
  return existingRecruitmentID
    ? updateRecruitment(existingRecruitmentID, session, input, signal)
    : createRecruitment(session, input, signal);
}

export async function saveRecruitmentDraft(
  draft: RecruitmentDraft,
  preview: RecruitmentPreview,
  session: Session,
  coordinates?: Coordinates | null,
  signal?: AbortSignal,
  selection?: RecruitmentSelection,
  existingRecruitmentID?: string,
) {
  const input = buildRecruitmentCreateRequest(
    draft,
    preview,
    new Date(),
    undefined,
    coordinates,
    selection,
    "draft",
  );
  return existingRecruitmentID
    ? updateRecruitment(existingRecruitmentID, session, input, signal)
    : createRecruitment(session, input, signal);
}
