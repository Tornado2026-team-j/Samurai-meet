import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";

export {
  meetingProximityCapability,
  type MeetingProximityCapability,
  type MeetingProximityUnavailableReason,
} from "./meeting-proximity";

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
