import type {
  RecruitmentDraft,
  RecruitmentPreview,
} from "../types/recruitment";
import type { MatchCategory } from "../types/match";

const JST_TIME_ZONE = "Asia/Tokyo";
const JST_OFFSET_MINUTES = 9 * 60;
const RECRUITMENT_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

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

export function buildRecruitmentPreview(
	draft: RecruitmentDraft,
	category: MatchCategory,
): RecruitmentPreview {
	return {
		previewId: "mock-recruitment-preview",
		category,
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
