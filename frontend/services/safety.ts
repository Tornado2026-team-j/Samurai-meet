import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";
import type { ChatReportReason, SafetyReport, SafetyReportTargetType } from "./chat";

export type BlockedUser = {
  user_id: string;
  name: string;
  created_at: string;
};

type DataResponse<T> = { data?: T };

export async function listBlockedUsers(session: Session, signal?: AbortSignal): Promise<BlockedUser[]> {
  const response = await requestAPI<DataResponse<BlockedUser[]>>("/blocks", session, { method: "GET", signal });
  if (!Array.isArray(response.data)) throw new Error("blocked users response is invalid");
  return response.data;
}

export async function unblockUser(userId: string, session: Session, signal?: AbortSignal): Promise<void> {
  await requestAPI<null>(`/blocks/${encodeURIComponent(userId)}`, session, { method: "DELETE", signal });
}

export async function reportSafetyIssue(
  session: Session,
  input: { target_type: SafetyReportTargetType; target_id: string; reason: ChatReportReason; comment?: string },
  signal?: AbortSignal,
): Promise<SafetyReport> {
  const response = await requestAPI<DataResponse<SafetyReport>>("/reports", session, {
    method: "POST",
    body: JSON.stringify({ ...input, comment: input.comment ?? "" }),
    signal,
  });
  if (!response.data) throw new Error("report response is empty");
  return response.data;
}
