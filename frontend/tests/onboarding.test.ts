import { describe, expect, test } from "bun:test";
import { parseLanguage, parseLocalProfile } from "../services/onboarding-contract";

describe("onboarding storage validation", () => {
  test("accepts only supported languages", () => {
    expect(parseLanguage("ja")).toBe("ja");
    expect(parseLanguage("en")).toBe("en");
    expect(parseLanguage("fr")).toBeNull();
    expect(parseLanguage(null)).toBeNull();
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

  test("rejects malformed profile storage", () => {
    expect(parseLocalProfile("not-json")).toBeNull();
    expect(parseLocalProfile(JSON.stringify({ name: "Rina" }))).toBeNull();
  });
});
