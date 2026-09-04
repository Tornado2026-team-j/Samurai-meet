import type { AppLanguage } from "../services/onboarding";

const LOCATION_LABELS: Readonly<Record<string, { en: string; ja: string }>> = {
  "dotonbori": { en: "Dotonbori", ja: "道頓堀" },
  "fushimi inari": { en: "Fushimi Inari", ja: "伏見稲荷" },
  "shinjuku": { en: "Shinjuku", ja: "新宿" },
  "nara park": { en: "Nara Park", ja: "奈良公園" },
  "omicho market": { en: "Omicho Market", ja: "近江町市場" },
  "hakone yumoto": { en: "Hakone Yumoto", ja: "箱根湯本" },
  "peace memorial park": { en: "Peace Memorial Park", ja: "平和記念公園" },
  "sapporo station": { en: "Sapporo Station", ja: "札幌駅" },
  "nakasu": { en: "Nakasu", ja: "中洲" },
  "kobe harborland": { en: "Kobe Harborland", ja: "神戸ハーバーランド" },
  "naminoue beach": { en: "Naminoue Beach", ja: "波の上ビーチ" },
  "osu shopping district": { en: "Osu Shopping District", ja: "大須商店街" },
  "yokohama chinatown": { en: "Yokohama Chinatown", ja: "横浜中華街" },
  "matsumoto castle": { en: "Matsumoto Castle", ja: "松本城" },
  "kamakura": { en: "Kamakura", ja: "鎌倉" },
  "tokyo station": { en: "Tokyo Station", ja: "東京駅" },
  "osaka": { en: "Osaka", ja: "大阪" },
  "kyoto": { en: "Kyoto", ja: "京都" },
  "tokyo": { en: "Tokyo", ja: "東京" },
  "nara": { en: "Nara", ja: "奈良" },
  "kanazawa": { en: "Kanazawa", ja: "金沢" },
  "kanagawa": { en: "Kanagawa", ja: "神奈川" },
  "hiroshima": { en: "Hiroshima", ja: "広島" },
  "hokkaido": { en: "Hokkaido", ja: "北海道" },
  "fukuoka": { en: "Fukuoka", ja: "福岡" },
  "hyogo": { en: "Hyogo", ja: "兵庫" },
  "okinawa": { en: "Okinawa", ja: "沖縄" },
  "nagoya": { en: "Nagoya", ja: "名古屋" },
  "yokohama": { en: "Yokohama", ja: "横浜" },
  "nagano": { en: "Nagano", ja: "長野" },
};

const LOCATION_LOOKUP = new Map<string, { en: string; ja: string }>();

for (const label of Object.values(LOCATION_LABELS)) {
  LOCATION_LOOKUP.set(label.en.toLocaleLowerCase(), label);
  LOCATION_LOOKUP.set(label.ja.toLocaleLowerCase(), label);
}

function translateLocationPart(part: string, language: AppLanguage): string {
  const trimmed = part.trim();
  if (!trimmed) return "";
  const label = LOCATION_LOOKUP.get(trimmed.toLocaleLowerCase());
  return label ? label[language] : trimmed;
}

export function translateLocationLabel(
  locationName: string,
  language: AppLanguage,
): string {
  const separator = language === "ja" ? "、" : ", ";
  const parts = locationName
    .split(/[,、]/u)
    .map((part) => translateLocationPart(part, language))
    .filter(Boolean);

  return parts.length > 0 ? parts.join(separator) : locationName.trim();
}
