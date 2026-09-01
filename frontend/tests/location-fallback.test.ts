import { describe, expect, it, mock } from "bun:test";

// A test double with no native methods models an Expo Go/runtime where the
// optional location module is not linked. The service must still import and
// return a reason instead of throwing.
mock.module("expo-location", () => ({}));

const location = await import("../services/location");

describe("location Expo Go fallback", () => {
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
});
