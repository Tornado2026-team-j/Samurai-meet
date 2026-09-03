// Centralised, typed access to environment variables. Values are read once at
// module load. Missing values are surfaced where they are used (e.g. the
// Supabase client throws) rather than crashing the whole process on boot, so
// unrelated routes keep working while the AI owner wires their keys.

function str(key: string, fallback = ""): string {
  return process.env[key]?.trim() ?? fallback;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const env = {
  // OpenAI — consumed by lib/ai.ts (TODO(ai)).
  OPENAI_API_KEY: str("OPENAI_API_KEY"),
  OPENAI_TEXT_MODEL: str("OPENAI_TEXT_MODEL", "gpt-4o-mini"),
  OPENAI_IMAGE_MODEL: str("OPENAI_IMAGE_MODEL", "gpt-image-1"),
  OPENAI_MODERATION_MODEL: str("OPENAI_MODERATION_MODEL", "omni-moderation-latest"),

  // Google Maps — consumed by lib/geo.ts (TODO).
  GOOGLE_MAPS_API_KEY: str("GOOGLE_MAPS_API_KEY"),

  // Supabase.
  SUPABASE_URL: str("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: str("SUPABASE_SERVICE_ROLE_KEY"),
  SUPABASE_MONSTER_BUCKET: str("SUPABASE_MONSTER_BUCKET", "monsters"),

  // Access control (stand-in for real auth).
  AI_SERVICE_SHARED_SECRET: str("AI_SERVICE_SHARED_SECRET"),

  // Feature limits.
  MONSTER_REGEN_LIMIT: int("MONSTER_REGEN_LIMIT", 3),

  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
} as const;
