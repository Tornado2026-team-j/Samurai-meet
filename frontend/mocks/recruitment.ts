import type {
  RecruitmentDraft,
  RecruitmentPreview,
} from "../types/recruitment";
import type { MatchCategory } from "../types/match";

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

function formatExpiry(eventDate: string): string {
  const parsedDate = new Date(eventDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return "the day before the event";
  }

  parsedDate.setDate(parsedDate.getDate() - 1);
  return parsedDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

export function buildMockRecruitmentPreview(
  draft: RecruitmentDraft,
): RecruitmentPreview {
  return {
    previewId: "mock-recruitment-preview",
    category: classifyMockActivity(draft.activity),
    tags: extractMockTags(draft.activity),
    expiresAt: formatExpiry(draft.date),
    author: {
      id: "mock-current-user",
      displayName: "James Brown",
      avatarUrl: null,
      countryCode: "US",
    },
    conditions: draft,
  };
}
