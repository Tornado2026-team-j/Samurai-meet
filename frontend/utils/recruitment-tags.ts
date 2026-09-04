import type { AppLanguage } from "../services/onboarding";

const TAG_LABELS_JA: Readonly<Record<string, string>> = {
  activity: "アクティビティ",
  anime: "アニメ",
  arcade: "ゲームセンター",
  beach: "海辺",
  castle: "城",
  convenience: "便利情報",
  culture: "文化",
  cycling: "サイクリング",
  dinner: "夕食",
  dotonbori: "道頓堀",
  experience: "体験",
  food: "食事",
  games: "ゲーム",
  gifts: "お土産",
  hiking: "ハイキング",
  history: "歴史",
  local: "地域",
  market: "市場",
  museum: "美術館",
  night: "夜",
  "night view": "夜景",
  nightlife: "夜遊び",
  onsen: "温泉",
  other: "その他",
  photo: "写真",
  places: "観光地",
  ramen: "ラーメン",
  river: "川",
  seafood: "海鮮",
  shopping: "買い物",
  shrine: "神社",
  snacks: "軽食",
  souvenir: "お土産",
  takoyaki: "たこ焼き",
  temple: "寺",
  tips: "コツ",
  walking: "散歩",
  walk: "散歩",
  yatai: "屋台",
};

export function translateRecruitmentTag(
  tag: string,
  language: AppLanguage,
): string {
  if (language === "en") return tag;
  return TAG_LABELS_JA[tag.trim().toLocaleLowerCase()] ?? tag;
}
