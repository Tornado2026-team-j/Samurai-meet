import Constants from "expo-constants";
import {
  defaultAPIBaseURL,
  isLocalWebOrigin,
  localNativeAPIBaseURL,
  originFromAPIBaseURL,
  DEFAULT_WEB_APP_ORIGIN,
} from "./api-config.shared";

export {
  defaultAPIBaseURL,
  isLocalWebOrigin,
  localNativeAPIBaseURL,
  originFromAPIBaseURL,
} from "./api-config.shared";

const configuredApiBaseURL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const configuredWebAppOrigin = process.env.EXPO_PUBLIC_WEB_APP_ORIGIN?.trim();
const runtimeLocation = typeof globalThis.location === "undefined" ? undefined : globalThis.location;
const metroHostUri = Constants.expoConfig?.hostUri;

export const API_BASE_URL = (
  configuredApiBaseURL
    || defaultAPIBaseURL(runtimeLocation, process.env.NODE_ENV, metroHostUri)
).replace(/\/+$/, "");

/**
 * A local API and the Web Passkey page must use the same backend/database.
 * When only the API override is supplied, derive the page origin from it so a
 * development bootstrap cannot accidentally be sent to the production page.
 * An explicit Web origin remains authoritative for a separately hosted page.
 */
const derivedWebAppOrigin = originFromAPIBaseURL(API_BASE_URL) ?? DEFAULT_WEB_APP_ORIGIN;

export const WEB_APP_ORIGIN = (configuredWebAppOrigin || derivedWebAppOrigin).replace(/\/+$/, "");
export const WEB_PASSKEY_URL = `${WEB_APP_ORIGIN}/passkey`;
