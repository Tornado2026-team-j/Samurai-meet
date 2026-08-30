export const MATCH_CATEGORIES = [
  "Food",
  "Places",
  "Activity",
  "Other",
] as const;

export type MatchCategory = (typeof MATCH_CATEGORIES)[number];

export function isMatchCategory(value: unknown): value is MatchCategory {
  return typeof value === "string" && MATCH_CATEGORIES.includes(value as MatchCategory);
}

export type MatchCardData = {
  id: string;
  category: MatchCategory;
  authorName: string;
  countryFlag: string;
  countryName: string;
  rating: number;
  date: string;
  detailDate: string;
  startTime: string;
  durationHours: number;
  participantLimit?: number;
  locationName?: string;
  distanceKm?: 1 | 3 | 5;
  tags: string[];
  detailTags: string[];
  expiresAt: string;
  description: string;
  applicationStatus?: "pending" | "accepted" | "rejected" | "cancelled" | "blocked" | "expired" | "completed";
  isToday?: boolean;
};
