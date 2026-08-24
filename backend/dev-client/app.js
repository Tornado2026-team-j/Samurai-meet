const apiURL = document.querySelector('#api-url');
const result = document.querySelector('#result');
const accessToken = document.querySelector('#access-token');
const sessionKey = 'samurai_dev_session';
const preAuthKey = 'samurai_dev_pre_auth';
const verifierKey = 'samurai_dev_oauth_handoff_verifier';
const pendingAppHandoffKey = 'samurai_dev_pending_app_handoff';
const reauthKey = 'samurai_dev_reauth_only';

// 公開ドメインとローカル開発サーバーでは、同一オリジンのプロキシを優先する。
if (window.location.hostname === 'samurai-meet.disnana.com' || window.location.port === '5173') {
  apiURL.value = `${window.location.origin}/api/v1`;
}

let session = readSession();
let preAuth = readPreAuth();
let reauthOnly = sessionStorage.getItem(reauthKey) === 'true';
captureAppHandoffRequest();
if (session) accessToken.value = session.access_token;
else if (preAuth) accessToken.value = preAuth.pre_auth_token;
const hasWebAuthn = window.isSecureContext && 'PublicKeyCredential' in window && !!navigator.credentials;
document.querySelector('#passkey-support').textContent = hasWebAuthn
  ? 'このブラウザはWebAuthnを利用できます。'
  : 'このブラウザではWebAuthnを利用できません。HTTPSまたはlocalhostで開いてください。';

