import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";
import { loadLocalProfile } from "./onboarding";
import {
  localProfileFromRemoteProfile,
  type LocalProfile,
} from "./onboarding-contract";

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

export type ProfilePatch = {
  name?: string;
  nationality_code?: string;
  bio?: string;
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

export async function loadProfileSnapshot(
  session: Session,
  signal?: AbortSignal,
): Promise<LocalProfile | null> {
  const [storedProfile, remoteProfile] = await Promise.all([
    loadLocalProfile(session.user_id).catch(() => null),
    getMyProfile(session, signal).catch(() => null),
  ]);

  if (!remoteProfile) return storedProfile;

  return localProfileFromRemoteProfile(
    remoteProfile,
    storedProfile?.identityVerificationChoice ?? null,
  );
}

export async function updateMyProfile(
  session: Session,
  patch: ProfilePatch,
  signal?: AbortSignal,
): Promise<RemoteProfile> {
  const response = await requestAPI<ProfileResponse>("/me/profile", session, {
    method: "PATCH",
    body: JSON.stringify(patch),
    signal,
  });
  if (!response.data) throw new Error("profile response is empty");
  return response.data;
}
