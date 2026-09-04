import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library/legacy";
import { Platform } from "react-native";

export type DeviceImageSaveResult = "saved" | "permission_denied" | "unavailable";

export async function saveDataURIImageToLibrary(dataURI: string, filenameBase: string): Promise<DeviceImageSaveResult> {
  if (Platform.OS === "web") return "unavailable";
  const available = await MediaLibrary.isAvailableAsync();
  if (!available) return "unavailable";
  const permission = await MediaLibrary.requestPermissionsAsync(true, ["photo"]);
  if (!permission.granted) return "permission_denied";

  const parsed = parseDataURIImage(dataURI);
  const file = new File(Paths.cache, `${safeFilename(filenameBase)}-${Date.now()}.${parsed.extension}`);
  safeDeleteFile(file);
  file.write(parsed.bytes);
  await MediaLibrary.saveToLibraryAsync(file.uri);
  return "saved";
}

function parseDataURIImage(dataURI: string): { bytes: Uint8Array; extension: "jpg" | "png" | "webp" } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/u.exec(dataURI);
  if (!match) throw new Error("invalid_image_data_uri");
  const contentType = match[1];
  const encoded = match[2];
  if (!contentType || !encoded) throw new Error("invalid_image_data_uri");
  const binary = atob(encoded);
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return {
    bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    extension,
  };
}

function safeFilename(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "samurai-meet-image";
}

function safeDeleteFile(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup should not block a fresh save.
  }
}
