// ===========================================================================
// AI / INFRA OWNER: implement `resolveLocationName`.
// ===========================================================================
//
// No AI here — this is Google Maps + deterministic rules. Ported priorities
// from frontend/services/location.ts (`currentLocationDisplayName`):
//
//   1. "poi"          nearest prominent establishment / landmark name
//   2. "station"      nearest station (train_station / subway_station /
//                     transit_station), name ending in 駅 / "Station"
//   3. "neighborhood" neighborhood / sublocality (町 / 丁目-free area name)
//   4. "ward"         ward / locality (区 / 市)
//
// SAFETY: never return a street_number / premise / route / postal_code level
// name. Do not echo the raw lat/lng. Do not return a building or apartment
// name. When nothing clean resolves, return { displayName: "Current location",
// source: "ward" } rather than something too precise.
//
// Suggested APIs:
//   - Places Nearby Search: `rankby=distance`, `type=tourist_attraction` /
//     `point_of_interest`, then `type=train_station|subway_station`.
//   - Reverse Geocoding: pull `sublocality_level_1` / `locality` /
//     `administrative_area_level_*` for the fallback.
//   - Key: env.GOOGLE_MAPS_API_KEY (server-only).
//
// On upstream failure throw `UpstreamError` — the route fails soft (the client
// keeps its own device-side reverse-geocoded name).
//
// ===========================================================================

import { env } from "@/lib/env";
import { NotImplemented } from "@/lib/errors";
import type { LocationName } from "@/lib/types";

void env;

export async function resolveLocationName(_input: {
  lat: number;
  lng: number;
}): Promise<LocationName> {
  throw new NotImplemented("resolveLocationName");
}
