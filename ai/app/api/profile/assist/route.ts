import type { NextRequest } from "next/server";
import { ok, fail, requireSharedSecret, enforceRateLimit, readJson, mapUpstreamError } from "@/lib/http";
import { profileAssistInput } from "@/lib/validation";
import { assistProfileText } from "@/lib/ai";

export const runtime = "nodejs";

// POST /api/profile/assist
// body: { text: string, mode: "polish" | "translate_en" | "translate_ja" }
// -> { data: { suggestion } }
//
// Policy: FAIL-OPEN, optional feature. The suggestion is NEVER persisted here;
// the client shows it and only applies it on explicit user action.
export async function POST(req: NextRequest) {
  const unauthorized = requireSharedSecret(req);
  if (unauthorized) return unauthorized;

  const limited = enforceRateLimit(req, { key: "profile_assist", windowMs: 10_000, max: 3 });
  if (limited) return limited;

  const parsed = await readJson(req, profileAssistInput, 8 * 1024);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await assistProfileText({
      text: parsed.value.text,
      mode: parsed.value.mode,
    });
    return ok({ suggestion: result.suggestion });
  } catch (err) {
    return mapUpstreamError(err, { feature: "profile_assist", policy: "open" });
  }
}

export function GET() {
  return fail("method_not_allowed", "use POST", 405);
}
