import type { Platform } from "react-native";
import type * as Location from "expo-location";
import type { Coordinates } from "./matching";

type LocationModule = typeof import("expo-location");

export type LocationUnavailableReason =
  | "unsupported_platform"
  | "browser_api_unavailable"
  | "native_module_unavailable"
  | "permission_denied"
  | "position_unavailable"
  | "invalid_coordinates"
  | "geocoding_unavailable";

export type LocationResult<T> =
  | { available: true; value: T }
  | { available: false; reason: LocationUnavailableReason };

let locationModulePromise: Promise<LocationModule | null> | undefined;

const WEB_GEOCODER_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const WEB_GEOCODER_MIN_INTERVAL_MS = 1_000;
const WEB_GEOCODER_CACHE_TTL_MS = 5 * 60_000;

type BrowserPosition = {
  coords?: {
    latitude?: number;
    longitude?: number;
    accuracy?: number | null;
  };
  timestamp?: number;
};

type BrowserPositionError = { code?: number };

type BrowserGeolocation = {
  getCurrentPosition: (
    success: (position: BrowserPosition) => void,
    error?: (reason: BrowserPositionError) => void,
    options?: {
      enableHighAccuracy?: boolean;
      maximumAge?: number;
      timeout?: number;
    },
  ) => void;
};

type WebGeocoderResult = {
  place_id?: unknown;
  display_name?: unknown;
  name?: unknown;
  type?: unknown;
  lat?: unknown;
  lon?: unknown;
  address?: Record<string, unknown>;
};

const webLocationSearchCache = new Map<string, {
  expiresAt: number;
  value: LocationSearchSuggestion[];
}>();
let webGeocoderLastRequestAt = 0;
let webGeocoderQueue = Promise.resolve();

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

function isWebPlatform(): boolean {
  return runtimePlatform() === "web";
}

function getBrowserGeolocation(): BrowserGeolocation | null {
  if (!isWebPlatform() || typeof globalThis.navigator === "undefined") return null;
  const geolocation = globalThis.navigator.geolocation;
  return geolocation && typeof geolocation.getCurrentPosition === "function"
    ? geolocation
    : null;
}

function browserPositionErrorReason(error: BrowserPositionError): LocationUnavailableReason {
  if (error.code === 1) return "permission_denied";
  if (error.code === 2) return "position_unavailable";
  return "position_unavailable";
}

function validCoordinate(latitude: unknown, longitude: unknown): latitude is number {
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function browserCoordinatesResult(): Promise<LocationResult<Coordinates>> {
  const geolocation = getBrowserGeolocation();
  if (!geolocation) {
    return Promise.resolve({ available: false, reason: "browser_api_unavailable" });
  }

  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords?.latitude;
        const longitude = position.coords?.longitude;
        if (!validCoordinate(latitude, longitude) || typeof longitude !== "number") {
          resolve({ available: false, reason: "invalid_coordinates" });
          return;
        }

        const accuracy = position.coords?.accuracy;
        const timestamp = position.timestamp;
        const capturedAt = typeof timestamp === "number" && Number.isFinite(timestamp)
          ? new Date(timestamp).toISOString()
          : new Date().toISOString();
        resolve({
          available: true,
          value: {
            latitude,
            longitude,
            accuracy_m: typeof accuracy === "number" && Number.isFinite(accuracy)
              ? Math.max(0, accuracy)
              : 0,
            captured_at: capturedAt,
          },
        });
      },
      (error) => resolve({ available: false, reason: browserPositionErrorReason(error) }),
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 10_000,
      },
    );
  });
}

async function loadLocationModule(): Promise<LocationModule | null> {
  if (!locationModulePromise) {
    locationModulePromise = import("expo-location").catch(() => null);
  }
  return locationModulePromise;
}

export type LocationSearchSuggestion = {
  id: string;
  label: string;
  subtitle: string;
  coordinates: Coordinates;
};

export async function getCurrentCoordinatesResult(): Promise<LocationResult<Coordinates>> {
  if (isWebPlatform()) {
    return browserCoordinatesResult();
  }
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

export async function resolveCurrentLocationDisplayResult(
  fallbackDisplayName = "Current location",
): Promise<LocationResult<{
  displayName: string;
  coordinates: Coordinates;
}>> {
  const coordinates = await getCurrentCoordinatesResult();
  if (!coordinates.available) return coordinates;

  // expo-location's web geocoder is intentionally unavailable in current
  // Expo SDKs. The browser coordinates are still sufficient for recruitment
  // creation, so keep the user-facing label generic on Web.
  if (isWebPlatform()) {
    return {
      available: true,
      value: { displayName: fallbackDisplayName, coordinates: coordinates.value },
    };
  }

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
      ?? fallbackDisplayName;

    return { available: true, value: { displayName, coordinates: coordinates.value } };
  } catch {
    return { available: false, reason: "geocoding_unavailable" };
  }
}

