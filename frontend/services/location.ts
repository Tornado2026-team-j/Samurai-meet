import * as Location from "expo-location";
import type { Coordinates } from "./matching";

export type LocationSearchSuggestion = {
  id: string;
  label: string;
  subtitle: string;
  coordinates: Coordinates;
};

export async function getCurrentCoordinates(): Promise<Coordinates | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    return null;
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    accuracy_m: Number.isFinite(accuracy) && accuracy !== null ? Math.max(0, accuracy) : 0,
    captured_at: new Date(position.timestamp).toISOString(),
  };
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

export async function resolveCurrentLocationDisplay(): Promise<{
  displayName: string;
  coordinates: Coordinates;
} | null> {
  const coordinates = await getCurrentCoordinates();
  if (!coordinates) return null;

  const addresses = await Location.reverseGeocodeAsync({
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  });
  const displayName = addresses
    .map(currentLocationDisplayName)
    .find((value): value is string => Boolean(value))
    ?? "Current location";

  return { displayName, coordinates };
}

export async function searchLocationSuggestions(
  query: string,
): Promise<LocationSearchSuggestion[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];

  const results = await Location.geocodeAsync(normalized);
  return Promise.all(results.slice(0, 5).map(async (result, index) => {
    let label = normalized;
    let subtitle = index === 0 ? "Best match" : `Candidate ${index + 1}`;

    try {
      const [address] = await Location.reverseGeocodeAsync({
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
}
