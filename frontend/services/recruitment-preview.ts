import type {
  RecruitmentDraft,
  RecruitmentPreview,
} from "../types/recruitment";
import type { MatchCategory } from "../types/match";
import { calculateFinishTime } from "../utils/time";

const JST_TIME_ZONE = "Asia/Tokyo";

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
  if (!match) {
    return "the event end time";
  }

  const parsedDate = new Date(0);
  parsedDate.setUTCHours(12, 0, 0, 0);
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
    return "the event end time";
  }

  const date = parsedDate.toLocaleDateString("en-US", {
    timeZone: JST_TIME_ZONE,
    month: "long",
    day: "numeric",
  });
  return `${date} at ${calculateFinishTime(draft.startTime, draft.durationHours)}`;
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
