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
  preAuth: PreAuth | null,
  session: Session | null,
): string {
  const query = new URLSearchParams({ app_return_uri: redirectURI, app_handoff_challenge: challenge });
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
  return `${WEB_PASSKEY_URL}?${query.toString()}#${fragment.toString()}`;
}
