import { describe, expect, it } from 'bun:test';
import {
  buildPasskeyURL,
  encodeBase64URL,
  isAllowedAppReturnURI,
  isPasskeyBootstrap,
  isSession,
  parseAuthRedirect,
  parsePasskeyBridgeRequest,
  storedSession,
  type Session,
} from '../services/auth-contract';
import {
  defaultAPIBaseURL,
  isLocalWebOrigin,
  originFromAPIBaseURL,
} from '../services/api-config';

const session: Session = {
  user_id: 'user-1',
  session_id: 'session-1',
  access_token: 'access-token',
  refresh_token: 'refresh-token',
};

describe('認証handoff契約', () => {
  it('ローカルWebだけ開発APIを既定値にする', () => {
    expect(isLocalWebOrigin({ protocol: 'http:', hostname: 'localhost' })).toBe(true);
    expect(isLocalWebOrigin({ protocol: 'http:', hostname: '127.0.0.1' })).toBe(true);
    expect(isLocalWebOrigin({ protocol: 'https:', hostname: 'localhost' })).toBe(false);
    expect(isLocalWebOrigin({ protocol: 'http:', hostname: 'samurai-meet.disnana.com' })).toBe(false);
    expect(defaultAPIBaseURL({ protocol: 'http:', hostname: 'localhost' }, 'development')).toBe('http://127.0.0.1:8080/api/v1');
    expect(defaultAPIBaseURL({ protocol: 'http:', hostname: 'localhost' }, 'production')).toBe('https://samurai-meet.disnana.com/api/v1');
    expect(defaultAPIBaseURL({ protocol: 'https:', hostname: 'samurai-meet.disnana.com' }, 'development')).toBe('https://samurai-meet.disnana.com/api/v1');
  });

  it('ネイティブ開発時もAPIドメインを既定値にする', () => {
    expect(defaultAPIBaseURL(undefined, 'development')).toBe('https://samurai-meet.disnana.com/api/v1');
    expect(defaultAPIBaseURL(undefined, 'test')).toBe('https://samurai-meet.disnana.com/api/v1');
  });

  it('API上書きから同じWeb Passkey originを導出する', () => {
    expect(originFromAPIBaseURL('http://192.168.0.10:8080/api/v1')).toBe('http://192.168.0.10:8080');
    expect(originFromAPIBaseURL('https://samurai-meet.disnana.com/api/v1/')).toBe('https://samurai-meet.disnana.com');
    expect(originFromAPIBaseURL('not a url')).toBeNull();
  });

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

  it('sessionのruntime形状を検証する', () => {
    expect(isSession(session)).toBe(true);
    expect(isSession({ ...session, access_token: '' })).toBe(false);
  });

  it('Passkey bootstrap responseのscopeとtoken形状を検証する', () => {
    expect(isPasskeyBootstrap({
      bootstrap_token: 'bootstrap-token',
      scope: 'passkey_reauth',
      expires_at: '2026-08-24T12:00:00Z',
    })).toBe(true);
    expect(isPasskeyBootstrap({
      bootstrap_token: 'bootstrap-token',
      scope: 'invalid',
      expires_at: '2026-08-24T12:00:00Z',
    })).toBe(false);
  });

  it('Passkey URLのfragmentにはbootstrap tokenだけを渡す', () => {
    const parsed = new URL(buildPasskeyURL('samuraimeet://auth', 'challenge', 'bootstrap-token'));
    expect(parsed.searchParams.get('app_return_uri')).toBe('samuraimeet://auth');
    expect(parsed.searchParams.get('app_handoff_challenge')).toBe('challenge');
    expect(parsed.searchParams.get('lang')).toBe('ja');
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    expect([...fragment.keys()]).toEqual(['bootstrap_token']);
    expect(fragment.get('bootstrap_token')).toBe('bootstrap-token');
    expect(fragment.get('access_token')).toBeNull();
    expect(fragment.get('pre_auth_token')).toBeNull();
    expect(fragment.get('session_id')).toBeNull();
    expect(fragment.get('user_id')).toBeNull();

    const english = new URL(buildPasskeyURL(
      'samuraimeet://auth',
      'challenge',
      'bootstrap-token',
      undefined,
      'en',
    ));
    expect(english.searchParams.get('lang')).toBe('en');
  });

  it('アプリ復帰URIをバックエンドの許可条件で検証する', () => {
    expect(isAllowedAppReturnURI('samuraimeet://auth')).toBe(true);
    expect(isAllowedAppReturnURI('exp://127.0.0.1:8081/--/auth')).toBe(true);
    expect(isAllowedAppReturnURI('https://evil.example/auth')).toBe(false);
    expect(isAllowedAppReturnURI('samuraimeet://auth#token')).toBe(false);
  });

  it('Passkey bridgeはbootstrap tokenだけを構造化する', () => {
    const parsed = parsePasskeyBridgeRequest(buildPasskeyURL(
      'samuraimeet://auth',
      'handoff-challenge',
      'bootstrap-token',
    ));
    expect(parsed).toEqual({
      appReturnURI: 'samuraimeet://auth',
      handoffChallenge: 'handoff-challenge',
      bootstrapToken: 'bootstrap-token',
    });
    expect(parsePasskeyBridgeRequest(
      'https://samurai-meet.disnana.com/passkey?app_return_uri=samuraimeet%3A%2F%2Fauth&app_handoff_challenge=challenge#pre_auth_token=secret',
    )).toBeNull();
    expect(parsePasskeyBridgeRequest(
      'https://samurai-meet.disnana.com/passkey?app_return_uri=samuraimeet%3A%2F%2Fauth&app_handoff_challenge=challenge&lang=fr#bootstrap_token=secret',
    )).toBeNull();
  });

  it('Base64をURL-safe形式に変換する', () => {
    expect(encodeBase64URL('+/==')).toBe('-_');
  });
});
