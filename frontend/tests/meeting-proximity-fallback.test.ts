import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("expo-constants", () => ({ default: { appOwnership: "expo" } }));

const { meetingProximityCapability: fromMeeting } = await import("../services/meeting");
const { meetingProximityCapability } = await import("../services/meeting-proximity");

const previousFlag = process.env.EXPO_PUBLIC_MEETING_PROXIMITY_ENABLED;

afterEach(() => {
  if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_MEETING_PROXIMITY_ENABLED;
  else process.env.EXPO_PUBLIC_MEETING_PROXIMITY_ENABLED = previousFlag;
});

describe("meeting proximity Expo Go fallback", () => {
  it("fails closed while the audited native adapter is disabled", () => {
    process.env.EXPO_PUBLIC_MEETING_PROXIMITY_ENABLED = "false";

    expect(meetingProximityCapability()).toEqual({ enabled: false, reason: "feature_disabled" });
    expect(fromMeeting()).toEqual({ enabled: false, reason: "feature_disabled" });
  });

  it("never reports a fake proximity measurement as available", () => {
    process.env.EXPO_PUBLIC_MEETING_PROXIMITY_ENABLED = "true";

    const result = meetingProximityCapability();
    expect(result.enabled).toBe(false);
    expect([
      "expo_go",
      "unsupported_platform",
      "native_module_unavailable",
      "native_adapter_unavailable",
    ]).toContain(result.reason);
  });
});
