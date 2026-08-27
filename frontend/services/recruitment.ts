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

function formatDateInput(date: Date): string {
  const value = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return value.replace(/^([^ ]+) (\d+), (\d{4})$/, "$1,$2 $3");
}

export function defaultRecruitmentDate(reference = new Date()): string {
  const tomorrow = new Date(reference);
  tomorrow.setHours(12, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDateInput(tomorrow);
}

function invalidDateError(): Error {
  return new Error("invalid_recruitment_date");
}

export function normalizeRecruitmentDate(value: string): string {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return trimmed;
    }
    throw invalidDateError();
  }

  const parsed = new Date(trimmed.replace(",", " "));
  if (Number.isNaN(parsed.getTime())) throw invalidDateError();
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number {
  const match = /^(\d{2}):([0-5]\d)$/.exec(value);
  if (!match) throw new Error("invalid_recruitment_time");
  const hour = Number(match[1]);
  if (hour > 23) throw new Error("invalid_recruitment_time");
  return hour * 60 + Number(match[2]);
}

export function buildRecruitmentCreateRequest(
  draft: RecruitmentDraft,
  preview: RecruitmentPreview,
  now = new Date(),
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
  coordinates?: Coordinates | null,
): RecruitmentCreateRequest {
  const availableDate = normalizeRecruitmentDate(draft.date);
  const startMinutes = timeToMinutes(draft.startTime);
  const durationMinutes = Math.round(draft.durationHours * 60);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("invalid_recruitment_duration");
  }
  const endMinutes = startMinutes + durationMinutes;
  if (endMinutes >= 24 * 60) {
    throw new Error("recruitment_must_end_same_day");
  }

  const dateAtStart = new Date(`${availableDate}T${draft.startTime}:00`);
  if (Number.isNaN(dateAtStart.getTime()) || dateAtStart <= now) {
    throw new Error("recruitment_date_in_past");
  }

  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;
  const input: RecruitmentCreateRequest = {
    category: preview.category,
    available_date: availableDate,
    start_time: draft.startTime,
    end_time: `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`,
    timezone,
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
