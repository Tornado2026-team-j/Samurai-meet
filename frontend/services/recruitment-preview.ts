import type {
  RecruitmentDraft,
  RecruitmentPreview,
} from "../types/recruitment";
import { isMatchCategory, type MatchCategory } from "../types/match";

const JST_TIME_ZONE = "Asia/Tokyo";
const JST_OFFSET_MINUTES = 9 * 60;
const RECRUITMENT_LEAD_TIME_MS = 24 * 60 * 60 * 1000;
export const MANUAL_RECRUITMENT_PREVIEW_ID = "manual-recruitment-preview";

const TAG_RULES: ReadonlyArray<{ pattern: RegExp; tag: string }> = [
  { pattern: /takoyaki/i, tag: "Takoyaki" },
  { pattern: /anime|manga/i, tag: "Anime" },
  { pattern: /temple|shrine|culture|traditional/i, tag: "Culture" },
  { pattern: /museum|gallery|art/i, tag: "Museum" },
  { pattern: /local|hidden|neighborhood/i, tag: "Local" },
  { pattern: /restaurant|food|eat|dinner|lunch/i, tag: "Food" },
  { pattern: /shopping|shop|souvenir/i, tag: "Shopping" },
  { pattern: /walk|walking|stroll/i, tag: "Walking" },
  { pattern: /bar|nightlife|drink/i, tag: "Nightlife" },
];

function extractPreviewTags(activity: string): string[] {
  const matches = TAG_RULES.filter(({ pattern }) => pattern.test(activity)).map(
    ({ tag }) => tag,
  );
  const tags = [...new Set(matches)];

  if (!tags.includes("Local")) {
    tags.push("Local");
  }
  if (tags.length < 2) {
    tags.push("Experience");
  }

  return tags.slice(0, 2);
}

function formatExpiry(draft: RecruitmentDraft): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.date.trim());
  const timeMatch = /^(\d{2}):([0-5]\d)$/.exec(draft.startTime.trim());
  if (!match || !timeMatch) return "24 hours before the start time";

  const hour = Number(timeMatch[1]);
  if (hour > 23) return "24 hours before the start time";

  const startAt = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      hour,
      Number(timeMatch[2]),
    ) -
      JST_OFFSET_MINUTES * 60 * 1000,
  );
  const deadline = new Date(startAt.getTime() - RECRUITMENT_LEAD_TIME_MS);
  if (Number.isNaN(deadline.getTime())) return "24 hours before the start time";

  const date = deadline.toLocaleDateString("en-US", {
    timeZone: JST_TIME_ZONE,
    month: "long",
    day: "numeric",
  });
  const time = deadline.toLocaleTimeString("en-US", {
    timeZone: JST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parsedDate = new Date(0);
  parsedDate.setUTCFullYear(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (
    parsedDate.getUTCFullYear() !== Number(match[1]) ||
    parsedDate.getUTCMonth() !== Number(match[2]) - 1 ||
    parsedDate.getUTCDate() !== Number(match[3])
  ) {
    return "24 hours before the start time";
  }

  return `${date} at ${time}`;
}

/**
 * Builds the local preview model after the classification response is received.
 * This is a pure transformation; it must not live under the mocks directory.
 */
export function buildRecruitmentPreviewModel(
  draft: RecruitmentDraft,
  category: MatchCategory,
): RecruitmentPreview {
  return {
    previewId: "mock-recruitment-preview",
    category,
    tags: extractPreviewTags(draft.activity),
    expiresAt: formatExpiry(draft),
    author: {
      id: "mock-current-user",
      displayName: "James Brown",
      avatarUrl: null,
      countryCode: "US",
    },
    conditions: draft,
  };
}

/**
 * Builds a preview after the user explicitly chooses a category and enters
 * keywords because Gemini is temporarily unavailable. No classification or
 * keyword is inferred on this path.
 */
export function buildManualRecruitmentPreviewModel(
  draft: RecruitmentDraft,
  category: MatchCategory,
  keywords: string[],
): RecruitmentPreview {
  if (!isMatchCategory(category)) {
    throw new Error("invalid_recruitment_category");
  }
  if (
    keywords.length === 0 ||
    keywords.length > 5 ||
    keywords.some(
      (keyword) =>
        typeof keyword !== "string" ||
        keyword.trim().length === 0 ||
        [...keyword].length > 80,
    )
  ) {
    throw new Error("recruitment_keywords_required");
  }

  const normalizedKeywords = keywords.map((keyword) => keyword.trim());
  const uniqueKeywords = new Set(
    normalizedKeywords.map((keyword) => keyword.toLocaleLowerCase()),
  );
  if (uniqueKeywords.size !== normalizedKeywords.length) {
    throw new Error("recruitment_keyword_invalid");
  }

  return {
    previewId: MANUAL_RECRUITMENT_PREVIEW_ID,
    category,
    tags: normalizedKeywords,
    expiresAt: formatExpiry(draft),
    author: {
      id: "mock-current-user",
      displayName: "James Brown",
      avatarUrl: null,
      countryCode: "US",
    },
    conditions: draft,
  };
}

export function isManualRecruitmentPreview(
  preview: RecruitmentPreview,
): boolean {
  return preview.previewId === MANUAL_RECRUITMENT_PREVIEW_ID;
}
