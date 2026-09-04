import { describe, expect, it, mock } from "bun:test";

// Expo Go is identified before expo-notifications is imported. This keeps a
// missing optional native module from becoming a startup/runtime crash.
mock.module("expo-constants", () => ({ default: { appOwnership: "expo" } }));

const pushNotifications = await import("../services/push-notifications");

describe("push notification Expo Go fallback", () => {
  it("returns a capability result instead of importing notifications eagerly", async () => {
    const result = await pushNotifications.getPushCapability();

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(["unsupported_platform", "expo_go", "physical_device_required", "native_module_unavailable"])
        .toContain(result.reason);
    }
  });

  it("recognizes Expo Go through the SDK 57 execution environment", async () => {
    mock.module("react-native", () => ({ Platform: { OS: "ios" } }));
    mock.module("expo-constants", () => ({ default: { executionEnvironment: "storeClient" } }));
    const freshPushNotifications = await import(`../services/push-notifications?expo-go-${Date.now()}`);

    const result = await freshPushNotifications.getPushCapability();

    expect(result).toEqual({ available: false, reason: "expo_go" });
  });

  it("returns a reason for token acquisition failure", async () => {
    const result = await pushNotifications.requestPushTokenResult();

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(["unsupported_platform", "expo_go", "physical_device_required", "native_module_unavailable"])
        .toContain(result.reason);
    }
  });
});
