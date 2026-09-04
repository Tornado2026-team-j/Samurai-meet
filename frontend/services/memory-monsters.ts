import type { Session } from "./auth-contract";
import { fetchWithAutoRefresh } from "./authenticated-fetch";
import { requestAPI } from "./api-client";
import { toBase64 } from "./crypto";

const MEMORY_MONSTER_TIMEOUT_MS = 70_000;

export type MemoryMonster = {
  id: string;
  match_id: string;
  meeting_id?: string;
  source_photo_id: string;
  memorable_object: string;
  memory_text: string;
  prompt_version: string;
  provider: string;
  generated_content_type: "image/png" | "image/jpeg" | "image/webp";
  created_at: string;
};

type DataResponse<T> = { data?: T };

function requireMonster(response: DataResponse<MemoryMonster>): MemoryMonster {
  if (!response.data?.id) throw new Error("memory monster response is invalid");
  return response.data;
}

export async function listMemoryMonsters(
  session: Session,
  signal?: AbortSignal,
): Promise<MemoryMonster[]> {
  const response = await requestAPI<DataResponse<MemoryMonster[]>>(
    "/memory-monsters",
    session,
    { method: "GET", signal },
  );
  return Array.isArray(response.data) ? response.data : [];
}

export async function createMemoryMonster(
  session: Session,
  input: {
    matchId: string;
    meetingId?: string;
    sourcePhotoId: string;
    photoUri: string;
    photoContentType: "image/jpeg" | "image/png" | "image/webp";
    memorableObject: string;
    memoryText: string;
  },
): Promise<MemoryMonster> {
  const form = new FormData();
  form.append("meeting_id", input.meetingId ?? "");
  form.append("source_photo_id", input.sourcePhotoId);
  form.append("memorable_object", input.memorableObject);
  form.append("memory_text", input.memoryText);
  form.append("photo", {
    uri: input.photoUri,
    name: "memory-photo.jpg",
    type: input.photoContentType,
  } as unknown as Blob);
  const response = await fetchWithAutoRefresh(
    `/matches/${encodeURIComponent(input.matchId)}/memory-monsters`,
    session,
    { method: "POST", body: form as unknown as BodyInit },
    MEMORY_MONSTER_TIMEOUT_MS,
  );
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = body && typeof body === "object" && "error" in body
      ? (body as { error?: unknown }).error
      : "memory_monster_generation_failed";
    throw new Error(`${response.status}: ${typeof code === "string" ? code : "memory_monster_generation_failed"}`);
  }
  return requireMonster(body as DataResponse<MemoryMonster>);
}

export async function downloadMemoryMonsterImageDataURI(
  session: Session,
  monster: Pick<MemoryMonster, "id" | "generated_content_type">,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetchWithAutoRefresh(
    `/memory-monsters/${encodeURIComponent(monster.id)}/image`,
    session,
    { method: "GET", signal },
  );
  if (!response.ok) throw new Error(`${response.status}: memory_monster_image_failed`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytesToDataURI(bytes, monster.generated_content_type);
}

function bytesToDataURI(bytes: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${toBase64(bytes)}`;
}
