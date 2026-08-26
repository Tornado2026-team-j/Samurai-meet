import type { GuideApplication } from "../types/application";

export const MOCK_GUIDE_APPLICATIONS: GuideApplication[] = [
  {
    id: "application-rina-kiyomizu",
    recruitmentId: "kiyomizu-tour",
    matchId: "match-rina-kiyomizu",
    applicantName: "Rina Tanaka",
    applicantCountry: "Japan",
    bio:
      "Hi, I am Rina. I live in Kyoto and love sharing quiet temples, local cafes, and small streets that travelers often miss. I can guide you at a relaxed pace and help with Japanese conversation along the way.",
    status: "pending",
  },
];

export function findMockGuideApplicationById(
  id: string | undefined,
): GuideApplication | undefined {
  return MOCK_GUIDE_APPLICATIONS.find((application) => application.id === id);
}
