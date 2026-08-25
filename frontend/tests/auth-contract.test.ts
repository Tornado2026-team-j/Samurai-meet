import { describe, expect, it } from 'bun:test';
import {
  buildPasskeyURL,
  encodeBase64URL,
  isAllowedAppReturnURI,
  parseAuthRedirect,
  parsePasskeyBridgeRequest,
  storedSession,
  type PreAuth,
  type Session,
} from '../services/auth-contract';

const session: Session = {
  user_id: 'user-1',
  session_id: 'session-1',
  access_token: 'access-token',
  refresh_token: 'refresh-token',
};

const preAuth: PreAuth = {
  user_id: 'user-1',
  pre_auth_token: 'pre-auth-token',
  passkey_required: true,
  passkey_registered: false,
};

describe('認証handoff契約', () => {
  it('認証redirectからOAuth handoff codeを取り出す', () => {
    expect(parseAuthRedirect('samuraimeet://auth?handoff_code=one-time-code')).toEqual({
      handoffCode: 'one-time-code',
    });
  });

  it('session handoff codeと不正URLを扱う', () => {
    expect(parseAuthRedirect('exp://127.0.0.1:8081/--/auth?session_handoff_code=session-code')).toEqual({
      sessionHandoffCode: 'session-code',
    });
    expect(parseAuthRedirect('not a url')).toEqual({});
  });

  it('Web OAuth callbackは許可した同一originの固定pathだけを扱う', () => {
    expect(parseAuthRedirect(
      'https://app.example/auth/complete?handoff_code=web-code',
      'https://app.example',
    )).toEqual({ handoffCode: 'web-code' });
    expect(parseAuthRedirect(
      'https://evil.example/auth/complete?handoff_code=stolen',
      'https://app.example',
    )).toEqual({});
    expect(parseAuthRedirect(
      'https://app.example/auth?handoff_code=wrong-path',
      'https://app.example',
    )).toEqual({});
  });

  it('Secure Storageに保存するsessionからaccess tokenを除く', () => {
    expect(storedSession(session)).toEqual({
      user_id: 'user-1',
      session_id: 'session-1',
      refresh_token: 'refresh-token',
    });
  });

  it('Passkey登録用fragmentにpre-auth tokenだけを渡す', () => {
    const parsed = new URL(buildPasskeyURL('samuraimeet://auth', 'challenge', preAuth, null));
    expect(parsed.searchParams.get('app_return_uri')).toBe('samuraimeet://auth');
    expect(parsed.searchParams.get('app_handoff_challenge')).toBe('challenge');
    expect(new URLSearchParams(parsed.hash.slice(1)).get('pre_auth_token')).toBe('pre-auth-token');
    expect(new URLSearchParams(parsed.hash.slice(1)).get('pre_auth_registered')).toBe('false');
  });

  it('再認証用fragmentにaccess tokenを渡す', () => {
    const parsed = new URL(buildPasskeyURL('samuraimeet://auth', 'challenge', null, session));
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    expect(fragment.get('reauth')).toBe('true');
    expect(fragment.get('session_access_token')).toBe('access-token');
    expect(fragment.get('session_id')).toBe('session-1');
  });

  it('アプリ復帰URIをバックエンドの許可条件で検証する', () => {
    expect(isAllowedAppReturnURI('samuraimeet://auth')).toBe(true);
    expect(isAllowedAppReturnURI('exp://127.0.0.1:8081/--/auth')).toBe(true);
    expect(isAllowedAppReturnURI('https://evil.example/auth')).toBe(false);
    expect(isAllowedAppReturnURI('samuraimeet://auth#token')).toBe(false);
  });

  it('Passkey bridgeのqueryとfragmentを構造化して検証する', () => {
    const parsed = parsePasskeyBridgeRequest(buildPasskeyURL(
      'samuraimeet://auth',
      'handoff-challenge',
      preAuth,
      null,
    ));
    expect(parsed).toEqual({
      appReturnURI: 'samuraimeet://auth',
      handoffChallenge: 'handoff-challenge',
      preAuth,
      session: null,
    });
  });

  it('Base64をURL-safe形式に変換する', () => {
    expect(encodeBase64URL('+/==')).toBe('-_');
  });
});
