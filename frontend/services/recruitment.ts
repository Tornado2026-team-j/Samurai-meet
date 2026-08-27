import { buildMockRecruitmentPreview } from "../mocks/recruitment";
import type { Session } from "./auth-contract";
import {
  createRecruitment,
  type Coordinates,
  type RecruitmentCreateRequest,
} from "./matching";
import type {
  RecruitmentDraft,
  RecruitmentPreview,
} from "../types/recruitment";

export type RecruitmentPreviewProvider = {
  createPreview: (
    draft: RecruitmentDraft,
    signal?: AbortSignal,
  ) => Promise<RecruitmentPreview>;
};

function abortError(): Error {
  const error = new Error("The preview request was cancelled.");
  error.name = "AbortError";
  return error;
}

function wait(duration: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timeout = setTimeout(resolve, duration);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(abortError());
      },
      { once: true },
    );
  });
}

const mockPreviewProvider: RecruitmentPreviewProvider = {
  async createPreview(draft, signal) {
    await wait(420, signal);
    return buildMockRecruitmentPreview(draft);
  },
};

const previewProvider: RecruitmentPreviewProvider = mockPreviewProvider;

export function createRecruitmentPreview(
  draft: RecruitmentDraft,
  signal?: AbortSignal,
): Promise<RecruitmentPreview> {
  return previewProvider.createPreview(draft, signal);
}

export const JST_TIME_ZONE = "Asia/Tokyo";

const JST_OFFSET_MINUTES = 9 * 60;
const MINUTES_PER_DAY = 24 * 60;

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
  | "recruitment_must_end_same_day";

function formatTimeInput(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(
    totalMinutes % 60,
  ).padStart(2, "0")}`;
}

export function defaultRecruitmentSchedule(
  reference = new Date(),
): DefaultRecruitmentSchedule {
  const now = getJSTDateTimeParts(reference);
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

  return null;
}

export function buildRecruitmentCreateRequest(
  draft: RecruitmentDraft,
  preview: RecruitmentPreview,
  now = new Date(),
  timezone = JST_TIME_ZONE,
  coordinates?: Coordinates | null,
): RecruitmentCreateRequest {
  void timezone;
  const scheduleIssue = getRecruitmentScheduleIssue(draft, now);
  if (scheduleIssue) throw new Error(scheduleIssue);

  const availableDate = normalizeRecruitmentDate(draft.date);
  const startMinutes = timeToMinutes(draft.startTime);
  const durationMinutes = Math.round(draft.durationHours * 60);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("invalid_recruitment_duration");
  }
  const endMinutes = startMinutes + durationMinutes;

  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;
  const input: RecruitmentCreateRequest = {
    category: preview.category,
    available_date: availableDate,
    start_time: draft.startTime,
    end_time: `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`,
    timezone: JST_TIME_ZONE,
    keywords: preview.tags.length > 0 ? preview.tags : ["Experience"],
    description: draft.activity.trim() || "Explore Osaka with a local",
    visibility_radius_km: draft.distanceKm,
    status: "open",
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
) {
  return createRecruitment(
    session,
    buildRecruitmentCreateRequest(draft, preview, new Date(), undefined, coordinates),
    signal,
  );
}
