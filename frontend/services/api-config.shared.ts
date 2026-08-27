const DEFAULT_API_BASE_URL = "https://samurai-meet.disnana.com/api/v1";
const DEFAULT_LOCAL_WEB_API_BASE_URL = "http://127.0.0.1:8080/api/v1";
const DEFAULT_WEB_APP_ORIGIN = "https://samurai-meet.disnana.com";

export function isLocalWebOrigin(value: { protocol?: string; hostname?: string } | null | undefined): boolean {
  return value?.protocol === "http:"
    && (value.hostname === "localhost" || value.hostname === "127.0.0.1");
}

export function defaultAPIBaseURL(
  value: { protocol?: string; hostname?: string } | null | undefined,
  environment: string | undefined = undefined,
): string {
  const isDevelopmentBuild = environment === "development" || environment === "test";
  if (!isDevelopmentBuild) return DEFAULT_API_BASE_URL;
  if (isLocalWebOrigin(value)) return DEFAULT_LOCAL_WEB_API_BASE_URL;
  return DEFAULT_API_BASE_URL;
}

export function originFromAPIBaseURL(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export { DEFAULT_API_BASE_URL, DEFAULT_LOCAL_WEB_API_BASE_URL, DEFAULT_WEB_APP_ORIGIN };
