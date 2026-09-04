import { describe, expect, test } from "bun:test";
import {
  localProfileFromRemoteProfile,
  parseAppMode,
  parseLanguage,
  parseLocalProfile,
  parseMonsterSeedFromBio,
} from "../services/onboarding-contract";
import { resolveDefaultAppMode, resolveDefaultNationalityCode } from "../services/device-locale";

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
          monsterSeed: {
            skillTags: ["english_conversation", "directions"],
            interestTags: ["cafes"],
            freeText: "路地裏の小さな喫茶店が好きです",
          },
          completed: true,
          identityVerificationChoice: "proceed",
        }),
      ),
    ).toEqual({
      name: "田中 梨菜",
      nationalityCode: "JP",
      monsterSeed: {
        skillTags: ["english_conversation", "directions"],
        interestTags: ["cafes"],
        freeText: "路地裏の小さな喫茶店が好きです",
      },
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
          monsterSeed: {
            skillTags: ["photography"],
            interestTags: ["food", "anime"],
            freeText: "",
          },
          completed: true,
        }),
      )?.identityVerificationChoice,
    ).toBeNull();
  });

  test("migrates legacy bio into monster seed free text", () => {
    expect(
      parseLocalProfile(
        JSON.stringify({
          name: "Rina",
          nationalityCode: "JP",
          bio: "大阪を案内します",
          completed: true,
        }),
      )?.monsterSeed,
    ).toEqual({
      skillTags: [],
      interestTags: [],
      freeText: "大阪を案内します",
    });
  });

  test("hydrates a remote structured bio into the shared profile shape", () => {
    expect(
      localProfileFromRemoteProfile(
        {
          name: "  Rina  ",
          nationality_code: "jp",
          bio: JSON.stringify({
            monsterSeed: {
              skillTags: ["photography"],
              interestTags: ["cafes"],
              freeText: "",
            },
          }),
          completed: true,
        },
        "later",
      ),
    ).toEqual({
      name: "Rina",
      nationalityCode: "JP",
      monsterSeed: {
        skillTags: ["photography"],
        interestTags: ["cafes"],
        freeText: "",
      },
      completed: true,
      identityVerificationChoice: "later",
    });
  });

  test("keeps ordinary remote bio text as the profile note", () => {
    expect(parseMonsterSeedFromBio("大阪を案内します")).toEqual({
      skillTags: [],
      interestTags: [],
      freeText: "大阪を案内します",
    });
  });

  test("rejects malformed profile storage", () => {
    expect(parseLocalProfile("not-json")).toBeNull();
    expect(parseLocalProfile(JSON.stringify({ name: "Rina" }))).toBeNull();
  });
});

describe("initial nationality defaults", () => {
  const supportedCountries = ["JP", "US", "FR"];

  test("prefers the device region over the selected display language", () => {
    expect(resolveDefaultNationalityCode("ja", supportedCountries, [{ regionCode: "FR" }])).toBe("FR");
  });

  test("falls back to the selected language when the device region is unavailable", () => {
    expect(resolveDefaultNationalityCode("ja", supportedCountries, [{ regionCode: null }])).toBe("JP");
    expect(resolveDefaultNationalityCode("en", supportedCountries, [])).toBe("US");
  });

  test("ignores an unsupported device region", () => {
    expect(resolveDefaultNationalityCode("en", supportedCountries, [{ regionCode: "ZZ" }])).toBe("US");
  });

  test("chooses the initial app mode from the device region before language", () => {
    expect(resolveDefaultAppMode("en", [{ regionCode: "JP" }])).toBe("local");
    expect(resolveDefaultAppMode("ja", [{ regionCode: "US" }])).toBe("traveler");
    expect(resolveDefaultAppMode("ja", [{ regionCode: null }])).toBe("local");
  });
});
