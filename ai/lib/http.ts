import { NextResponse } from "next/server";
import { z, ZodError, type ZodTypeAny } from "zod";
import { env } from "@/lib/env";
import { checkRateLimit, type RateLimitRule } from "@/lib/ratelimit";
import { NotImplemented, UpstreamError, InvalidUpstreamResponse } from "@/lib/errors";

export type { RateLimitRule };

// --- responses --------------------------------------------------------------

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, { status: 200, ...init });
}

export function fail(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: { code, message }, ...extra }, { status });
}

// --- access control (stand-in for real auth) -------------------------------

export function requireSharedSecret(req: Request): NextResponse | null {
  const expected = env.AI_SERVICE_SHARED_SECRET;
  if (!expected) {
    if (env.isProduction) {
      return fail(
        "misconfigured",
        "AI_SERVICE_SHARED_SECRET is not set",
        503,
      );
    }
    console.warn("[ai] AI_SERVICE_SHARED_SECRET is unset — skipping the header check (dev only)");
    return null;
  }
  const provided = req.headers.get("x-ai-secret");
  if (!provided || provided !== expected) {
    return fail("unauthorized", "missing or invalid x-ai-secret header", 401);
  }
  return null;
}

// --- rate limiting ---------------------------------------------------------

/** Returns a 429 response if the caller is over the limit, otherwise null. */
export function enforceRateLimit(req: Request, rule: RateLimitRule): NextResponse | null {
  const result = checkRateLimit(req, rule);
  if (result.ok) return null;
  const res = fail("rate_limited", "too many requests", 429);
  res.headers.set("Retry-After", String(result.retryAfter));
  return res;
}

// --- request body parsing ------------------------------------------------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

export async function readJson<S extends ZodTypeAny>(
  req: Request,
  schema: S,
  maxBytes = 16 * 1024,
): Promise<Parsed<z.infer<S>>> {
  const raw = await req.text();
  if (raw.length > maxBytes) {
    return { ok: false, response: fail("payload_too_large", `body exceeds ${maxBytes} bytes`, 413) };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, response: fail("invalid_json", "request body is not valid JSON", 400) };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      response: fail("invalid_input", flattenZod(result.error), 400),
    };
  }
  return { ok: true, value: result.data };
}

function flattenZod(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

// --- upstream error mapping --------------------------------------------------

export type FailurePolicy = "closed" | "open";

/**
 * Map an error thrown by a lib/ai.ts or lib/geo.ts call to an HTTP response.
 *
 * - NotImplemented           -> 501 (stub not filled in yet)
 * - InvalidUpstreamResponse  -> 502 always (never trust a broken contract)
 * - UpstreamError, policy=closed -> 502
 * - UpstreamError, policy=open   -> 503 with `degraded: true`
 * - anything else            -> 500
 */
export function mapUpstreamError(
  err: unknown,
  opts: { feature: string; policy: FailurePolicy },
): NextResponse {
  if (err instanceof NotImplemented) {
    return fail("not_implemented", err.message, 501);
  }
  if (err instanceof InvalidUpstreamResponse) {
    return fail(`${opts.feature}_failed`, "upstream returned an invalid response", 502);
  }
  if (err instanceof UpstreamError) {
    if (opts.policy === "open") {
      return fail(`${opts.feature}_unavailable`, err.message, 503, { degraded: true });
    }
    return fail(`${opts.feature}_failed`, err.message, 502);
  }
  console.error(`[ai] unexpected error in ${opts.feature}:`, err);
  return fail("internal_error", "unexpected error", 500);
}
