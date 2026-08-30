import {
  defaultAPIBaseURL,
  isLocalWebOrigin,
  originFromAPIBaseURL,
  DEFAULT_WEB_APP_ORIGIN,
} from "./api-config.shared";

export {
  defaultAPIBaseURL,
  isLocalWebOrigin,
  originFromAPIBaseURL,
} from "./api-config.shared";

const configuredApiBaseURL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const configuredWebAppOrigin = process.env.EXPO_PUBLIC_WEB_APP_ORIGIN?.trim();
const runtimeLocation = typeof globalThis.location === "undefined" ? undefined : globalThis.location;

export const API_BASE_URL = (
  configuredApiBaseURL
    || defaultAPIBaseURL(runtimeLocation, process.env.NODE_ENV)
).replace(/\/+$/, "");

const derivedWebAppOrigin = originFromAPIBaseURL(API_BASE_URL) ?? DEFAULT_WEB_APP_ORIGIN;

export const WEB_APP_ORIGIN = (configuredWebAppOrigin || derivedWebAppOrigin).replace(/\/+$/, "");
export const WEB_PASSKEY_URL = `${WEB_APP_ORIGIN}/passkey`;
