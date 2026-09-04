import { afterEach, describe, expect, it, mock } from "bun:test";

// A test double with no native methods models an Expo Go/runtime where the
// optional location module is not linked. The service must still import and
// return a reason instead of throwing.
mock.module("expo-location", () => ({}));
mock.module("react-native", () => ({ Platform: { OS: "web" } }));

const location = await import("../services/location");

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
  globalThis.fetch = originalFetch;
});

describe("location web fallback", () => {
  it("returns an unavailable reason when the browser API is not available", async () => {
    const result = await location.getCurrentCoordinatesResult();

    if (result.available) {
      expect(result.value.latitude).toBeNumber();
      expect(result.value.longitude).toBeNumber();
    } else {
      expect(["unsupported_platform", "browser_api_unavailable", "native_module_unavailable"]).toContain(result.reason);
    }
    await expect(location.getCurrentCoordinates()).resolves.toBeNull();
  });

  it("uses browser geolocation coordinates on Web", async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        geolocation: {
          getCurrentPosition: (success: (position: unknown) => void, _error: unknown, options: Record<string, unknown>) => {
            receivedOptions = options;
            success({
              coords: { latitude: 34.7025, longitude: 135.4959, accuracy: 25 },
              timestamp: Date.parse("2026-09-05T00:00:00Z"),
            });
          },
        },
      },
    });

    await expect(location.getCurrentCoordinatesResult()).resolves.toEqual({
      available: true,
      value: {
        latitude: 34.7025,
        longitude: 135.4959,
        accuracy_m: 25,
        captured_at: "2026-09-05T00:00:00.000Z",
      },
    });
    expect(receivedOptions).toMatchObject({ enableHighAccuracy: true });
  });

  it("searches Web place names and returns selectable coordinates", async () => {
    let requestURL = "";
    globalThis.fetch = (async (input) => {
      requestURL = String(input);
      return new Response(JSON.stringify([
        {
          place_id: 123,
          display_name: "梅田駅, 大阪市北区, 大阪府, 日本",
          name: "梅田駅",
          lat: "34.702485",
          lon: "135.495951",
          address: { city: "大阪市", suburb: "北区" },
        },
      ]), { headers: { "content-type": "application/json" }, status: 200 });
    }) as typeof fetch;

    await expect(location.searchLocationSuggestionsResult("梅田駅")).resolves.toEqual({
      available: true,
      value: [{
        id: "123",
        label: "梅田駅",
        subtitle: "北区, 大阪市",
        coordinates: {
          latitude: 34.702485,
          longitude: 135.495951,
          accuracy_m: 0,
          captured_at: expect.any(String),
        },
      }],
    });
    expect(requestURL).toContain("nominatim.openstreetmap.org/search");
    expect(requestURL).toContain(encodeURIComponent("梅田駅"));
  });

  it("does not call the native module for an empty suggestion query", async () => {
    await expect(location.searchLocationSuggestionsResult(" ")).resolves.toEqual({
      available: true,
      value: [],
    });
  });
});