export async function resolveCurrentLocationDisplay(
  fallbackDisplayName = "Current location",
): Promise<{
  displayName: string;
  coordinates: Coordinates;
} | null> {
  const result = await resolveCurrentLocationDisplayResult(fallbackDisplayName);
  return result.available ? result.value : null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function webLocationLabel(result: WebGeocoderResult, fallback: string): string {
  const address = result.address ?? {};
  const namedPlace = [
    result.name,
    address.amenity,
    address.tourism,
    address.shop,
    address.station,
    address.railway,
    address.neighbourhood,
    address.quarter,
  ]
    .map(textValue)
    .find((value): value is string => Boolean(value));
  if (namedPlace) return namedPlace;

  const displayName = textValue(result.display_name);
  return displayName?.split(",")[0]?.trim() || fallback;
}

function webLocationSubtitle(result: WebGeocoderResult): string {
  const address = result.address ?? {};
  const area = [
    address.suburb,
    address.city_district,
    address.city,
    address.town,
    address.village,
    address.state,
  ]
    .map(textValue)
    .filter((value): value is string => Boolean(value));
  const uniqueArea = [...new Set(area)];
  if (uniqueArea.length > 0) return uniqueArea.slice(0, 2).join(", ");

  const displayName = textValue(result.display_name);
  return displayName?.split(",").slice(1, 3).map((value) => value.trim()).filter(Boolean).join(", ")
    || "OpenStreetMap";
}

function buildWebLocationSearchURL(query: string): string {
  const url = new URL(WEB_GEOCODER_SEARCH_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "ja");
  url.searchParams.set("q", query);
  return url.toString();
}

function abortError(): Error {
  const error = new Error("The location search was aborted");
  error.name = "AbortError";
  return error;
}

async function waitForWebGeocoderSlot<T>(
  signal: AbortSignal | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const previous = webGeocoderQueue;
  let releaseQueue!: () => void;
  webGeocoderQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  try {
    await previous;
    if (signal?.aborted) throw abortError();
    const elapsed = Date.now() - webGeocoderLastRequestAt;
    const waitMs = Math.max(0, WEB_GEOCODER_MIN_INTERVAL_MS - elapsed);
    if (waitMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, waitMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(abortError());
        }, { once: true });
      });
    }
    if (signal?.aborted) throw abortError();
    webGeocoderLastRequestAt = Date.now();
    return await task();
  } finally {
    releaseQueue();
  }
}

function parseWebGeocoderResults(payload: unknown, query: string): LocationSearchSuggestion[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .filter((value): value is WebGeocoderResult => (
      typeof value === "object" && value !== null && !Array.isArray(value)
    ))
    .flatMap((result, index): LocationSearchSuggestion[] => {
      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      if (!validCoordinate(latitude, longitude) || typeof longitude !== "number") return [];
      const placeID = result.place_id === undefined || result.place_id === null
        ? null
        : String(result.place_id);
      return [{
          id: placeID ?? `${latitude}:${longitude}:${index}`,
          label: webLocationLabel(result, query),
          subtitle: webLocationSubtitle(result),
          coordinates: {
            latitude,
            longitude,
            accuracy_m: 0,
            captured_at: new Date().toISOString(),
          },
        },
      ];
    });
}

async function searchWebLocationSuggestionsResult(
  query: string,
  signal?: AbortSignal,
): Promise<LocationResult<LocationSearchSuggestion[]>> {
  const cached = webLocationSearchCache.get(query);
  if (cached && cached.expiresAt > Date.now()) {
    return { available: true, value: cached.value };
  }

  if (typeof globalThis.fetch !== "function") {
    return { available: false, reason: "geocoding_unavailable" };
  }

  try {
    const response = await waitForWebGeocoderSlot(signal, () => globalThis.fetch(
      buildWebLocationSearchURL(query),
      {
        headers: {
          Accept: "application/json",
          "Accept-Language": "ja",
        },
        signal,
      },
    ));
    if (!response.ok) return { available: false, reason: "geocoding_unavailable" };

    const suggestions = parseWebGeocoderResults(await response.json(), query);
    webLocationSearchCache.set(query, {
      expiresAt: Date.now() + WEB_GEOCODER_CACHE_TTL_MS,
      value: suggestions,
    });
    return { available: true, value: suggestions };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { available: false, reason: "geocoding_unavailable" };
  }
}

export async function searchLocationSuggestionsResult(
  query: string,
  signal?: AbortSignal,
): Promise<LocationResult<LocationSearchSuggestion[]>> {
  const normalized = query.trim();
  if (normalized.length < 2) return { available: true, value: [] };
  if (isWebPlatform()) {
    return searchWebLocationSuggestionsResult(normalized, signal);
  }
  if (runtimePlatform() !== "ios" && runtimePlatform() !== "android") {
    return { available: false, reason: "unsupported_platform" };
  }

  const location = await loadLocationModule();
  if (!location || typeof location.geocodeAsync !== "function") {
    return { available: false, reason: "native_module_unavailable" };
  }

  try {
    const results = await location.geocodeAsync(normalized);
    const validResults = results
      .filter((result) => Number.isFinite(result.latitude) && Number.isFinite(result.longitude))
      .slice(0, 5);
    const suggestions = await Promise.all(validResults.map(async (result, index) => {
      let label = normalized;
      let subtitle = index === 0 ? "Best match" : `Candidate ${index + 1}`;

      if (typeof location.reverseGeocodeAsync === "function") {
        try {
          const [address] = await location.reverseGeocodeAsync({
            latitude: result.latitude,
            longitude: result.longitude,
          });
          if (address) {
            label = currentLocationDisplayName(address) ?? normalized;
            subtitle = locationSubtitle(address) ?? subtitle;
          }
        } catch {
          // Keep the original query as the visible place label if reverse lookup fails.
        }
      }

      return {
        id: `${result.latitude}:${result.longitude}:${index}`,
        label,
        subtitle,
        coordinates: {
          latitude: result.latitude,
          longitude: result.longitude,
          accuracy_m: Number.isFinite(result.accuracy) && result.accuracy !== undefined
            ? Math.max(0, result.accuracy)
            : 0,
          captured_at: new Date().toISOString(),
        },
      };
    }));

    return { available: true, value: suggestions };
  } catch {
    return { available: false, reason: "geocoding_unavailable" };
  }
}

export async function searchLocationSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<LocationSearchSuggestion[]> {
  const result = await searchLocationSuggestionsResult(query, signal);
  return result.available ? result.value : [];
}
