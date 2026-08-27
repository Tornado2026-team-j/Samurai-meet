const DEFAULT_API_BASE_URL = "https://samurai-meet.disnana.com/api/v1";
const DEFAULT_LOCAL_WEB_API_BASE_URL = "http://127.0.0.1:8080/api/v1";
const DEFAULT_WEB_APP_ORIGIN = "https://samurai-meet.disnana.com";

const configuredApiBaseURL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const configuredWebAppOrigin = process.env.EXPO_PUBLIC_WEB_APP_ORIGIN?.trim();

export function isLocalWebOrigin(value: { protocol?: string; hostname?: string } | null | undefined): boolean {
  return value?.protocol === "http:"
    && (value.hostname === "localhost" || value.hostname === "127.0.0.1");
}

export function defaultAPIBaseURL(
  value: { protocol?: string; hostname?: string } | null | undefined,
  environment = process.env.NODE_ENV,
): string {
  const isDevelopmentBuild = environment === "development" || environment === "test";
  return isDevelopmentBuild && isLocalWebOrigin(value)
    ? DEFAULT_LOCAL_WEB_API_BASE_URL
    : DEFAULT_API_BASE_URL;
}

const runtimeLocation = typeof globalThis.location === "undefined" ? undefined : globalThis.location;
export const API_BASE_URL = (configuredApiBaseURL || defaultAPIBaseURL(runtimeLocation)).replace(/\/+$/, "");

/**
 * A local API and the Web Passkey page must use the same backend/database.
 * When only the API override is supplied, derive the page origin from it so a
 * development bootstrap cannot accidentally be sent to the production page.
 * An explicit Web origin remains authoritative for a separately hosted page.
 */
export function originFromAPIBaseURL(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const derivedWebAppOrigin = configuredApiBaseURL
  ? originFromAPIBaseURL(API_BASE_URL) ?? DEFAULT_WEB_APP_ORIGIN
  : DEFAULT_WEB_APP_ORIGIN;

export const WEB_APP_ORIGIN = (configuredWebAppOrigin || derivedWebAppOrigin).replace(/\/+$/, "");
export const WEB_PASSKEY_URL = `${WEB_APP_ORIGIN}/passkey`;
