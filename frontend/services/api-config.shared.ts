const DEFAULT_API_BASE_URL = "https://samurai-meet.disnana.com/api/v1";
const DEFAULT_LOCAL_WEB_API_BASE_URL = "http://127.0.0.1:8080/api/v1";
const DEFAULT_WEB_APP_ORIGIN = "https://samurai-meet.disnana.com";
const LOCAL_API_PORT = 8080;

export function isLocalWebOrigin(value: { protocol?: string; hostname?: string } | null | undefined): boolean {
  return value?.protocol === "http:"
    && (value.hostname === "localhost" || value.hostname === "127.0.0.1");
}

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254);
}

function isPrivateDevelopmentHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || isPrivateIPv4(normalized)
    || /^(?:fc|fd)[0-9a-f]{2}:/u.test(normalized)
    || /^fe[89ab][0-9a-f]:/u.test(normalized);
}

/**
 * Expo CLI exposes the Metro host to native development clients. Reuse that
 * private host for the local Go API, but never infer a public or production
 * host. HTTPS tunnels and production endpoints remain explicit overrides.
 */
export function localNativeAPIBaseURL(hostUri: string | null | undefined): string | null {
  const value = hostUri?.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value.includes("://") ? value : `http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    if (!isPrivateDevelopmentHost(parsed.hostname)) return null;

    const hostname = parsed.hostname.includes(":") && !parsed.hostname.startsWith("[")
      ? `[${parsed.hostname}]`
      : parsed.hostname;
    return `http://${hostname}:${LOCAL_API_PORT}/api/v1`;
  } catch {
    return null;
  }
}

export function defaultAPIBaseURL(
  value: { protocol?: string; hostname?: string } | null | undefined,
  environment: string | undefined = undefined,
  nativeDevelopmentHostUri?: string | null,
): string {
  const isDevelopmentBuild = environment === "development" || environment === "test";
  if (!isDevelopmentBuild) return DEFAULT_API_BASE_URL;
  if (isLocalWebOrigin(value)) return DEFAULT_LOCAL_WEB_API_BASE_URL;
  return localNativeAPIBaseURL(nativeDevelopmentHostUri) ?? DEFAULT_API_BASE_URL;
}

export function originFromAPIBaseURL(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export { DEFAULT_API_BASE_URL, DEFAULT_LOCAL_WEB_API_BASE_URL, DEFAULT_WEB_APP_ORIGIN };
