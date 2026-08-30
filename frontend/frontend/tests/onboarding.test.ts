import { describe, expect, test } from "bun:test";
import {
  parseAppMode,
  parseLanguage,
  parseLocalProfile,
} from "../services/onboarding-contract";

describe("onboarding storage validation", () => {
  test("accepts only supported languages", () => {
    expect(parseLanguage("ja")).toBe("ja");
    expect(parseLanguage("en")).toBe("en");
    expect(parseLanguage("fr")).toBeNull();
    expect(parseLanguage(null)).toBeNull();
  });

  test("accepts only supported app modes", () => {
    expect(parseAppMode("local")).toBe("local");
    expect(parseAppMode("traveler")).toBe("traveler");
    expect(parseAppMode("ja")).toBeNull();
    expect(parseAppMode("unknown")).toBeNull();
    expect(parseAppMode(null)).toBeNull();
  });

  test("accepts a complete local profile", () => {
    expect(
      parseLocalProfile(
        JSON.stringify({
          name: "田中 梨菜",
          nationalityCode: "JP",
          bio: "大阪を案内します",
          completed: true,
          identityVerificationChoice: "proceed",
        }),
      ),
    ).toEqual({
      name: "田中 梨菜",
      nationalityCode: "JP",
      bio: "大阪を案内します",
      completed: true,
      identityVerificationChoice: "proceed",
    });
  });

  test("adds the verification prompt to an older stored profile", () => {
    expect(
      parseLocalProfile(
        JSON.stringify({
          name: "Rina",
          nationalityCode: "JP",
          bio: "",
          completed: true,
        }),
      )?.identityVerificationChoice,
    ).toBeNull();
  });

  test("rejects malformed profile storage", () => {
    expect(parseLocalProfile("not-json")).toBeNull();
    expect(parseLocalProfile(JSON.stringify({ name: "Rina" }))).toBeNull();
  });
});
