import type { NextRequest } from "next/server";
import { ok, fail, requireSharedSecret, enforceRateLimit, readJson, mapUpstreamError } from "@/lib/http";
import { classifyInput } from "@/lib/validation";
import { classifyRecruitment } from "@/lib/ai";
import type { ClassifyResult } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/requests/classify
// body: { activity: string, where?: string }
// -> { data: { category, keywords } }
//
// Policy: FAIL-CLOSED. If the model is unavailable or returns a broken
// contract, the caller must not publish a guessed category.
export async function POST(req: NextRequest) {
  const unauthorized = requireSharedSecret(req);
  if (unauthorized) return unauthorized;

  const limited = enforceRateLimit(req, { key: "classify", windowMs: 2_000, max: 1 });
  if (limited) return limited;

  const parsed = await readJson(req, classifyInput, 8 * 1024);
  if (!parsed.ok) return parsed.response;

  try {
    const result: ClassifyResult = await classifyRecruitment({
      activity: parsed.value.activity,
      where: parsed.value.where,
    });
    return ok(result);
  } catch (err) {
    return mapUpstreamError(err, { feature: "classify", policy: "closed" });
  }
}

export function GET() {
  return fail("method_not_allowed", "use POST", 405);
}
