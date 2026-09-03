// Thin persistence helpers over the Supabase service-role client. These are the
// "Next.js part" — no AI. See supabase/migrations/0001_init.sql for the schema.

import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";
import type { ModerationLevel, TargetLanguage, TranslateResult } from "@/lib/types";

// --- translations cache ---------------------------------------------------

export async function getCachedTranslation(
  messageId: string,
  target: TargetLanguage,
): Promise<TranslateResult | null> {
  const { data, error } = await supabaseAdmin()
    .from("translations")
    .select("source_language, translated_text")
    .eq("message_id", messageId)
    .eq("target_language", target)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { sourceLanguage: data.source_language ?? "", translatedText: data.translated_text };
}

export async function saveTranslation(
  messageId: string,
  target: TargetLanguage,
  result: TranslateResult,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("translations")
    .upsert(
      {
        message_id: messageId,
        target_language: target,
        source_language: result.sourceLanguage || null,
        translated_text: result.translatedText,
      },
      { onConflict: "message_id,target_language" },
    );
  if (error) throw error;
}

// --- moderation flag persistence ----------------------------------------------

export async function setModerationLevel(
  target: { type: "request" | "message"; id: string },
  level: ModerationLevel,
): Promise<void> {
  const table = target.type === "request" ? "requests" : "messages";
  const { error } = await supabaseAdmin()
    .from(table)
    .update({ moderation_level: level })
    .eq("id", target.id);
  if (error) throw error;
}

// --- monster images ------------------------------------------------------------

export interface MonsterRow {
  id: string;
  image_url: string;
  seed_hash: string;
  regen_count: number;
}

export async function findMonsterBySeed(
  userId: string,
  seedHash: string,
): Promise<MonsterRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("monster_images")
    .select("id, image_url, seed_hash, regen_count")
    .eq("user_id", userId)
    .eq("seed_hash", seedHash)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function latestMonster(userId: string): Promise<MonsterRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("monster_images")
    .select("id, image_url, seed_hash, regen_count")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function totalMonsterRegens(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("monster_images")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  // rows beyond the first each represent one regeneration
  return Math.max(0, (count ?? 0) - 1);
}

export async function uploadMonsterImage(
  userId: string,
  seedHash: string,
  png: Uint8Array,
): Promise<string> {
  const bucket = env.SUPABASE_MONSTER_BUCKET;
  const path = `${userId}/${seedHash}.png`;
  const client = supabaseAdmin();
  const { error } = await client.storage.from(bucket).upload(path, png, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw error;
  return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function insertMonster(
  userId: string,
  imageUrl: string,
  seedHash: string,
  promptVersion: string,
  regenCount: number,
): Promise<MonsterRow> {
  const { data, error } = await supabaseAdmin()
    .from("monster_images")
    .insert({
      user_id: userId,
      image_url: imageUrl,
      seed_hash: seedHash,
      prompt_version: promptVersion,
      regen_count: regenCount,
    })
    .select("id, image_url, seed_hash, regen_count")
    .single();
  if (error) throw error;
  return data;
}
