import type { AppLanguage, AppMode } from "./onboarding-contract";

export type DeviceLocaleLike = {
  regionCode?: string | null;
};

function normalizeRegionCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function resolveDefaultNationalityCode(
  language: AppLanguage,
  supportedCountryCodes: readonly string[],
  locales: readonly DeviceLocaleLike[],
): string {
  const supported = new Set(
    supportedCountryCodes
      .map((code) => normalizeRegionCode(code))
      .filter((code): code is string => code !== null),
  );

  for (const locale of locales) {
    const regionCode = normalizeRegionCode(locale.regionCode);
    if (regionCode && supported.has(regionCode)) return regionCode;
  }

  const languageFallback = language === "ja" ? "JP" : "US";
  if (supported.has(languageFallback)) return languageFallback;
  return supportedCountryCodes[0] ?? "";
}

export function resolveDefaultAppMode(
  language: AppLanguage,
  locales: readonly DeviceLocaleLike[],
): AppMode {
  for (const locale of locales) {
    const regionCode = normalizeRegionCode(locale.regionCode);
    if (regionCode) return regionCode === "JP" ? "local" : "traveler";
  }

  return language === "ja" ? "local" : "traveler";
}
