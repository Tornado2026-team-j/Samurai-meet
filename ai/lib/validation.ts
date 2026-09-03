import { z } from "zod";

// Reject control characters (except tab / newline / carriage return) up front so
// nothing downstream — prompts, DB rows, logs — has to deal with them.
function noControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const isAllowedWhitespace = c === 0x09 || c === 0x0a || c === 0x0d;
    if ((c < 0x20 && !isAllowedWhitespace) || c === 0x7f) return false;
  }
  return true;
}

const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "must not be empty")
    .max(max, `must be at most ${max} characters`)
    .refine(noControlChars, "must not contain control characters");

// --- /api/requests/classify ---
export const classifyInput = z.object({
  activity: cleanText(2_000),
  where: cleanText(500).optional(),
});
export type ClassifyInput = z.infer<typeof classifyInput>;

// --- /api/translate ---
export const translateInput = z.object({
  message_id: z.string().uuid("must be a UUID"),
  text: cleanText(2_000),
  target_language: z.enum(["ja", "en"]),
});
export type TranslateInput = z.infer<typeof translateInput>;

// --- /api/profile/assist ---
export const profileAssistInput = z.object({
  text: cleanText(1_000),
  mode: z.enum(["polish", "translate_en", "translate_ja"]),
});
export type ProfileAssistInput = z.infer<typeof profileAssistInput>;

// --- /api/moderation ---
export const moderationInput = z.object({
  text: cleanText(4_000),
  context: z.enum(["recruitment", "profile", "chat"]),
  // optional target so the route can persist the resulting level
  target: z
    .object({
      type: z.enum(["request", "message"]),
      id: z.string().uuid(),
    })
    .optional(),
});
export type ModerationInput = z.infer<typeof moderationInput>;

// --- /api/monster ---
const tag = z.string().trim().min(1).max(60).refine(noControlChars, "invalid tag");
export const monsterInput = z.object({
  user_id: z.string().uuid(),
  seed: z.object({
    skills: z.array(tag).max(20).default([]),
    interests: z.array(tag).max(20).default([]),
    note: cleanText(300).optional(),
  }),
  regenerate: z.boolean().optional().default(false),
});
export type MonsterInput = z.infer<typeof monsterInput>;

// --- /api/location/name (query params) ---
export const locationQuery = z.object({
  lat: z.coerce.number().gte(-90).lte(90),
  lng: z.coerce.number().gte(-180).lte(180),
});
export type LocationQuery = z.infer<typeof locationQuery>;
