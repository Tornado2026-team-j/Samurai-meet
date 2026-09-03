// Shared DTOs for the AI service HTTP contract. The AI owner implements the
// functions in lib/ai.ts and lib/geo.ts against these shapes; route handlers
// map them to JSON responses.

export const CATEGORIES = ["Food", "Places", "Activity", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

export type TargetLanguage = "ja" | "en";

export type ModerationLevel = "none" | "low" | "high";
export type ModerationContext = "recruitment" | "profile" | "chat";
export type ProfileAssistMode = "polish" | "translate_en" | "translate_ja";

// --- /api/requests/classify ---
export interface ClassifyResult {
  category: Category;
  keywords: string[]; // 2–3 recommended, max 5, each <= 40 chars
}

// --- /api/translate ---
export interface TranslateResult {
  sourceLanguage: string; // BCP-47-ish tag, e.g. "ja"
  translatedText: string;
}

// --- /api/profile/assist ---
export interface ProfileAssistResult {
  suggestion: string;
}

// --- /api/moderation ---
export interface ModerationResult {
  level: ModerationLevel;
  categories: string[];
}

// --- /api/monster ---
export interface MonsterSeed {
  skills: string[];
  interests: string[];
  note?: string;
}
export interface GeneratedImage {
  // Raw PNG bytes returned by the image model. The route uploads this to
  // Supabase Storage and persists only the resulting URL.
  png: Uint8Array;
}

// --- /api/location/name ---
export type LocationNameSource = "poi" | "station" | "neighborhood" | "ward";
export interface LocationName {
  displayName: string;
  source: LocationNameSource;
}

// --- error envelope ---
export interface ApiError {
  error: { code: string; message: string };
  degraded?: boolean;
}
