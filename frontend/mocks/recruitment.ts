import type {
  RecruitmentDraft,
  RecruitmentPreview,
} from "../types/recruitment";
import type { MatchCategory } from "../types/match";
import { calculateFinishTime } from "../utils/time";

const JST_TIME_ZONE = "Asia/Tokyo";

const CATEGORY_RULES: ReadonlyArray<{
  pattern: RegExp;
  category: MatchCategory;
}> = [
  {
    pattern: /food|eat|restaurant|dinner|lunch|takoyaki|sushi|ramen/i,
    category: "Food",
  },
  {
    pattern:
      /place|heritage|historic|temple|shrine|castle|traditional|culture|museum|gallery|art/i,
    category: "Places",
  },
  {
    pattern: /activity|sport|hike|hiking|walk|cycling|outdoor/i,
    category: "Activity",
  },
];

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

function extractMockTags(activity: string): string[] {
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

function classifyMockActivity(activity: string): MatchCategory {
  return (
    CATEGORY_RULES.find(({ pattern }) => pattern.test(activity))?.category ??
    "Other"
  );
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

export function buildMockRecruitmentPreview(
  draft: RecruitmentDraft,
): RecruitmentPreview {
  return {
    previewId: "mock-recruitment-preview",
    category: classifyMockActivity(draft.activity),
    tags: extractMockTags(draft.activity),
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
