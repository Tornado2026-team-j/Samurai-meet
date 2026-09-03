import type { NextRequest } from "next/server";
import { ok, fail, requireSharedSecret, enforceRateLimit, readJson } from "@/lib/http";
import { moderationInput } from "@/lib/validation";
import { moderateText } from "@/lib/ai";
import { setModerationLevel } from "@/lib/db";
import { supabaseConfigured } from "@/lib/supabase";
import { NotImplemented, UpstreamError, InvalidUpstreamResponse } from "@/lib/errors";
import type { ModerationResult } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/moderation
// body: { text, context: "recruitment"|"profile"|"chat", target?: {type,id} }
// -> { data: { level, categories, degraded? } }
//
// Policy depends on context:
//   - chat                  -> FAIL-CLOSED (this call gates message send)
//   - recruitment | profile -> FAIL-OPEN  (AI must not block a post by itself;
//                              on failure return level "none" + degraded)
//   - level "high" from a working call is the caller's cue to ask for an edit;
//     "low" is recorded but the post proceeds.
export async function POST(req: NextRequest) {
  const unauthorized = requireSharedSecret(req);
  if (unauthorized) return unauthorized;

  const limited = enforceRateLimit(req, { key: "moderation", windowMs: 10_000, max: 10 });
  if (limited) return limited;

  const parsed = await readJson(req, moderationInput, 24 * 1024);
  if (!parsed.ok) return parsed.response;
  const { text, context, target } = parsed.value;

  let result: ModerationResult;
  try {
    result = await moderateText({ text });
  } catch (err) {
    if (err instanceof NotImplemented) {
      return fail("not_implemented", err.message, 501);
    }
    const failClosed = context === "chat" || err instanceof InvalidUpstreamResponse;
    if (failClosed) {
      const message = err instanceof UpstreamError ? err.message : "moderation failed";
      return fail("moderation_failed", message, 502);
    }
    // fail-open for recruitment / profile
    console.error(`[ai] moderation degraded for context=${context}:`, err);
    return ok({ level: "none", categories: [], degraded: true });
  }

  // best-effort persistence of the flag level onto the target row
  if (target && supabaseConfigured()) {
    try {
      await setModerationLevel(target, result.level);
    } catch (err) {
      console.error("[ai] failed to persist moderation level:", err);
    }
  }

  return ok({ level: result.level, categories: result.categories });
}

export function GET() {
  return fail("method_not_allowed", "use POST", 405);
}
