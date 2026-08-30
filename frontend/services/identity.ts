import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";

type IdentitySessionResponse = { data?: { url?: string } };

export async function createIdentityVerificationSession(session: Session, signal?: AbortSignal): Promise<string> {
  const response = await requestAPI<IdentitySessionResponse>("/identity/session", session, { method: "POST", signal });
  const url = response.data?.url;
  if (!url || !/^https:\/\//u.test(url)) throw new Error("identity verification URL is invalid");
  return url;
}
