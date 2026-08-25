const DEFAULT_API_BASE_URL = "https://samurai-meet.disnana.com/api/v1";
const DEFAULT_WEB_APP_ORIGIN = "https://samurai-meet.disnana.com";

const configuredApiBaseURL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const configuredWebAppOrigin = process.env.EXPO_PUBLIC_WEB_APP_ORIGIN?.trim();

export const API_BASE_URL = (configuredApiBaseURL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
export const WEB_APP_ORIGIN = (configuredWebAppOrigin || DEFAULT_WEB_APP_ORIGIN).replace(/\/+$/, "");
export const WEB_PASSKEY_URL = `${WEB_APP_ORIGIN}/passkey`;
