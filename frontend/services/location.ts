import * as Location from "expo-location";
import type { Coordinates } from "./matching";

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
