import type { NextRequest } from "next/server";
import { ok, fail, requireSharedSecret, enforceRateLimit, readJson, mapUpstreamError } from "@/lib/http";
import { translateInput } from "@/lib/validation";
import { translateText } from "@/lib/ai";
import { getCachedTranslation, saveTranslation } from "@/lib/db";
import { supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

// POST /api/translate
// body: { message_id: uuid, text: string, target_language: "ja"|"en" }
// -> { data: { source_language, translated_text, cached } }
//
// Policy: FAIL-OPEN. On upstream failure return 503 + degraded; the client
// keeps showing the original text. Cache is keyed by (message_id, target).
export async function POST(req: NextRequest) {
  const unauthorized = requireSharedSecret(req);
  if (unauthorized) return unauthorized;

  const limited = enforceRateLimit(req, { key: "translate", windowMs: 60_000, max: 30 });
  if (limited) return limited;

  const parsed = await readJson(req, translateInput, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const { message_id, text, target_language } = parsed.value;

  // 1. cache lookup (skipped when Supabase is not configured yet)
  if (supabaseConfigured()) {
    try {
      const cached = await getCachedTranslation(message_id, target_language);
      if (cached) {
        return ok({
          source_language: cached.sourceLanguage,
          translated_text: cached.translatedText,
          cached: true,
        });
      }
    } catch (err) {
      console.error("[ai] translation cache lookup failed:", err);
      // fall through to a live translation
    }
  }

  // 2. live translation
  let result;
  try {
    result = await translateText({ text, targetLanguage: target_language });
  } catch (err) {
    return mapUpstreamError(err, { feature: "translate", policy: "open" });
  }

  // 3. write-through cache (best effort)
  if (supabaseConfigured()) {
    try {
      await saveTranslation(message_id, target_language, result);
    } catch (err) {
      console.error("[ai] translation cache write failed:", err);
    }
  }

  return ok({
    source_language: result.sourceLanguage,
    translated_text: result.translatedText,
    cached: false,
  });
}

export function GET() {
  return fail("method_not_allowed", "use POST", 405);
}
