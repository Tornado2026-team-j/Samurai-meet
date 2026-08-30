import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";

export type RemoteProfile = {
  user_id: string;
  name: string;
  nationality_code: string;
  bio: string;
  icon_photo_id: string;
  identity_status: string;
  likes_count: number;
  completed: boolean;
  updated_at?: string;
};

type ProfileResponse = { data?: RemoteProfile };

export async function getMyProfile(
  session: Session,
  signal?: AbortSignal,
): Promise<RemoteProfile> {
  const response = await requestAPI<ProfileResponse>("/me", session, { method: "GET", signal });
  if (!response.data) throw new Error("profile response is empty");
  return response.data;
}
