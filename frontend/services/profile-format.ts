export function formatApplicationBio(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;

    const seed = (parsed as { monsterSeed?: unknown }).monsterSeed;
    if (!seed || typeof seed !== "object" || Array.isArray(seed)) return fallback;

    const freeText = (seed as { freeText?: unknown }).freeText;
    return typeof freeText === "string" && freeText.trim() ? freeText.trim() : fallback;
  } catch {
    // Older profiles may contain ordinary prose instead of structured metadata.
    return trimmed;
  }
}
