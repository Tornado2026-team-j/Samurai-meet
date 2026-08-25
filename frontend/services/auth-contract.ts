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

export type PasskeyBootstrap = {
  bootstrap_token: string;
  scope: 'passkey_register' | 'passkey_login' | 'passkey_reauth';
  expires_at: string;
};

export type StoredSession = Pick<Session, 'user_id' | 'session_id' | 'refresh_token'>;

export type AuthRedirect = { handoffCode?: string; sessionHandoffCode?: string };

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

function isAllowedRedirect(value: URL): boolean {
  const scheme = value.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'samuraimeet' || scheme === 'samuraimeettest') return value.hostname === 'auth';
  if (scheme === 'exp' || scheme === 'exps') return value.pathname.endsWith('/--/auth');
  return false;
}

export function parseAuthRedirect(value: string): AuthRedirect {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {};
  }
  if (!isAllowedRedirect(parsed)) return {};
  const handoffCode = parsed.searchParams.get('handoff_code') ?? undefined;
  const sessionHandoffCode = parsed.searchParams.get('session_handoff_code') ?? undefined;
  return { handoffCode, sessionHandoffCode };
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

export const WEB_PASSKEY_URL = 'https://samurai-meet.disnana.com/';

export function buildPasskeyURL(
  redirectURI: string,
  challenge: string,
  bootstrapToken: string,
): string {
  const query = new URLSearchParams({ app_return_uri: redirectURI, app_handoff_challenge: challenge });
  const fragment = new URLSearchParams({ bootstrap_token: bootstrapToken });
  return `${WEB_PASSKEY_URL}?${query.toString()}#${fragment.toString()}`;
}
