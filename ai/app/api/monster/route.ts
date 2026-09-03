import type { NextRequest } from "next/server";
import { ok, fail, requireSharedSecret, enforceRateLimit, readJson, mapUpstreamError } from "@/lib/http";
import { monsterInput } from "@/lib/validation";
import { buildMonsterPrompt, generateMonsterImage, moderateText } from "@/lib/ai";
import { monsterSeedHash } from "@/lib/hash";
import { PROMPT_VERSION } from "@/lib/prompts";
import { env } from "@/lib/env";
import { supabaseConfigured } from "@/lib/supabase";
import {
  findMonsterBySeed,
  insertMonster,
  latestMonster,
  totalMonsterRegens,
  uploadMonsterImage,
} from "@/lib/db";
import { NotImplemented } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/monster
// body: { user_id, seed: { skills[], interests[], note? }, regenerate? }
// -> { data: { image_url, regen_count, reused } }
//
// Flow (the AI call is only step 4):
//   1. hash the seed
//   2. if a row for this exact seed exists and !regenerate -> return it
//   3. enforce MONSTER_REGEN_LIMIT
//   4. build prompt -> moderate prompt -> generate image
//   5. upload to Storage, insert row, return URL
export async function POST(req: NextRequest) {
  const unauthorized = requireSharedSecret(req);
  if (unauthorized) return unauthorized;

  const limited = enforceRateLimit(req, { key: "monster", windowMs: 60_000, max: 3 });
  if (limited) return limited;

  const parsed = await readJson(req, monsterInput, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const { user_id, seed, regenerate } = parsed.value;

  if (!supabaseConfigured()) {
    return fail("misconfigured", "Supabase is required for monster generation", 503);
  }

  const seedHash = monsterSeedHash(seed);

  // 2. reuse an identical seed
  if (!regenerate) {
    try {
      const existing = await findMonsterBySeed(user_id, seedHash);
      if (existing) {
        return ok({ image_url: existing.image_url, regen_count: existing.regen_count, reused: true });
      }
    } catch (err) {
      console.error("[ai] monster lookup failed:", err);
    }
  }

  // 3. regeneration limit — first image is free, each later one counts
  let priorRegens = 0;
  try {
    const hasAny = await latestMonster(user_id);
    if (hasAny) {
      priorRegens = await totalMonsterRegens(user_id);
      if (priorRegens >= env.MONSTER_REGEN_LIMIT) {
        return fail(
          "regen_limit_reached",
          `monster regeneration limit (${env.MONSTER_REGEN_LIMIT}) reached`,
          429,
        );
      }
    }
  } catch (err) {
    console.error("[ai] monster limit check failed:", err);
  }

  // 4. prompt -> moderation -> image
  const prompt = buildMonsterPrompt(seed);
  try {
    const check = await moderateText({ text: prompt });
    if (check.level === "high") {
      return fail("prompt_rejected", "the generated prompt was flagged; adjust your profile tags", 422);
    }
  } catch (err) {
    if (err instanceof NotImplemented) {
      return fail("not_implemented", err.message, 501);
    }
    // moderation is a gate here — fail closed
    return mapUpstreamError(err, { feature: "monster", policy: "closed" });
  }

  let image;
  try {
    image = await generateMonsterImage({ prompt });
  } catch (err) {
    return mapUpstreamError(err, { feature: "monster", policy: "closed" });
  }

  // 5. persist
  try {
    const nextRegenCount = priorRegens + (regenerate ? 1 : 0);
    const url = await uploadMonsterImage(user_id, seedHash, image.png);
    const row = await insertMonster(user_id, url, seedHash, PROMPT_VERSION, nextRegenCount);
    return ok({ image_url: row.image_url, regen_count: row.regen_count, reused: false });
  } catch (err) {
    console.error("[ai] monster persist failed:", err);
    return fail("monster_persist_failed", "generated the image but could not save it", 500);
  }
}

export function GET() {
  return fail("method_not_allowed", "use POST", 405);
}
