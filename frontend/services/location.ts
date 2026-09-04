import type { Platform } from "react-native";
import type * as Location from "expo-location";
import type { Session } from "./auth-contract";
import { requestAPI } from "./api-client";
import type { Coordinates } from "./matching";

type LocationModule = typeof import("expo-location");

export type LocationUnavailableReason =
  | "unsupported_platform"
  | "native_module_unavailable"
  | "permission_denied"
  | "position_unavailable"
  | "invalid_coordinates"
  | "geocoding_unavailable"
  | "places_unavailable";

export type LocationResult<T> =
  | { available: true; value: T }
  | { available: false; reason: LocationUnavailableReason };

let locationModulePromise: Promise<LocationModule | null> | undefined;

function runtimePlatform(): typeof Platform.OS | undefined {
  try {
    // Keep the core platform module out of the route evaluation path in
    // runtimes that cannot load optional native APIs (including Bun tests).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require("react-native") as { Platform?: typeof Platform };
    return native.Platform?.OS;
  } catch {
    return undefined;
  }
}

async function loadLocationModule(): Promise<LocationModule | null> {
  if (!locationModulePromise) {
    locationModulePromise = import("expo-location").catch(() => null);
  }
  return locationModulePromise;
}

export type LocationSearchSuggestion = {
  id: string;
  placeId?: string;
  label: string;
  subtitle: string;
  provider?: "google_maps";
  coordinates: Coordinates;
};

type PlacesSearchResponse = {
  data?: unknown;
};

export async function getCurrentCoordinatesResult(): Promise<LocationResult<Coordinates>> {
  if (runtimePlatform() !== "ios" && runtimePlatform() !== "android") {
    return { available: false, reason: "unsupported_platform" };
  }

  const location = await loadLocationModule();
  if (!location
    || typeof location.requestForegroundPermissionsAsync !== "function"
    || typeof location.getCurrentPositionAsync !== "function") {
    return { available: false, reason: "native_module_unavailable" };
  }

  try {
    const permission = await location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      return { available: false, reason: "permission_denied" };
    }

    const position = await location.getCurrentPositionAsync({
      accuracy: location.Accuracy?.Balanced,
    });
    const { latitude, longitude, accuracy } = position.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { available: false, reason: "invalid_coordinates" };
    }

    return {
      available: true,
      value: {
        latitude,
        longitude,
        accuracy_m: Number.isFinite(accuracy) && accuracy !== null ? Math.max(0, accuracy) : 0,
        captured_at: new Date(position.timestamp).toISOString(),
      },
    };
  } catch {
    return { available: false, reason: "position_unavailable" };
  }
}

export async function getCurrentCoordinates(): Promise<Coordinates | null> {
  const result = await getCurrentCoordinatesResult();
  return result.available ? result.value : null;
}

function isUsefulPlacemarkName(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\d/.test(trimmed)) return false;
  if (/[0-9０-９]+(?:-|−|ー|丁目|番|番地|号)/u.test(trimmed)) return false;
  if (/〒|postal|postcode/i.test(trimmed)) return false;
  return true;
}

function compactLocationName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function currentLocationDisplayName(address: Location.LocationGeocodedAddress): string | null {
  const namedPlace = isUsefulPlacemarkName(address.name) ? address.name.trim() : null;
  if (namedPlace) return namedPlace;

  const stationName = [
    address.street,
    address.district,
    address.city,
    address.subregion,
  ].find((candidate) => {
    const normalized = compactLocationName(candidate);
    return normalized ? /(駅|station)/iu.test(normalized) : false;
  });
  if (stationName) return stationName.trim();

  return compactLocationName(address.district)
    ?? compactLocationName(address.city)
    ?? compactLocationName(address.subregion)
    ?? compactLocationName(address.region);
}

function locationSubtitle(address: Location.LocationGeocodedAddress): string | null {
  const parts = [
    address.district,
    address.city,
    address.subregion,
    address.region,
  ]
    .map(compactLocationName)
    .filter((value): value is string => Boolean(value));
  return [...new Set(parts)].slice(0, 2).join(", ") || null;
}

export async function resolveCurrentLocationDisplayResult(): Promise<LocationResult<{
  displayName: string;
  coordinates: Coordinates;
}>> {
  const coordinates = await getCurrentCoordinatesResult();
  if (!coordinates.available) return coordinates;

  const location = await loadLocationModule();
  if (!location || typeof location.reverseGeocodeAsync !== "function") {
    return { available: false, reason: "native_module_unavailable" };
  }

  try {
    const addresses = await location.reverseGeocodeAsync({
      latitude: coordinates.value.latitude,
      longitude: coordinates.value.longitude,
    });
    const displayName = addresses
      .map(currentLocationDisplayName)
      .find((value): value is string => Boolean(value))
      ?? "Current location";

    return { available: true, value: { displayName, coordinates: coordinates.value } };
  } catch {
    return { available: false, reason: "geocoding_unavailable" };
  }
}

