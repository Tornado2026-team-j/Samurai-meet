import { describe, expect, it } from 'bun:test';
import {
  buildPasskeyURL,
  encodeBase64URL,
  isPasskeyBootstrap,
  parseAuthRedirect,
  storedSession,
  type Session,
} from '../services/auth-contract';

const session: Session = {
  user_id: 'user-1',
  session_id: 'session-1',
  access_token: 'access-token',
  refresh_token: 'refresh-token',
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

  it('Secure Storageに保存するsessionからaccess tokenを除く', () => {
    expect(storedSession(session)).toEqual({
      user_id: 'user-1',
      session_id: 'session-1',
      refresh_token: 'refresh-token',
    });
  });

  it('Passkey URLのfragmentにはbootstrap tokenだけを渡す', () => {
    const parsed = new URL(buildPasskeyURL('samuraimeet://auth', 'challenge', 'bootstrap-token'));
    expect(parsed.searchParams.get('app_return_uri')).toBe('samuraimeet://auth');
    expect(parsed.searchParams.get('app_handoff_challenge')).toBe('challenge');
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    expect([...fragment.keys()]).toEqual(['bootstrap_token']);
    expect(fragment.get('bootstrap_token')).toBe('bootstrap-token');
    expect(fragment.get('access_token')).toBeNull();
    expect(fragment.get('pre_auth_token')).toBeNull();
    expect(fragment.get('session_id')).toBeNull();
    expect(fragment.get('user_id')).toBeNull();
  });

  it('bootstrap responseのscopeとtoken形状を検証する', () => {
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

  it('Base64をURL-safe形式に変換する', () => {
    expect(encodeBase64URL('+/==')).toBe('-_');
  });
});
