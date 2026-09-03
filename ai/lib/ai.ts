// ===========================================================================
// AI OWNER: implement everything in this file.
// ===========================================================================
//
// Every function below is called by a route handler that has already done:
//   - shared-secret check
//   - IP rate limiting
//   - zod validation of the request
//   - (where relevant) Supabase cache lookups / writes
//
// Your job is only the OpenAI call and the response mapping. Contract rules:
//
//   1. Server-only. `env.OPENAI_API_KEY` never leaves this process. Do not log
//      the prompt, the raw completion, scores, or category probabilities.
//   2. Text calls: use `response_format` json_schema with `strict: true` and
//      `temperature: 0`. Validate the parsed result before returning it.
//   3. On a broken contract (bad JSON, out-of-enum value) throw
//      `InvalidUpstreamResponse` — routes always fail-closed on that.
//   4. On a network / 5xx / timeout failure throw `UpstreamError`. The route
//      decides whether that is fail-closed (classify, chat moderation) or
//      fail-open (translate, profile assist, recruitment/profile moderation).
//   5. Prompts live in lib/prompts.ts, ported from the Go backend. Keep them
//      versioned there.
//
// Suggested client (add once, reuse):
//   import OpenAI from "openai";
//   const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
//
// ===========================================================================

import { env } from "@/lib/env";
import { NotImplemented } from "@/lib/errors";
import {
  MONSTER_PROMPT_TEMPLATE_V1,
} from "@/lib/prompts";
import type {
  ClassifyResult,
  GeneratedImage,
  ModerationResult,
  MonsterSeed,
  ProfileAssistMode,
  ProfileAssistResult,
  TargetLanguage,
  TranslateResult,
} from "@/lib/types";

void env; // referenced here so the import stays while stubs are unimplemented

/**
 * Keyword extraction + category classification in ONE call.
 * Prompt: CLASSIFY_SYSTEM_PROMPT_V1. Normalise keywords: trim, drop empties,
 * dedupe case-insensitively, <= 40 chars each, max 5, strip control chars.
 * Fail-closed everywhere.
 */
export async function classifyRecruitment(_input: {
  activity: string;
  where?: string;
}): Promise<ClassifyResult> {
  throw new NotImplemented("classifyRecruitment");
}

/**
 * Detect the source language and translate into `targetLanguage`.
 * Prompt: TRANSLATE_SYSTEM_PROMPT_V1. Return the tag + text only.
 * The route caches the result in Supabase; you do not touch the DB.
 */
export async function translateText(_input: {
  text: string;
  targetLanguage: TargetLanguage;
}): Promise<TranslateResult> {
  throw new NotImplemented("translateText");
}

/**
 * Refine or translate a profile self-introduction. Return the candidate only;
 * the route never persists it. Keep the author's voice (see prompts).
 */
export async function assistProfileText(_input: {
  text: string;
  mode: ProfileAssistMode;
}): Promise<ProfileAssistResult> {
  throw new NotImplemented("assistProfileText");
}

/**
 * OpenAI Moderation (env.OPENAI_MODERATION_MODEL). Map the response to a level:
 *   - not flagged                    -> "none"
 *   - flagged, non-severe categories -> "low"
 *   - flagged, severe categories     -> "high"
 * Return the matched category keys (no scores). The route applies the policy.
 */
export async function moderateText(_input: { text: string }): Promise<ModerationResult> {
  throw new NotImplemented("moderateText");
}

/**
 * Generate the monster image. `prompt` is fully assembled and already
 * moderated by the route (see buildMonsterPrompt). Call the image model
 * (env.OPENAI_IMAGE_MODEL, 1024x1024) and return raw PNG bytes. The route
 * uploads to Supabase Storage and persists only the URL.
 */
export async function generateMonsterImage(_input: { prompt: string }): Promise<GeneratedImage> {
  throw new NotImplemented("generateMonsterImage");
}

// --- helpers the route uses (safe to keep here; no AI call) ----------------

/** Bounded, injection-resistant style hint from user free text. */
export function sanitiseNote(note: string | undefined): string {
  if (!note) return "none";
  return note
    .replace(/[\r\n]+/g, " ")
    .replace(/["`]/g, "")
    .slice(0, 200)
    .trim() || "none";
}

/** Assemble the monster prompt from a seed. Deterministic; no AI call. */
export function buildMonsterPrompt(seed: MonsterSeed): string {
  const traits = [...seed.skills, ...seed.interests]
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join(", ") || "curious, friendly, easygoing";
  return MONSTER_PROMPT_TEMPLATE_V1.replace("{{TRAITS}}", traits).replace(
    "{{NOTE}}",
    sanitiseNote(seed.note),
  );
}