export async function resolveCurrentLocationDisplay(): Promise<{
  displayName: string;
  coordinates: Coordinates;
} | null> {
  const result = await resolveCurrentLocationDisplayResult();
  return result.available ? result.value : null;
}

export async function searchLocationSuggestionsResult(
  query: string,
  session?: Session | null,
  options: {
    language?: "ja" | "en";
    latitude?: number;
    longitude?: number;
    signal?: AbortSignal;
  } = {},
): Promise<LocationResult<LocationSearchSuggestion[]>> {
  const normalized = query.trim();
  if (normalized.length < 2) return { available: true, value: [] };
  if (!session) return { available: false, reason: "places_unavailable" };

  try {
    const response = await requestAPI<PlacesSearchResponse>(
      `/places/search${placesSearchQuery(normalized, options)}`,
      session,
      { method: "GET", signal: options.signal },
    );
    const suggestions = normalizePlacesSuggestions(response.data);
    return { available: true, value: suggestions };
  } catch {
    return { available: false, reason: "places_unavailable" };
  }
}

export async function searchLocationSuggestions(
  query: string,
  session?: Session | null,
  options: {
    language?: "ja" | "en";
    latitude?: number;
    longitude?: number;
    signal?: AbortSignal;
  } = {},
): Promise<LocationSearchSuggestion[]> {
  const result = await searchLocationSuggestionsResult(query, session, options);
  return result.available ? result.value : [];
}

export async function searchNearbyPlacesResult(
  coordinates: Coordinates,
  session?: Session | null,
  options: {
    language?: "ja" | "en";
    signal?: AbortSignal;
  } = {},
): Promise<LocationResult<LocationSearchSuggestion[]>> {
  if (!Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude)) {
    return { available: false, reason: "invalid_coordinates" };
  }
  if (!session) return { available: false, reason: "places_unavailable" };

  try {
    const response = await requestAPI<PlacesSearchResponse>(
      `/places/nearby${nearbyPlacesQuery(coordinates, options)}`,
      session,
      { method: "GET", signal: options.signal },
    );
    const suggestions = normalizePlacesSuggestions(response.data);
    return { available: true, value: suggestions };
  } catch {
    return { available: false, reason: "places_unavailable" };
  }
}

export async function searchNearbyPlaces(
  coordinates: Coordinates,
  session?: Session | null,
  options: {
    language?: "ja" | "en";
    signal?: AbortSignal;
  } = {},
): Promise<LocationSearchSuggestion[]> {
  const result = await searchNearbyPlacesResult(coordinates, session, options);
  return result.available ? result.value : [];
}

function placesSearchQuery(
  query: string,
  options: {
    language?: "ja" | "en";
    latitude?: number;
    longitude?: number;
  },
): string {
  const parts = [`query=${encodeURIComponent(query)}`, "limit=5"];
  if (options.language) parts.push(`language=${encodeURIComponent(options.language)}`);
  if (Number.isFinite(options.latitude) && Number.isFinite(options.longitude)) {
    parts.push(`latitude=${encodeURIComponent(String(options.latitude))}`);
    parts.push(`longitude=${encodeURIComponent(String(options.longitude))}`);
  }
  return `?${parts.join("&")}`;
}

function nearbyPlacesQuery(
  coordinates: Coordinates,
  options: {
    language?: "ja" | "en";
  },
): string {
  const parts = [
    `latitude=${encodeURIComponent(String(coordinates.latitude))}`,
    `longitude=${encodeURIComponent(String(coordinates.longitude))}`,
    "limit=5",
  ];
  if (options.language) parts.push(`language=${encodeURIComponent(options.language)}`);
  return `?${parts.join("&")}`;
}

function normalizePlacesSuggestions(value: unknown): LocationSearchSuggestion[] {
  if (!Array.isArray(value)) return [];
  const suggestions: LocationSearchSuggestion[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const coordinates = candidate.coordinates;
    if (!coordinates || typeof coordinates !== "object") continue;
    const coordinateValues = coordinates as Record<string, unknown>;
    const latitude = coordinateValues.latitude;
    const longitude = coordinateValues.longitude;
    const label = candidate.label;
    if (typeof label !== "string" || !label.trim()) continue;
    if (typeof latitude !== "number" || typeof longitude !== "number") continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const id = typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : `${latitude}:${longitude}:${suggestions.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const subtitle = typeof candidate.subtitle === "string" && candidate.subtitle.trim()
      ? candidate.subtitle.trim()
      : "Google Maps";
    suggestions.push({
      id,
      placeId: typeof candidate.place_id === "string" ? candidate.place_id : undefined,
      label: label.trim(),
      subtitle,
      provider: candidate.provider === "google_maps" ? "google_maps" : undefined,
      coordinates: {
        latitude,
        longitude,
        accuracy_m: typeof coordinateValues.accuracy_m === "number" && Number.isFinite(coordinateValues.accuracy_m)
          ? Math.max(0, coordinateValues.accuracy_m)
          : 0,
        captured_at: new Date().toISOString(),
      },
    });
    if (suggestions.length >= 5) break;
  }

  return suggestions;
}