function apiBase() {
  const value = apiURL.value.trim();
  let parsed;
  try { parsed = new URL(value, window.location.origin); } catch { throw new Error('API URLが不正です'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('API URLはHTTP(S)のみ許可されています');
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
}

function readSession() {
  try {
    const value = sessionStorage.getItem(sessionKey);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function readPreAuth() {
  try {
    const value = sessionStorage.getItem(preAuthKey);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function captureAppHandoffRequest() {
  const params = new URLSearchParams(window.location.search);
  const appReturnURI = params.get('app_return_uri');
  const challenge = params.get('app_handoff_challenge');
  if (appReturnURI && challenge) {
    sessionStorage.setItem(pendingAppHandoffKey, JSON.stringify({ app_return_uri: appReturnURI, handoff_challenge: challenge }));
  }
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = fragment.get('pre_auth_token');
  const userID = fragment.get('pre_auth_user_id');
  if (token && userID) {
    setPreAuth({ user_id: userID, pre_auth_token: token, passkey_required: true, passkey_registered: fragment.get('pre_auth_registered') === 'true' });
  }
  const sessionAccessToken = fragment.get('session_access_token');
  const sessionID = fragment.get('session_id');
  const sessionUserID = fragment.get('session_user_id');
  if (sessionAccessToken && sessionID && sessionUserID && fragment.get('reauth') === 'true') {
    setSession({ user_id: sessionUserID, session_id: sessionID, access_token: sessionAccessToken, refresh_token: '' }, true);
  }
  if (window.location.search || window.location.hash) history.replaceState(null, '', '/');
}

function setSession(value, preserveReauth = false) {
  session = value;
  if (value) {
    sessionStorage.setItem(sessionKey, JSON.stringify(value));
    sessionStorage.removeItem(preAuthKey);
    preAuth = null;
    accessToken.value = value.access_token;
    reauthOnly = preserveReauth;
    if (reauthOnly) sessionStorage.setItem(reauthKey, 'true');
    else sessionStorage.removeItem(reauthKey);
  } else {
    sessionStorage.removeItem(sessionKey);
    sessionStorage.removeItem(reauthKey);
    reauthOnly = false;
    accessToken.value = '';
  }
}

function setPreAuth(value) {
  preAuth = value;
  if (value) {
    sessionStorage.setItem(preAuthKey, JSON.stringify(value));
    accessToken.value = value.pre_auth_token;
  } else {
    sessionStorage.removeItem(preAuthKey);
    sessionStorage.removeItem(reauthKey);
    reauthOnly = false;
    if (!session) accessToken.value = '';
  }
}

function authToken() {
  return session?.access_token || preAuth?.pre_auth_token || accessToken.value.trim();
}

function allowedAppReturnURI(value) {
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.username || parsed.password || parsed.fragment) return null;
  if (value === 'samuraimeet://auth' || value === 'samuraimeettest://auth') return parsed;
  if (parsed.protocol === 'exp:' && parsed.hostname && parsed.pathname.endsWith('/--/auth')) return parsed;
  return null;
}

function safeSession(value) {
  return value ? { user_id: value.user_id, session_id: value.session_id, access_token_present: !!value.access_token, refresh_token_present: !!value.refresh_token } : null;
}

function show(value) {
  result.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function completeAppHandoff() {
  const value = sessionStorage.getItem(pendingAppHandoffKey);
  if (!session || !value) return;
  let pending;
  try { pending = JSON.parse(value); } catch { return; }
  const response = await request('/auth/session-handoff/start', {
    method: 'POST',
    token: session.access_token,
    body: JSON.stringify({ app_redirect_uri: pending.app_return_uri, handoff_challenge: pending.handoff_challenge }),
  });
  const code = response?.data?.handoff_code;
  if (!code) throw new Error('アプリ復帰コードがありません');
  sessionStorage.removeItem(pendingAppHandoffKey);
  const appReturnURI = allowedAppReturnURI(pending.app_return_uri);
  if (!appReturnURI) throw new Error('アプリ復帰URIが許可されていません');
  appReturnURI.searchParams.set('session_handoff_code', code);
  window.location.assign(appReturnURI.toString());
}

if (!reauthOnly) void completeAppHandoff().catch((error) => show(`アプリ復帰準備失敗: ${error.message}`));

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiBase()}${path}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status}: ${body?.error || 'request failed'}`);
  return body;
}

function randomBase64URL(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return encodeBase64URL(bytes);
}

function encodeBase64URL(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64URL(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Base64URL(value) {
  return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function normalizeCreationOptions(options) {
  return {
    ...options,
    challenge: decodeBase64URL(options.challenge),
    user: { ...options.user, id: decodeBase64URL(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((item) => ({ ...item, id: decodeBase64URL(item.id) })),
  };
}

function normalizeRequestOptions(options) {
  return {
    ...options,
    challenge: decodeBase64URL(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: decodeBase64URL(item.id) })),
  };
}

function credentialJSON(credential) {
  const response = credential.response;
  const body = {
    id: credential.id,
    type: credential.type,
    rawId: encodeBase64URL(credential.rawId),
    response: {
      clientDataJSON: encodeBase64URL(response.clientDataJSON),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
  if ('attestationObject' in response) {
    body.response.attestationObject = encodeBase64URL(response.attestationObject);
    if (response.getTransports) body.response.transports = response.getTransports();
  } else {
    body.response.authenticatorData = encodeBase64URL(response.authenticatorData);
    body.response.signature = encodeBase64URL(response.signature);
    body.response.userHandle = response.userHandle ? encodeBase64URL(response.userHandle) : null;
  }
  if (credential.authenticatorAttachment) body.authenticatorAttachment = credential.authenticatorAttachment;
  return body;
}

async function registerPasskey() {
  if (!hasWebAuthn) throw new Error('WebAuthnが利用できません');
  const token = authToken();
  if (!token) throw new Error('先にGoogleログインを実行してください');
  const payload = await request('/auth/passkey/register/options', { method: 'POST', token });
  const options = payload.data.options.publicKey;
  const credential = await navigator.credentials.create({ publicKey: normalizeCreationOptions(options) });
  if (!credential) throw new Error('Passkey登録がキャンセルされました');
  const response = await request('/auth/passkey/register/verify', {
    method: 'POST',
    token,
    headers: { 'X-Passkey-Ceremony-Token': payload.data.ceremony_token },
    body: JSON.stringify(credentialJSON(credential)),
  });
  if (response?.data?.access_token) {
    setSession(response.data);
    show({ status: 'registered', session: safeSession(response.data) });
    await completeAppHandoff();
  } else show({ status: 'registered' });
}

async function loginPasskey() {
  if (!hasWebAuthn) throw new Error('WebAuthnが利用できません');
  const token = preAuth?.pre_auth_token;
  const payload = await request('/auth/passkey/login/options', { method: 'POST', token, body: JSON.stringify(preAuth ? { user_id: preAuth.user_id } : {}) });
  const options = payload.data.options.publicKey;
  const credential = await navigator.credentials.get({ publicKey: normalizeRequestOptions(options) });
  if (!credential) throw new Error('Passkeyログインがキャンセルされました');
  const response = await request('/auth/passkey/login/verify', {
    method: 'POST',
    token: preAuth ? token : undefined,
    headers: { 'X-Passkey-Ceremony-Token': payload.data.ceremony_token },
    body: JSON.stringify(credentialJSON(credential)),
  });
  setSession(response.data);
  show({ status: 'passkey_login_ok', session: safeSession(response.data) });
  await completeAppHandoff();
}

async function reauthPasskey() {
  if (!hasWebAuthn) throw new Error('WebAuthnが利用できません');
  if (!session?.access_token) throw new Error('再認証用のsessionがありません');
  const payload = await request('/auth/passkey/reauth/options', { method: 'POST', token: session.access_token });
  const options = payload.data.options.publicKey;
  const credential = await navigator.credentials.get({ publicKey: normalizeRequestOptions(options) });
  if (!credential) throw new Error('Passkey再認証がキャンセルされました');
  await request('/auth/passkey/reauth/verify', {
    method: 'POST',
    token: session.access_token,
    headers: { 'X-Passkey-Ceremony-Token': payload.data.ceremony_token },
    body: JSON.stringify(credentialJSON(credential)),
  });
  reauthOnly = false;
  sessionStorage.removeItem(reauthKey);
  show({ status: 'passkey_reauth_ok' });
  await completeAppHandoff();
}

async function startGoogleLogin() {
  const verifier = randomBase64URL(32);
  const challenge = await sha256Base64URL(verifier);
  sessionStorage.setItem(verifierKey, verifier);
  const redirect = `${window.location.origin}/auth/complete`;
  const query = new URLSearchParams({ app_redirect_uri: redirect, handoff_challenge: challenge });
  const target = new URL(`${apiBase()}/auth/google/start`);
  target.search = query.toString();
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('OAuth URLが不正です');
  window.location.assign(target.toString());
}

document.querySelectorAll('button[data-path]').forEach((button) => {
  button.addEventListener('click', async () => {
    const endpoint = `${apiBase()}${button.dataset.path}`;
    show(`リクエスト中: ${endpoint}`);
    try { show({ status: 200, body: await request(button.dataset.path) }); }
    catch (error) { show(`リクエストに失敗しました: ${error.message}`); }
  });
});

document.querySelector('#google-login').addEventListener('click', () => void startGoogleLogin().catch((error) => show(`ログイン開始に失敗しました: ${error.message}`)));
document.querySelector('#passkey-register').addEventListener('click', () => void registerPasskey().catch((error) => show(`Passkey登録失敗: ${error.message}`)));
document.querySelector('#passkey-login').addEventListener('click', () => void loginPasskey().catch((error) => show(`Passkeyログイン失敗: ${error.message}`)));
document.querySelector('#passkey-reauth').addEventListener('click', () => void reauthPasskey().catch((error) => show(`Passkey再認証失敗: ${error.message}`)));
document.querySelector('#passkey-list').addEventListener('click', async () => {
  try { show(await request('/auth/passkey', { token: session?.access_token })); }
  catch (error) { show(`一覧取得失敗: ${error.message}`); }
});
document.querySelector('#passkey-remove').addEventListener('click', async () => {
  const id = document.querySelector('#passkey-id').value.trim();
  if (!id) return show('Credential IDを入力してください');
  try { await request(`/auth/passkey/${encodeURIComponent(id)}`, { method: 'DELETE', token: session?.access_token }); show({ status: 'removed' }); }
  catch (error) { show(`解除失敗: ${error.message}`); }
});
document.querySelector('#session-refresh').addEventListener('click', async () => {
  if (!session?.refresh_token) return show('Refresh Tokenがありません。GoogleまたはPasskeyでログインしてください');
  try {
    const response = await request('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token, request_id: randomBase64URL(16) }) });
    setSession(response.data);
    show({ status: 'refreshed', session: safeSession(response.data) });
  } catch (error) { show(`更新失敗: ${error.message}`); }
});
document.querySelector('#session-logout').addEventListener('click', async () => {
  try { if (session?.access_token) await request('/auth/logout', { method: 'POST', token: session.access_token }); }
  catch (error) { show(`ログアウトAPI失敗: ${error.message}`); }
  finally { setSession(null); show({ status: 'logged_out' }); }
});
