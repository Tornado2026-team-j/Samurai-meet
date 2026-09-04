export type AppLanguage = "ja" | "en";
export type AppMode = "local" | "traveler";
export type IdentityVerificationChoice = "proceed" | "later" | null;

export type MonsterSeedProfile = {
  skillTags: string[];
  interestTags: string[];
  freeText: string;
};

export const MONSTER_INPUT_LIMITS = {
  interestMin: 1,
  interestMax: 2,
  skillMin: 0,
  skillMax: 2,
  jaItemCharacters: 15,
  enItemCharacters: 30,
} as const;

export type LocalProfile = {
  name: string;
  nationalityCode: string;
  monsterSeed: MonsterSeedProfile;
  completed: boolean;
  identityVerificationChoice: IdentityVerificationChoice;
};

export function parseLanguage(value: string | null): AppLanguage | null {
  return value === "ja" || value === "en" ? value : null;
}

export function parseAppMode(value: string | null): AppMode | null {
  return value === "local" || value === "traveler" ? value : null;
}

export function parseIdentityVerificationChoice(
  value: string | null,
): IdentityVerificationChoice {
  return value === "proceed" || value === "later" ? value : null;
}

export function parseLocalProfile(value: string | null): LocalProfile | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;

    const candidate = parsed as Partial<LocalProfile>;
    const identityVerificationChoice = parseIdentityVerificationChoice(
      candidate.identityVerificationChoice ?? null,
    );
    const monsterSeedCandidate = (candidate as {
      monsterSeed?: Partial<MonsterSeedProfile>;
      bio?: unknown;
    }).monsterSeed;
    const legacyBio = (candidate as { bio?: unknown }).bio;
    const monsterSeed = parseMonsterSeedProfile(monsterSeedCandidate, legacyBio);
    if (
      typeof candidate.name !== "string" ||
      typeof candidate.nationalityCode !== "string" ||
      !monsterSeed ||
      typeof candidate.completed !== "boolean" ||
      ![null, "proceed", "later"].includes(identityVerificationChoice)
    ) {
      return null;
    }

    return {
      name: candidate.name,
      nationalityCode: candidate.nationalityCode,
      monsterSeed,
      completed: candidate.completed,
      identityVerificationChoice,
    };
  } catch {
    return null;
  }
}

export function serializeMonsterSeedForLegacyBio(profile: LocalProfile): string {
  return JSON.stringify({
    monsterSeed: profile.monsterSeed,
  });
}

function parseTagList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((tag) => typeof tag === "string")) return null;
  return [...new Set(value.map((tag) => tag.trim()).filter(Boolean))].slice(0, 2);
}

function parseMonsterSeedProfile(
  value: Partial<MonsterSeedProfile> | undefined,
  legacyBio: unknown,
): MonsterSeedProfile | null {
  if (!value || typeof value !== "object") {
    if (typeof legacyBio !== "string") return null;
    return {
      skillTags: [],
      interestTags: [],
      freeText: legacyBio.slice(0, 150),
    };
  }

  const skillTags = parseTagList(value.skillTags);
  const interestTags = parseTagList(value.interestTags);
  if (
    !skillTags ||
    !interestTags ||
    typeof value.freeText !== "string"
  ) {
    return null;
  }

  return {
    skillTags,
    interestTags,
    freeText: value.freeText.trim().slice(0, 150),
  };
}
