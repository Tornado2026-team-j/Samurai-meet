// In-memory fixed-window rate limiter keyed by route + client IP.
//
// This is deliberately simple and process-local: it is enough for a single
// instance and for protecting the (paid) upstream calls while there is no auth.
// When the service is deployed to multiple instances / serverless, swap this
// for Vercel KV or Upstash Redis behind the same `checkRateLimit` signature.

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

// Best-effort sweep so the map does not grow unbounded.
let lastSweep = 0;
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitRule {
  /** stable identifier for the route, e.g. "classify" */
  key: string;
  /** window length in milliseconds */
  windowMs: number;
  /** max requests allowed per window */
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** seconds until the window resets, for the Retry-After header */
  retryAfter: number;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function checkRateLimit(req: Request, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const id = `${rule.key}:${clientIp(req)}`;
  const existing = windows.get(id);

  if (!existing || existing.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true, retryAfter: 0 };
  }

  if (existing.count >= rule.max) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { ok: true, retryAfter: 0 };
}
