import type { NextRequest } from "next/server";
import { ok, fail, requireSharedSecret, enforceRateLimit, mapUpstreamError } from "@/lib/http";
import { locationQuery } from "@/lib/validation";
import { resolveLocationName } from "@/lib/geo";

export const runtime = "nodejs";

// GET /api/location/name?lat=..&lng=..
// -> { data: { display_name, source } }
//
// No AI. Google Maps + deterministic priority rules (see lib/geo.ts).
// Policy: FAIL-OPEN — the client falls back to its own device-side name.
// The response never contains the raw coordinates or a building-level name.
export async function GET(req: NextRequest) {
  const unauthorized = requireSharedSecret(req);
  if (unauthorized) return unauthorized;

  const limited = enforceRateLimit(req, { key: "location_name", windowMs: 10_000, max: 15 });
  if (limited) return limited;

  const url = new URL(req.url);
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");
  if (!lat || !lng) {
    return fail("invalid_input", "lat and lng query parameters are required", 400);
  }
  const parsed = locationQuery.safeParse({ lat, lng });
  if (!parsed.success) {
    return fail("invalid_input", "lat and lng must be valid coordinates", 400);
  }

  try {
    const result = await resolveLocationName({ lat: parsed.data.lat, lng: parsed.data.lng });
    return ok({ display_name: result.displayName, source: result.source });
  } catch (err) {
    return mapUpstreamError(err, { feature: "location_name", policy: "open" });
  }
}
