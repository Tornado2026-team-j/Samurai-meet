import type { MatchCategory } from "./match";

export type RecruitmentDistanceKm = 1 | 3 | 5;

export type RecruitmentDraft = {
  activity: string;
  location: string;
  useCurrentLocation: boolean;
  date: string;
  startTime: string;
  durationHours: number;
  participantLimit: number;
  distanceKm: RecruitmentDistanceKm;
};

export type RecruitmentAuthor = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  countryCode: string;
};

export type RecruitmentPreview = {
  previewId: string;
  category: MatchCategory;
  tags: string[];
  expiresAt: string;
  author: RecruitmentAuthor;
  conditions: RecruitmentDraft;
};
