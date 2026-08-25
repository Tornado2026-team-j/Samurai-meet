import type { MatchCardData } from "../types/match";

export const MOCK_MATCHES: MatchCardData[] = [
  {
    id: "takoyaki-local",
    category: "Food",
    authorName: "James Brown",
    countryFlag: "🇺🇸",
    countryName: "United States",
    rating: 5,
    date: "August,25 2026",
    detailDate: "Aug 25, 2026 (Tue)",
    startTime: "14:30",
    durationHours: 1,
    tags: ["FOOD", "Takoyaki", "Local"],
    detailTags: ["Takoyaki", "Local", "Food", "Osaka"],
    expiresAt: "2026/08/24",
    description:
      "大阪で地元のたこ焼き屋さんに行ってみたいです。\n観光客が普段あまり行かないような場所に\n行ってみたいです！",
  },
  {
    id: "shopping-local",
    category: "Other",
    authorName: "James Brown",
    countryFlag: "🇺🇸",
    countryName: "United States",
    rating: 5,
    date: "August,25 2026",
    detailDate: "Aug 25, 2026 (Tue)",
    startTime: "14:30",
    durationHours: 1,
    tags: ["Shopping", "Local"],
    detailTags: ["Shopping", "Local", "Osaka"],
    expiresAt: "2026/08/24",
    description:
      "大阪で地元の人がよく行くお店を巡りたいです。\n観光地だけではない買い物スポットを\n案内してほしいです！",
  },
  {
    id: "culture-local",
    category: "Places",
    authorName: "James Brown",
    countryFlag: "🇺🇸",
    countryName: "United States",
    rating: 5,
    date: "August,25 2026",
    detailDate: "Aug 25, 2026 (Tue)",
    startTime: "14:30",
    durationHours: 1,
    tags: ["Culture", "Local"],
    detailTags: ["Culture", "Local", "Osaka"],
    expiresAt: "2026/08/24",
    description:
      "大阪の文化や歴史を感じられる場所に行きたいです。\n地元の人だから知っている場所を\n案内してほしいです！",
  },
];

export function findMockMatchById(
  id: string | undefined,
): MatchCardData | undefined {
  return MOCK_MATCHES.find((match) => match.id === id);
}
