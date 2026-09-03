import { describe, expect, it, mock } from "bun:test";

// A test double with no native methods models an Expo Go/runtime where the
// optional location module is not linked. The service must still import and
// return a reason instead of throwing.
mock.module("expo-location", () => ({}));

const location = await import("../services/location");

describe("location Expo Go fallback", () => {
  const previousPlacesMock = process.env.EXPO_PUBLIC_DEV_PLACES_MOCK;

  it("returns an unavailable reason when the native API is not linked", async () => {
    const result = await location.getCurrentCoordinatesResult();

    if (result.available) {
      expect(result.value.latitude).toBeNumber();
      expect(result.value.longitude).toBeNumber();
    } else {
      expect(["unsupported_platform", "native_module_unavailable"]).toContain(result.reason);
    }
    await expect(location.getCurrentCoordinates()).resolves.toBeNull();
  });

  it("does not call the native module for an empty suggestion query", async () => {
    await expect(location.searchLocationSuggestionsResult(" ")).resolves.toEqual({
      available: true,
      value: [],
    });
  });

  it("normalizes backend Places suggestions", async () => {
    process.env.EXPO_PUBLIC_DEV_PLACES_MOCK = "false";
    let requestedURL = "";
    globalThis.fetch = (async (input) => {
      requestedURL = String(input);
      return new Response(JSON.stringify({
        data: [{
          id: "ChIJosaka",
          place_id: "ChIJosaka",
          label: "大阪城公園",
          subtitle: "大阪府大阪市中央区大阪城",
          provider: "google_maps",
          coordinates: { latitude: 34.687315, longitude: 135.526201, accuracy_m: 0 },
        }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await location.searchLocationSuggestions("大阪城公園", {
        user_id: "user-1",
        session_id: "session-1",
        access_token: "access-token",
        refresh_token: "refresh-token",
      }, { language: "ja" });

      expect(requestedURL).toContain("/places/search?");
      expect(requestedURL).toContain("query=%E5%A4%A7%E9%98%AA%E5%9F%8E%E5%85%AC%E5%9C%92");
      expect(result).toEqual([{
        id: "ChIJosaka",
        placeId: "ChIJosaka",
        label: "大阪城公園",
        subtitle: "大阪府大阪市中央区大阪城",
        provider: "google_maps",
        coordinates: {
          latitude: 34.687315,
          longitude: 135.526201,
          accuracy_m: 0,
          captured_at: result[0]?.coordinates.captured_at,
        },
      }]);
    } finally {
      process.env.EXPO_PUBLIC_DEV_PLACES_MOCK = previousPlacesMock;
    }
  });

  it("loads nearby Google Places around the current coordinates", async () => {
    process.env.EXPO_PUBLIC_DEV_PLACES_MOCK = "false";
    let requestedURL = "";
    globalThis.fetch = (async (input) => {
      requestedURL = String(input);
      return new Response(JSON.stringify({
        data: [{
          id: "ChIJosaka-station",
          place_id: "ChIJosaka-station",
          label: "大阪駅",
          subtitle: "大阪府大阪市北区梅田３丁目１−１",
          provider: "google_maps",
          coordinates: { latitude: 34.7024854, longitude: 135.4959506, accuracy_m: 0 },
        }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await location.searchNearbyPlaces({
        latitude: 34.7024854,
        longitude: 135.4959506,
        accuracy_m: 12,
      }, {
        user_id: "user-1",
        session_id: "session-1",
        access_token: "access-token",
        refresh_token: "refresh-token",
      }, { language: "ja" });

      expect(requestedURL).toContain("/places/nearby?");
      expect(requestedURL).toContain("latitude=34.7024854");
      expect(requestedURL).toContain("longitude=135.4959506");
      expect(result[0]?.label).toBe("大阪駅");
      expect(result[0]?.coordinates.latitude).toBe(34.7024854);
    } finally {
      process.env.EXPO_PUBLIC_DEV_PLACES_MOCK = previousPlacesMock;
    }
  });

  it("uses development Places mocks without a backend session", async () => {
    process.env.EXPO_PUBLIC_DEV_PLACES_MOCK = "true";
    try {
      globalThis.fetch = (async () => {
        throw new Error("fetch should not be called by the Places mock");
      }) as unknown as typeof fetch;

      const suggestions = await location.searchLocationSuggestions("大阪");
      const nearby = await location.searchNearbyPlaces({
        latitude: 34.7024854,
        longitude: 135.4959506,
        accuracy_m: 12,
      });

      expect(suggestions[0]?.label).toBe("大阪駅");
      expect(nearby).toHaveLength(5);
      expect(nearby[0]?.coordinates.latitude).toBeGreaterThan(34.7024854);
    } finally {
      if (previousPlacesMock === undefined) {
        delete process.env.EXPO_PUBLIC_DEV_PLACES_MOCK;
      } else {
        process.env.EXPO_PUBLIC_DEV_PLACES_MOCK = previousPlacesMock;
      }
    }
  });
});
