export type AppLanguage = "ja" | "en";
export type AppMode = "local" | "traveler";
export type IdentityVerificationChoice = "proceed" | "later" | null;

export type LocalProfile = {
  name: string;
  nationalityCode: string;
  bio: string;
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
    if (
      typeof candidate.name !== "string" ||
      typeof candidate.nationalityCode !== "string" ||
      typeof candidate.bio !== "string" ||
      typeof candidate.completed !== "boolean" ||
      ![null, "proceed", "later"].includes(identityVerificationChoice)
    ) {
      return null;
    }

    return {
      name: candidate.name,
      nationalityCode: candidate.nationalityCode,
      bio: candidate.bio,
      completed: candidate.completed,
      identityVerificationChoice,
    };
  } catch {
    return null;
  }
}
