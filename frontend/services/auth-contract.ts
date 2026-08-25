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
};

export type StoredSession = Pick<Session, 'user_id' | 'session_id' | 'refresh_token'>;

export type AuthRedirect = { handoffCode?: string; sessionHandoffCode?: string };

export type PasskeyBridgeRequest = {
  appReturnURI: string;
  handoffChallenge: string;
  preAuth: PreAuth | null;
  session: Pick<Session, 'user_id' | 'session_id' | 'access_token'> | null;
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
    && typeof candidate.passkey_registered === 'boolean';
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
    return value.hostname.length > 0
      && value.pathname.endsWith('/--/auth')
      && value.username === ''
      && value.password === ''
      && value.hash === '';
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
  if (!isAllowedRedirect(parsed, allowedWebOrigin)) return {};
  const handoffCode = parsed.searchParams.get('handoff_code') ?? undefined;
  const sessionHandoffCode = parsed.searchParams.get('session_handoff_code') ?? undefined;
  return { handoffCode, sessionHandoffCode };
}

export function isAllowedAppReturnURI(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.hash) return false;
  if (value === 'samuraimeet://auth' || value === 'samuraimeettest://auth') return true;
  return parsed.protocol === 'exp:'
    && parsed.hostname.length > 0
    && parsed.pathname.endsWith('/--/auth');
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
  preAuth: PreAuth | null,
  session: Session | null,
  baseURL = 'https://samurai-meet.disnana.com/passkey',
): string {
  const target = new URL(baseURL);
  target.searchParams.set('app_return_uri', redirectURI);
  target.searchParams.set('app_handoff_challenge', challenge);
  const fragment = new URLSearchParams();
  if (preAuth) {
    fragment.set('pre_auth_token', preAuth.pre_auth_token);
    fragment.set('pre_auth_user_id', preAuth.user_id);
    fragment.set('pre_auth_registered', String(preAuth.passkey_registered));
  } else if (session) {
    fragment.set('reauth', 'true');
    fragment.set('session_access_token', session.access_token);
    fragment.set('session_user_id', session.user_id);
    fragment.set('session_id', session.session_id);
  }
  target.hash = fragment.toString();
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
  if (!isAllowedAppReturnURI(appReturnURI) || handoffChallenge.trim() === '') return null;

  const fragment = new URLSearchParams(parsed.hash.slice(1));
  const preAuthToken = fragment.get('pre_auth_token');
  const preAuthUserID = fragment.get('pre_auth_user_id');
  const preAuthRegistered = fragment.get('pre_auth_registered');
  if (preAuthToken && preAuthUserID && (preAuthRegistered === 'true' || preAuthRegistered === 'false')) {
    return {
      appReturnURI,
      handoffChallenge,
      preAuth: {
        user_id: preAuthUserID,
        pre_auth_token: preAuthToken,
        passkey_required: true,
        passkey_registered: preAuthRegistered === 'true',
      },
      session: null,
    };
  }

  const sessionAccessToken = fragment.get('session_access_token');
  const sessionUserID = fragment.get('session_user_id');
  const sessionID = fragment.get('session_id');
  if (fragment.get('reauth') === 'true' && sessionAccessToken && sessionUserID && sessionID) {
    return {
      appReturnURI,
      handoffChallenge,
      preAuth: null,
      session: {
        user_id: sessionUserID,
        session_id: sessionID,
        access_token: sessionAccessToken,
      },
    };
  }
  return null;
}
