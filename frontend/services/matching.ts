import type { Session } from "./auth-contract";
import { APIError, requestAPI } from "./api-client";
import type { AppLanguage } from "./onboarding";
import { isMatchCategory, type MatchCardData, type MatchCategory } from "../types/match";

export type RecruitmentStatus =
  | "draft"
  | "open"
  | "matched"
  | "closed"
  | "expired"
  | "completed";

export type MatchStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "blocked"
  | "expired"
  | "completed";

export type Recruitment = {
  id: string;
  category: MatchCategory;
  author_name: string;
  nationality_code: string;
  rating: number;
  available_date: string;
  start_time: string;
  end_time: string;
  timezone: string;
  duration_hours: number;
  keywords: string[];
  description: string;
  location_name: string;
  participant_limit: number;
  visibility_radius_km: 1 | 3 | 5;
  distance_band?: string;
  status: RecruitmentStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type RecruitmentCreateRequest = {
  category: MatchCategory;
  available_date: string;
  start_time: string;
  end_time: string;
  timezone: string;
  keywords: string[];
  description: string;
  location_name: string;
  participant_limit: number;
  visibility_radius_km: 1 | 3 | 5;
  latitude?: number;
  longitude?: number;
  location_accuracy_m?: number;
  status: Extract<RecruitmentStatus, "draft" | "open" | "closed">;
};

type RecruitmentClassificationResponse = {
  data?: { category?: unknown };
};

export type RecruitmentUpdateRequest = {
  category?: MatchCategory;
  available_date?: string;
  start_time?: string;
  end_time?: string;
  timezone?: string;
  keywords?: string[];
  description?: string;
  location_name?: string;
  participant_limit?: number;
  visibility_radius_km?: 1 | 3 | 5;
  latitude?: number;
  longitude?: number;
  location_accuracy_m?: number;
  clear_location?: boolean;
  status?: Extract<RecruitmentStatus, "draft" | "open" | "closed">;
};

export type RecruitmentSearchParams = {
  keywords?: string[];
  category?: MatchCategory;
  availableDate?: string;
  availableFrom?: string;
  availableTo?: string;
  startTime?: string;
  endTime?: string;
  radiusKm?: 1 | 3 | 5;
  verifiedOnly?: boolean;
  latitude?: number;
  longitude?: number;
  limit?: number;
};

export const MAX_RECRUITMENT_SEARCH_RANGE_DAYS = 31;

export type RecruitmentSearchDateRangeError =
  | "search_date_range_requires_both"
  | "search_date_range_invalid"
  | "search_date_range_reversed"
  | "search_date_range_too_long";

export type RecruitmentInterest = {
  id: string;
  recruitment_id: string;
  status: MatchStatus;
  matched_at?: string;
  created_at: string;
  updated_at: string;
};

export type MatchParticipant = {
  id: string;
  name: string;
  nationality_code: string;
  bio: string;
  identity_status: string;
  likes_count: number;
};

export type MatchView = RecruitmentInterest & {
  other_user: MatchParticipant;
  recruitment: Recruitment;
};

export type MatchListParams = {
  role?: "all" | "owner" | "requester";
  status?: MatchStatus;
  limit?: number;
};

export type Coordinates = {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  captured_at?: string;
};

const MATCH_CARD_STATUS_LABELS: Record<NonNullable<MatchCardData["applicationStatus"]>, Record<AppLanguage, string>> = {
  pending: { ja: "応募中", en: "Pending" },
  accepted: { ja: "承認済み", en: "Accepted" },
  rejected: { ja: "不採用", en: "Not accepted" },
  cancelled: { ja: "取消済み", en: "Cancelled" },
  blocked: { ja: "ブロック済み", en: "Blocked" },
  expired: { ja: "期限切れ", en: "Expired" },
  completed: { ja: "完了", en: "Completed" },
};

export const MATCH_CARD_COPY = {
  ja: {
    date: "日付",
    time: "時間",
    today: "今日",
    expiry: (date: string) => `${date}まで`,
    openDetails: (name: string) => `${name}の募集詳細を開く`,
  },
  en: {
    date: "Date",
    time: "Time",
    today: "Today",
    expiry: (date: string) => `Until ${date}`,
    openDetails: (name: string) => `Open recruitment details for ${name}`,
  },
} as const;

export function getMatchCardCopy(language: AppLanguage) {
  return MATCH_CARD_COPY[language];
}

export function getMatchCardStatusLabel(
  status: MatchCardData["applicationStatus"],
  language: AppLanguage,
): string | null {
  return status ? MATCH_CARD_STATUS_LABELS[status][language] : null;
}

type DataResponse<T> = { data?: T };

function requireArrayData<T>(response: DataResponse<T[]>, resource: string): T[] {
  if (!Array.isArray(response.data)) {
    throw new Error(`${resource} response is invalid`);
  }
  return response.data;
}

function appendQueryPart(parts: string[], key: string, value: string | number | boolean) {
  parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

function parseSearchDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return date.getTime();
}

export function validateRecruitmentSearchDateRange(
  availableFrom?: string,
  availableTo?: string,
): RecruitmentSearchDateRangeError | null {
  const from = availableFrom?.trim() ?? "";
  const to = availableTo?.trim() ?? "";
  if (!from && !to) return null;
  if (!from || !to) return "search_date_range_requires_both";

  const fromTime = parseSearchDate(from);
  const toTime = parseSearchDate(to);
  if (fromTime === null || toTime === null) return "search_date_range_invalid";
  if (toTime < fromTime) return "search_date_range_reversed";
  if (toTime - fromTime > MAX_RECRUITMENT_SEARCH_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return "search_date_range_too_long";
  }
  return null;
}

function recruitmentQuery(params: RecruitmentSearchParams): string {
  const parts: string[] = [];
  for (const keyword of params.keywords ?? []) {
    const normalizedKeyword = keyword.trim();
    if (normalizedKeyword) appendQueryPart(parts, "keyword", normalizedKeyword);
  }
  if (params.category !== undefined) {
    if (!isMatchCategory(params.category)) throw new Error("invalid_recruitment_category");
    appendQueryPart(parts, "category", params.category);
  }
  if (params.availableDate) appendQueryPart(parts, "available_date", params.availableDate);
  if (params.availableFrom) appendQueryPart(parts, "available_from", params.availableFrom);
  if (params.availableTo) appendQueryPart(parts, "available_to", params.availableTo);
  if (params.startTime) appendQueryPart(parts, "start_time", params.startTime);
  if (params.endTime) appendQueryPart(parts, "end_time", params.endTime);
  if (params.radiusKm !== undefined) appendQueryPart(parts, "radius_km", params.radiusKm);
  if (params.verifiedOnly !== undefined) appendQueryPart(parts, "verified_only", params.verifiedOnly);
  if (params.latitude !== undefined) appendQueryPart(parts, "latitude", params.latitude);
  if (params.longitude !== undefined) appendQueryPart(parts, "longitude", params.longitude);
  if (params.limit !== undefined) appendQueryPart(parts, "limit", params.limit);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function matchQuery(params: MatchListParams): string {
  const parts: string[] = [];
  if (params.role) appendQueryPart(parts, "role", params.role);
  if (params.status) appendQueryPart(parts, "status", params.status);
  if (params.limit !== undefined) appendQueryPart(parts, "limit", params.limit);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

export async function searchRecruitments(
  session: Session,
  params: RecruitmentSearchParams = {},
  signal?: AbortSignal,
): Promise<Recruitment[]> {
  const dateRangeError = validateRecruitmentSearchDateRange(params.availableFrom, params.availableTo);
  if (dateRangeError) throw new Error(dateRangeError);

  const response = await requestAPI<DataResponse<Recruitment[]>>(
    `/recruitments${recruitmentQuery(params)}`,
    session,
    { method: "GET", signal },
  );
  return requireArrayData(response, "recruitments");
}

export async function createRecruitment(
  session: Session,
  input: RecruitmentCreateRequest,
  signal?: AbortSignal,
): Promise<Recruitment> {
  const response = await requestAPI<DataResponse<Recruitment>>(
    "/recruitments",
    session,
    { method: "POST", body: JSON.stringify(input), signal },
  );
  if (!response.data) throw new Error("recruitment response is empty");
  return response.data;
}

export async function getRecruitment(
  recruitmentId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<Recruitment> {
  const response = await requestAPI<DataResponse<Recruitment>>(
    `/recruitments/${encodeURIComponent(recruitmentId)}`,
    session,
    { method: "GET", signal },
  );
  if (!response.data) throw new Error("recruitment response is empty");
  return response.data;
}

export async function classifyRecruitmentDescription(
  description: string,
  session: Session,
  signal?: AbortSignal,
): Promise<MatchCategory> {
  const response = await requestAPI<RecruitmentClassificationResponse>(
    "/recruitments/classify",
    session,
    { method: "POST", body: JSON.stringify({ description }), signal },
  );
  const category = response.data?.category;
  if (isMatchCategory(category)) {
    return category;
  }
  throw new Error("recruitment classification response is invalid");
}

export async function listMyRecruitments(
  session: Session,
  signal?: AbortSignal,
): Promise<Recruitment[]> {
  const response = await requestAPI<DataResponse<Recruitment[]>>(
    "/recruitments/mine",
    session,
    { method: "GET", signal },
  );
  return requireArrayData(response, "my recruitments");
}

export async function updateRecruitment(
  recruitmentId: string,
  session: Session,
  patch: RecruitmentUpdateRequest,
  signal?: AbortSignal,
): Promise<Recruitment> {
  const response = await requestAPI<DataResponse<Recruitment>>(
    `/recruitments/${encodeURIComponent(recruitmentId)}`,
    session,
    { method: "PATCH", body: JSON.stringify(patch), signal },
  );
  if (!response.data) throw new Error("recruitment response is empty");
  return response.data;
}

export async function closeRecruitment(
  recruitmentId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<void> {
  await requestAPI<null>(
    `/recruitments/${encodeURIComponent(recruitmentId)}`,
    session,
    { method: "DELETE", signal },
  );
}

export async function sendRecruitmentInterest(
  recruitmentId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<RecruitmentInterest | null> {
  try {
    const response = await requestAPI<DataResponse<RecruitmentInterest>>(
      `/recruitments/${encodeURIComponent(recruitmentId)}/interest`,
      session,
      { method: "POST", signal },
    );
    return response.data ?? null;
  } catch (error) {
    if (error instanceof APIError && error.status === 409 && error.code === "interest_already_sent") {
      const existing = error.data;
      if (isRecruitmentInterest(existing)) return existing;
    }
    throw error;
  }
}

function isRecruitmentInterest(value: unknown): value is RecruitmentInterest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && candidate.id.length > 0
    && typeof candidate.recruitment_id === "string"
    && candidate.recruitment_id.length > 0
    && typeof candidate.status === "string"
    && ["pending", "accepted", "rejected", "cancelled", "blocked", "expired", "completed"].includes(candidate.status)
    && typeof candidate.created_at === "string"
    && typeof candidate.updated_at === "string";
}

export async function listMatches(
  session: Session,
  params: MatchListParams = {},
  signal?: AbortSignal,
): Promise<MatchView[]> {
  const response = await requestAPI<DataResponse<MatchView[]>>(
    `/matches${matchQuery(params)}`,
    session,
    { method: "GET", signal },
  );
  return requireArrayData(response, "matches");
}

export async function getMatch(
  matchId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<MatchView> {
  const response = await requestAPI<DataResponse<MatchView>>(
    `/matches/${encodeURIComponent(matchId)}`,
    session,
    { method: "GET", signal },
  );
  if (!response.data) throw new Error("match response is empty");
  return response.data;
}

async function updateMatch(
  matchId: string,
  action: "accept" | "reject" | "complete",
  session: Session,
  signal?: AbortSignal,
): Promise<RecruitmentInterest> {
  const response = await requestAPI<DataResponse<RecruitmentInterest>>(
    `/matches/${encodeURIComponent(matchId)}/${action}`,
    session,
    { method: "POST", signal },
  );
  if (!response.data) throw new Error("match response is empty");
  return response.data;
}

export function acceptMatch(
  matchId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<RecruitmentInterest> {
  return updateMatch(matchId, "accept", session, signal);
}

export function rejectMatch(
  matchId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<RecruitmentInterest> {
  return updateMatch(matchId, "reject", session, signal);
}

export async function declineMatch(
  matchId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<RecruitmentInterest> {
  try {
    return await withdrawRecruitmentInterest(matchId, session, signal);
  } catch (error) {
    if (error instanceof APIError && (error.status === 403 || error.code === "invalid_matching_state")) {
      return rejectMatch(matchId, session, signal);
    }
    throw error;
  }
}

export async function withdrawRecruitmentInterest(
  matchId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<RecruitmentInterest> {
  const response = await requestAPI<DataResponse<RecruitmentInterest>>(
    `/matches/${encodeURIComponent(matchId)}/withdraw`,
    session,
    { method: "POST", signal },
  );
  if (!response.data) throw new Error("match response is empty");
  return response.data;
}

export function completeMatch(
  matchId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<RecruitmentInterest> {
  return updateMatch(matchId, "complete", session, signal);
}

export async function updateCurrentLocation(
  coordinates: Coordinates,
  session: Session,
  signal?: AbortSignal,
): Promise<void> {
  await requestAPI<null>("/me/location", session, {
    method: "POST",
    body: JSON.stringify(coordinates),
    signal,
  });
}

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia",
  BR: "Brazil",
  CA: "Canada",
  CN: "China",
  DE: "Germany",
  ES: "Spain",
  FR: "France",
  GB: "United Kingdom",
  HK: "Hong Kong",
  ID: "Indonesia",
  IN: "India",
  IT: "Italy",
  JP: "Japan",
  KR: "South Korea",
  MX: "Mexico",
  MY: "Malaysia",
  PH: "Philippines",
  SG: "Singapore",
  TH: "Thailand",
  TW: "Taiwan",
  US: "United States",
  VN: "Vietnam",
};

function countryCodeToFlag(countryCode: string): string {
  const normalizedCode = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalizedCode)) return "";
  return String.fromCodePoint(
    ...[...normalizedCode].map((character) => character.charCodeAt(0) + 127397),
  );
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ? parsed
    : null;
}

function formatRecruitmentDate(value: string): { card: string; detail: string } {
  const parsed = parseDateOnly(value);
  if (!parsed) return { card: value, detail: value };
  const shortMonth = parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const weekday = parsed.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const year = parsed.getUTCFullYear();
  return {
    card: `${year}/${month}/${day}`,
    detail: `${shortMonth} ${day}, ${year} (${weekday})`,
  };
}

const JST_TIME_ZONE = "Asia/Tokyo";

function formatExpiry(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: JST_TIME_ZONE,
    year: "numeric",
  })
    .formatToParts(parsed)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});

  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function uniqueTags(recruitment: Recruitment): string[] {
  const tags = [
    ...recruitment.keywords.map((keyword) => keyword.trim()).filter(Boolean),
  ];
  if (tags.length === 0) tags.push(recruitment.category);
  return [...new Set(tags)].slice(0, 3);
}

export function recruitmentToMatchCard(recruitment: Recruitment): MatchCardData {
  if (!isMatchCategory(recruitment.category)) {
    throw new Error("recruitment response is invalid");
  }
  const dates = formatRecruitmentDate(recruitment.available_date);
  const tags = uniqueTags(recruitment);
  const detailTags = [...new Set([...tags, recruitment.category])].slice(0, 5);
  const countryCode = recruitment.nationality_code.trim().toUpperCase();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  return {
    id: recruitment.id,
    category: recruitment.category,
    authorName: recruitment.author_name || "Samurai Meet user",
    countryFlag: countryCodeToFlag(countryCode),
    countryName: COUNTRY_NAMES[countryCode] ?? countryCode,
    rating: recruitment.rating,
    date: dates.card,
    detailDate: dates.detail,
    startTime: recruitment.start_time,
    durationHours: recruitment.duration_hours,
    locationName: recruitment.location_name || undefined,
    participantLimit: recruitment.participant_limit,
    tags,
    detailTags,
    expiresAt: formatExpiry(recruitment.expires_at),
    description: recruitment.description,
    isToday: recruitment.available_date === today,
  };
}
