import type { AppLanguage } from './onboarding-contract';

export type Session = {
  user_id: string;
  session_id: string;
  access_token: string;
  refresh_token: string;
};

export type PreAuth = {
  user_id: string;
  pre_auth_token: string;
  passkey_required: boolean;
  passkey_registered: boolean;
  /** Older backend responses may omit this field. */
  recovery_available?: boolean;
};

export type PasskeyBootstrap = {
  bootstrap_token: string;
  scope: 'passkey_register' | 'passkey_login' | 'passkey_reauth';
  expires_at: string;
};

export type StoredSession = Pick<Session, 'user_id' | 'session_id' | 'refresh_token'>;

export type AuthRedirect = { handoffCode?: string; sessionHandoffCode?: string };

/**
 * The WebAuthn page receives only an opaque, one-time bootstrap token.
 * User/session access tokens never cross the browser URL boundary.
 */
export type PasskeyBridgeRequest = {
  appReturnURI: string;
  handoffChallenge: string;
  bootstrapToken: string;
};

export function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredSession>;
  return typeof candidate.user_id === 'string'
    && candidate.user_id.length > 0
    && typeof candidate.session_id === 'string'
    && candidate.session_id.length > 0
    && typeof candidate.refresh_token === 'string'
    && candidate.refresh_token.length > 0;
}

export function isPreAuth(value: unknown): value is PreAuth {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PreAuth>;
  return typeof candidate.user_id === 'string'
    && candidate.user_id.length > 0
    && typeof candidate.pre_auth_token === 'string'
    && candidate.pre_auth_token.length > 0
    && typeof candidate.passkey_required === 'boolean'
    && typeof candidate.passkey_registered === 'boolean'
    && (!('recovery_available' in candidate) || typeof candidate.recovery_available === 'boolean');
}

export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Session>;
  return typeof candidate.user_id === 'string'
    && candidate.user_id.length > 0
    && typeof candidate.session_id === 'string'
    && candidate.session_id.length > 0
    && typeof candidate.access_token === 'string'
    && candidate.access_token.length > 0
    && typeof candidate.refresh_token === 'string'
    && candidate.refresh_token.length > 0;
}

export function isPasskeyBootstrap(value: unknown): value is PasskeyBootstrap {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PasskeyBootstrap>;
  return typeof candidate.bootstrap_token === 'string'
    && candidate.bootstrap_token.length > 0
    && (candidate.scope === 'passkey_register'
      || candidate.scope === 'passkey_login'
      || candidate.scope === 'passkey_reauth')
    && typeof candidate.expires_at === 'string'
    && candidate.expires_at.length > 0;
}

function parseExpoReturnURI(raw: string): URL | null {
  if (raw !== raw.trim() || /[\r\n]/u.test(raw) || !/^exp:\/\//iu.test(raw)) return null;
  const authorityAndPath = raw.slice(raw.indexOf('://') + 3);
  let parsed: URL;
  try {
    // WHATWG URL implementations may treat the non-special exp scheme as a
    // path instead of an authority. Parse the authority with a temporary
    // standard scheme while retaining the original exp URI for the redirect.
    parsed = new URL(`https://${authorityAndPath}`);
  } catch {
    return null;
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.hash) return null;
  return parsed;
}

function isAllowedRedirect(value: URL, allowedWebOrigin?: string): boolean {
  const scheme = value.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'samuraimeet' || scheme === 'samuraimeettest') {
    return value.hostname === 'auth'
      && value.pathname === ''
      && value.username === ''
      && value.password === ''
      && value.hash === '';
  }
  if (scheme === 'exp') {
    const normalized = parseExpoReturnURI(value.toString());
    return normalized !== null && normalized.pathname.endsWith('/--/auth');
  }
  if ((scheme === 'http' || scheme === 'https') && allowedWebOrigin) {
    let origin: URL;
    try {
      origin = new URL(allowedWebOrigin);
    } catch {
      return false;
    }
    return value.origin === origin.origin
      && value.pathname === '/auth/complete'
      && value.username === ''
      && value.password === ''
      && value.hash === '';
  }
  return false;
}

export function parseAuthRedirect(value: string, allowedWebOrigin?: string): AuthRedirect {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {};
  }
  const scheme = value.slice(0, value.indexOf(':')).toLowerCase();
  if (scheme === 'exp') {
    const normalized = parseExpoReturnURI(value);
    if (!normalized || !normalized.pathname.endsWith('/--/auth')) return {};
    parsed = normalized;
  } else if (!isAllowedRedirect(parsed, allowedWebOrigin)) {
    return {};
  }
  const handoffCode = parsed.searchParams.get('handoff_code') ?? undefined;
  const sessionHandoffCode = parsed.searchParams.get('session_handoff_code') ?? undefined;
  return { handoffCode, sessionHandoffCode };
}

export function isAllowedAppReturnURI(value: string): boolean {
  if (value === 'samuraimeet://auth' || value === 'samuraimeettest://auth') return true;
  const normalized = parseExpoReturnURI(value);
  return normalized !== null && normalized.pathname.endsWith('/--/auth');
}

export function storedSession(value: Session): StoredSession {
  return {
    user_id: value.user_id,
    session_id: value.session_id,
    refresh_token: value.refresh_token,
  };
}

export function encodeBase64URL(value: string): string {
  return value.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function buildPasskeyURL(
  redirectURI: string,
  challenge: string,
  bootstrapToken: string,
  baseURL = 'https://samurai-meet.disnana.com/passkey',
  language: AppLanguage = 'ja',
): string {
  const target = new URL(baseURL);
  target.searchParams.set('app_return_uri', redirectURI);
  target.searchParams.set('app_handoff_challenge', challenge);
  target.searchParams.set('lang', language);
  target.hash = new URLSearchParams({ bootstrap_token: bootstrapToken }).toString();
  return target.toString();
}

export function parsePasskeyBridgeRequest(value: string): PasskeyBridgeRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const appReturnURI = parsed.searchParams.get('app_return_uri') ?? '';
  const handoffChallenge = parsed.searchParams.get('app_handoff_challenge') ?? '';
  const language = parsed.searchParams.get('lang');
  if (!isAllowedAppReturnURI(appReturnURI) || handoffChallenge.trim() === '') return null;
  if (language !== null && language !== 'ja' && language !== 'en') return null;

  const fragment = new URLSearchParams(parsed.hash.slice(1));
  const bootstrapToken = fragment.get('bootstrap_token');
  const keys = [...fragment.keys()];
  if (!bootstrapToken || keys.length !== 1 || keys[0] !== 'bootstrap_token') return null;
  return { appReturnURI, handoffChallenge, bootstrapToken };
}
