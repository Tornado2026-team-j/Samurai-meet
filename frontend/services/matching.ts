import type { Session } from "./auth-contract";
import { requestAPI, APIError } from "./api-client";

export type MatchCategory = "Food" | "Places" | "Activity" | "Other";

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
  visibility_radius_km: 1 | 3 | 5;
  distance_band?: string;
  status: string;
  expires_at: string;
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

export type MatchView = {
  id: string;
  recruitment_id: string;
  status: MatchStatus;
  matched_at?: string;
  other_user: MatchParticipant;
  recruitment: Recruitment;
  created_at: string;
  updated_at: string;
};

type DataResponse<T> = { data?: T };

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

export async function completeMatch(
  matchId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<{ id: string; status: MatchStatus; updated_at: string }> {
  const response = await requestAPI<DataResponse<{ id: string; status: MatchStatus; updated_at: string }>>(
    `/matches/${encodeURIComponent(matchId)}/complete`,
    session,
    { method: "POST", signal },
  );
  if (!response.data) throw new Error("match complete response is empty");
  return response.data;
}

export { APIError };
