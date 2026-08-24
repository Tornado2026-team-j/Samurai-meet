import { expect, test } from 'bun:test';
import { isPreAuth, isStoredSession } from '../services/auth-contract';

test('Secure Storageのsession shapeを検証する', () => {
  expect(isStoredSession({ user_id: 'u', session_id: 's', refresh_token: 'r' })).toBe(true);
  expect(isStoredSession({ user_id: 'u', session_id: 's' })).toBe(false);
  expect(isStoredSession(null)).toBe(false);
});

test('Secure Storageのpre-auth shapeを検証する', () => {
  expect(isPreAuth({
    user_id: 'u',
    pre_auth_token: 'p',
    passkey_required: true,
    passkey_registered: false,
  })).toBe(true);
  expect(isPreAuth({ user_id: 'u', pre_auth_token: 'p', passkey_required: 'true' })).toBe(false);
});
