import { API_BASE_URL } from "./api-config";
import type { Session } from "./auth-contract";

export type RecruitmentInterest = {
  id?: string;
  recruitment_id?: string;
  status?: "pending" | "accepted" | "rejected" | "blocked" | "expired";
};

type InterestResponse = {
  data?: RecruitmentInterest;
};

function buildRequestError(status: number, body: unknown): Error {
  const error =
    body && typeof body === "object" && "error" in body
      ? String(body.error)
      : "request failed";

  return new Error(`${status}: ${error}`);
}

export async function sendRecruitmentInterest(
  recruitmentId: string,
  session: Pick<Session, "access_token">,
  signal?: AbortSignal,
): Promise<RecruitmentInterest | null> {
  const response = await fetch(
    `${API_BASE_URL}/recruitments/${encodeURIComponent(recruitmentId)}/interest`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      signal,
    },
  );
  const text = await response.text();
  let body: InterestResponse | { error?: string } | null = null;

  try {
    body = text ? (JSON.parse(text) as InterestResponse | { error?: string }) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw buildRequestError(response.status, body);
  }

  return body && "data" in body ? body.data ?? null : null;
}
