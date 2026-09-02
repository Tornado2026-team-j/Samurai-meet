import type { Platform } from "react-native";
import type * as Location from "expo-location";
import type { Coordinates } from "./matching";

type LocationModule = typeof import("expo-location");

export type LocationUnavailableReason =
  | "unsupported_platform"
  | "native_module_unavailable"
  | "permission_denied"
  | "position_unavailable"
  | "invalid_coordinates"
  | "geocoding_unavailable";

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
  label: string;
  subtitle: string;
  coordinates: Coordinates;
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
): Promise<LocationResult<LocationSearchSuggestion[]>> {
  const normalized = query.trim();
  if (normalized.length < 2) return { available: true, value: [] };
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
): Promise<LocationSearchSuggestion[]> {
  const result = await searchLocationSuggestionsResult(query);
  return result.available ? result.value : [];
}
