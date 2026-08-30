export type MatchCategory = "Food" | "Places" | "Activity" | "Other";

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
  tags: string[];
  detailTags: string[];
  expiresAt: string;
  description: string;
};
