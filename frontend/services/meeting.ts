import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";

export type MeetingProximityCapability = {
  enabled: boolean;
  reason: "expo_go" | "feature_disabled" | "native_adapter_unavailable";
};

// This is deliberately a capability boundary, not an Expo Go fallback. A
// Development/production build must register an audited native adapter before
// this feature can ever collect a local measurement. It must submit only a
// coarse band through the meeting API; coordinates, BLE IDs and RSSI never
// cross this boundary.
export function meetingProximityCapability(): MeetingProximityCapability {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Constants = require("expo-constants").default as { appOwnership?: string };
  if (Constants.appOwnership === "expo") return { enabled: false, reason: "expo_go" };
  if (process.env.EXPO_PUBLIC_MEETING_PROXIMITY_ENABLED !== "true") {
    return { enabled: false, reason: "feature_disabled" };
  }
  return { enabled: false, reason: "native_adapter_unavailable" };
}

export type MeetingStatus = "planned" | "active" | "completed" | "cancelled";

export type Meeting = {
  id: string;
  match_id: string;
  status: MeetingStatus;
  scheduled_at?: string;
  started_at?: string;
  ended_at?: string;
  expires_at?: string;
  owner_started_at?: string;
  requester_started_at?: string;
  created_at: string;
  updated_at: string;
};

type DataResponse<T> = { data?: T };

function requireMeeting(response: DataResponse<Meeting>): Meeting {
  if (!response.data) throw new Error("meeting response is empty");
  return response.data;
}

export async function createMeeting(
  matchId: string,
  scheduledAt: string,
  session: Session,
  signal?: AbortSignal,
): Promise<Meeting> {
  const response = await requestAPI<DataResponse<Meeting>>(
    `/matches/${encodeURIComponent(matchId)}/meeting`,
    session,
    { method: "POST", body: JSON.stringify({ scheduled_at: scheduledAt }), signal },
  );
  return requireMeeting(response);
}

export async function getMeeting(
  meetingId: string,
  session: Session,
  signal?: AbortSignal,
): Promise<Meeting> {
  return requireMeeting(await requestAPI<DataResponse<Meeting>>(
    `/meetings/${encodeURIComponent(meetingId)}`,
    session,
    { method: "GET", signal },
  ));
}

async function transitionMeeting(
  meetingId: string,
  action: "start" | "end" | "cancel",
  session: Session,
  signal?: AbortSignal,
): Promise<Meeting> {
  return requireMeeting(await requestAPI<DataResponse<Meeting>>(
    `/meetings/${encodeURIComponent(meetingId)}/${action}`,
    session,
    { method: "POST", signal },
  ));
}

export function startMeeting(meetingId: string, session: Session, signal?: AbortSignal) {
  return transitionMeeting(meetingId, "start", session, signal);
}

export function endMeeting(meetingId: string, session: Session, signal?: AbortSignal) {
  return transitionMeeting(meetingId, "end", session, signal);
}

export function cancelMeeting(meetingId: string, session: Session, signal?: AbortSignal) {
  return transitionMeeting(meetingId, "cancel", session, signal);
}
