import { expect, test } from 'bun:test';
import { parseAuthRedirect } from '../services/auth-contract';

test('認証handoffは許可済みアプリredirectだけを受け付ける', () => {
  expect(parseAuthRedirect('https://evil.example/auth?handoff_code=stolen')).toEqual({});
  expect(parseAuthRedirect('samuraimeet://evil.example?handoff_code=wrong')).toEqual({});
  expect(parseAuthRedirect('samuraimeet://auth?handoff_code=valid')).toEqual({ handoffCode: 'valid' });
});
