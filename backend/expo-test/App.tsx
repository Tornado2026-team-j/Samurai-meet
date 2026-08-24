import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  createKeyMaterial,
  recoverKeyA,
  toBase64URL,
  type KeyEnvelope,
  type KeyMaterial,
} from './crypto';

WebBrowser.maybeCompleteAuthSession();

const api = 'https://samurai-meet.disnana.com/api/v1';
const webPasskeyTestURL = 'https://samurai-meet.disnana.com/';
const verifierKey = 'oauth_handoff_verifier';
const sessionKey = 'session';
const refreshRequestKey = 'refresh_request_id';
const keyAStorageKey = 'key_a_v1';

type Session = {
  user_id: string;
  session_id: string;
  access_token: string;
  refresh_token: string;
};

type SessionResponse = { data?: Session };
type ApiList<T> = { data: T };
type StoredEnvelope = KeyEnvelope & { created_at?: string; updated_at?: string };

type SessionSummary = {
  id: string;
  device_name?: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  current: boolean;
};

type PasskeySummary = {
  credential_id: string;
  created_at: string;
  last_used_at?: string;
};

const base64URL = (value: string) => value.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${api}${path}`, { ...init, headers });
  const text = await response.text();
  let body: T | { error?: string } | null = null;
  try {
    body = text ? (JSON.parse(text) as T | { error?: string }) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
    throw new Error(`${response.status}: ${error ?? 'request failed'}`);
  }
  return body as T;
}

export default function App() {
  const [status, setStatus] = useState('ログイン待機中');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [credentialID, setCredentialID] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [envelopes, setEnvelopes] = useState<StoredEnvelope[]>([]);
  const [keyAStored, setKeyAStored] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [keyStatus, setKeyStatus] = useState('Key-A未確認');
  const keyMaterial = useRef<KeyMaterial | null>(null);

  const save = async (next: Session) => {
    await SecureStore.setItemAsync(sessionKey, JSON.stringify(next));
    setSession(next);
    setStatus(`セッション復元済み: ${next.user_id}`);
  };

  const refresh = async (current: Session, updateStatus = true) => {
    const requestID = (await SecureStore.getItemAsync(refreshRequestKey)) ?? Crypto.randomUUID();
    await SecureStore.setItemAsync(refreshRequestKey, requestID);
    if (updateStatus) setStatus('セッションを安全に更新しています…');
    const response = await request<SessionResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: current.refresh_token, request_id: requestID }),
    });
    if (!response.data) throw new Error('refresh response is empty');
    await SecureStore.deleteItemAsync(refreshRequestKey);
    await save(response.data);
    return response.data;
  };

  const complete = async (url: string) => {
    const parsed = Linking.parse(url);
    const code = typeof parsed.queryParams?.handoff_code === 'string' ? parsed.queryParams.handoff_code : null;
    const verifier = await SecureStore.getItemAsync(verifierKey);
    if (!code || !verifier) return;
    setStatus('セッションを復元しています…');
    try {
      const response = await request<SessionResponse>('/auth/google/exchange', {
        method: 'POST',
        body: JSON.stringify({ handoff_code: code, handoff_verifier: verifier }),
      });
      if (!response.data) throw new Error('exchange response is empty');
      await SecureStore.deleteItemAsync(verifierKey);
      await save(response.data);
    } catch {
      setStatus('セッション交換に失敗しました');
    }
  };

  useEffect(() => {
    void (async () => {
      const [storedSession, storedKeyA] = await Promise.all([
        SecureStore.getItemAsync(sessionKey),
        SecureStore.getItemAsync(keyAStorageKey),
      ]);
      if (storedKeyA) {
        setKeyAStored(true);
        setKeyStatus('Key-AはSecure Storageに保存済み');
      }
      if (storedSession) await save(JSON.parse(storedSession) as Session);
    })();
    void Linking.getInitialURL().then((url) => {
      if (url) void complete(url);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => void complete(url));
    return () => subscription.remove();
  }, []);

  const login = async () => {
    setBusy(true);
    try {
      const verifier = `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
      const challenge = base64URL(
        await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
          encoding: Crypto.CryptoEncoding.BASE64,
        }),
      );
      await SecureStore.setItemAsync(verifierKey, verifier);
      const redirect = Linking.createURL('auth');
      const start = `${api}/auth/google/start?app_redirect_uri=${encodeURIComponent(redirect)}&handoff_challenge=${encodeURIComponent(challenge)}`;
      setStatus('Googleへ移動しています…');
      const result = await WebBrowser.openAuthSessionAsync(start, redirect);
      if (result.type === 'success') await complete(result.url);
      else setStatus('ログインを中断しました。再度お試しください');
    } catch {
      setStatus('ログイン開始に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('APIの状態を確認しています…');
    try {
      await request('/readyz');
      if (session) await refresh(session);
      else setStatus('API接続済み。ログイン待機中');
    } catch {
      setStatus('更新失敗。API URLとトンネルを確認してください');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await request('/auth/logout', { method: 'POST' }, session.access_token);
    } finally {
      await SecureStore.deleteItemAsync(sessionKey);
      setSession(null);
      setBusy(false);
      setStatus('ログアウトしました');
    }
  };

  const runPanelAction = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '操作に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const listPasskeys = async () => {
    if (!session) throw new Error('先にログインしてください');
    const response = await request<ApiList<PasskeySummary[]>>('/auth/passkey', {}, session.access_token);
    setPasskeys(response.data);
    setStatus(`Passkey ${response.data.length}件を確認しました`);
  };

  const removePasskey = async (id: string) => {
    if (!session) throw new Error('先にログインしてください');
    const target = id.trim();
    if (!target) throw new Error('Credential IDを入力してください');
    await request(`/auth/passkey/${encodeURIComponent(target)}`, { method: 'DELETE' }, session.access_token);
    setCredentialID('');
    await listPasskeys();
    setStatus('Passkeyを解除しました');
  };

  const openWebPasskeyTest = async () => {
    setStatus('WebのPasskeyテストを開いています…');
    await WebBrowser.openBrowserAsync(webPasskeyTestURL);
  };

  const listSessions = async () => {
    if (!session) throw new Error('先にログインしてください');
    const response = await request<ApiList<SessionSummary[]>>('/me/sessions', {}, session.access_token);
    setSessions(response.data);
    setStatus(`ログインセッション ${response.data.length}件を確認しました`);
  };

  const revokeSession = async (id: string) => {
    if (!session) throw new Error('先にログインしてください');
    await request(`/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }, session.access_token);
    await listSessions();
    setStatus('指定セッションを失効しました');
  };

  const logoutAll = async () => {
    if (!session) throw new Error('先にログインしてください');
    await request('/auth/logout-all', { method: 'POST' }, session.access_token);
    await SecureStore.deleteItemAsync(sessionKey);
    setSession(null);
    setSessions([]);
    setStatus('全端末のセッションを失効しました');
  };

  const listEnvelopes = async () => {
    if (!session) throw new Error('先にログインしてください');
    const response = await request<ApiList<StoredEnvelope[]>>('/me/key-envelopes', {}, session.access_token);
    setEnvelopes(response.data);
    setStatus(`Key-A envelope ${response.data.length}件を確認しました`);
  };

  const generateAndSaveKey = async () => {
    if (!session) throw new Error('先にログインしてください');
    const material = await createKeyMaterial();
    await SecureStore.setItemAsync(keyAStorageKey, toBase64URL(material.keyA));
    keyMaterial.current = material;
    setRecoveryKey(material.recoveryKey);
    setKeyAStored(true);
    setKeyStatus('Key-Aを生成し、Secure Storageへ保存しました');
    await request<ApiList<StoredEnvelope>>(`/me/key-envelopes/${material.envelope.key_version}`, {
      method: 'PUT',
      body: JSON.stringify(material.envelope),
    }, session.access_token);
    await listEnvelopes();
    setStatus('Key-A生成・Recovery Key表示・envelope保存が完了しました');
  };

  const clearLocalKeyA = async () => {
    await SecureStore.deleteItemAsync(keyAStorageKey);
    keyMaterial.current = null;
    setKeyAStored(false);
    setKeyStatus('Key-AをSecure Storageから削除しました。Recovery Keyで復旧できます');
    setStatus('新端末を想定してローカルKey-Aだけを削除しました');
  };

  const recoverLocalKeyA = async () => {
    if (!session) throw new Error('先にログインしてください');
    if (!recoveryKey.trim()) throw new Error('Recovery Keyを入力してください');
    const response = await request<{ data: StoredEnvelope }>('/me/key-envelopes/v1', {}, session.access_token);
    const recovered = recoverKeyA(recoveryKey.trim(), response.data);
    await SecureStore.setItemAsync(keyAStorageKey, toBase64URL(recovered));
    setKeyAStored(true);
    setKeyStatus('Recovery KeyからKey-Aを端末上で復号し、Secure Storageへ保存しました');
    setStatus('Key-A復旧に成功しました');
  };

  const deleteEnvelope = async () => {
    if (!session) throw new Error('先にログインしてください');
    await request('/me/key-envelopes/v1', { method: 'DELETE' }, session.access_token);
    await listEnvelopes();
    setStatus('サーバー上のv1 envelopeを削除しました');
  };

  const deleteAccount = async () => {
    if (!session) throw new Error('先にログインしてください');
    await request('/me', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) }, session.access_token);
    await SecureStore.deleteItemAsync(sessionKey);
    await SecureStore.deleteItemAsync(keyAStorageKey);
    setSession(null);
    setSessions([]);
    setPasskeys([]);
    setEnvelopes([]);
    setKeyAStored(false);
    setRecoveryKey('');
    setStatus('退会とサーバー側データ削除が完了しました');
  };

  const confirmDeleteAccount = () => {
    Alert.alert('退会テスト', 'PostgreSQLのユーザー、session、Passkey、envelope、画像metadataと暗号文ファイルを削除します。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'DELETEして退会', style: 'destructive', onPress: () => void runPanelAction(deleteAccount) },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Samurai Meet</Text>
        <Text style={s.status}>{status}</Text>

        <View style={s.section}>
          <Text style={s.sectionTitle}>接続とログイン</Text>
          <Pressable style={[s.button, busy && s.disabled]} disabled={busy} onPress={() => void reload()}>
            <Text style={s.buttonText}>{busy ? '処理中…' : '状態を更新'}</Text>
          </Pressable>
          {session ? (
            <>
              <Text style={s.meta}>ユーザー: {session.user_id}</Text>
              <Text style={s.meta}>Session: {session.session_id}</Text>
              <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(() => refresh(session))}>
                <Text style={s.outlineText}>セッションを更新</Text>
              </Pressable>
              <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void logout()}>
                <Text style={s.outlineText}>ログアウト</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void login()}>
              <Text style={s.outlineText}>Googleでログイン</Text>
            </Pressable>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Passkey / WebAuthn</Text>
          <Text style={s.help}>Expo Goではnative Passkey APIを直接呼べないため、WebAuthnはドメインのWeb画面をアプリ内ブラウザで開いて確認します。登録済みcredentialの一覧・解除APIはこの画面から確認できます。</Text>
          <Pressable style={[s.button, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(openWebPasskeyTest)}>
            <Text style={s.buttonText}>WebでPasskeyをテスト</Text>
          </Pressable>
          <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(listPasskeys)}>
            <Text style={s.outlineText}>登録済みPasskeyを更新</Text>
          </Pressable>
          {passkeys.map((item) => (
            <View style={s.row} key={item.credential_id}>
              <Text style={s.rowText} numberOfLines={1}>{item.credential_id}</Text>
              <Pressable style={s.smallButton} disabled={busy} onPress={() => void runPanelAction(() => removePasskey(item.credential_id))}>
                <Text style={s.smallButtonText}>解除</Text>
              </Pressable>
            </View>
          ))}
          <TextInput style={s.input} value={credentialID} onChangeText={setCredentialID} placeholder="Credential IDを入力" autoCapitalize="none" />
          <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(() => removePasskey(credentialID.trim()))}>
            <Text style={s.outlineText}>入力したCredentialを解除</Text>
          </Pressable>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>端末Key-A / Recovery Key</Text>
          <Text style={s.help}>Recovery Keyはサーバーへ送らず、この画面にも永続保存しません。表示された値はテスト用に安全な場所へ控え、画面共有しないでください。</Text>
          <Text style={s.meta}>{keyStatus}</Text>
          <Text style={s.meta}>Secure Storage: {keyAStored ? '保存あり' : '保存なし'}</Text>
          <Pressable style={[s.button, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(generateAndSaveKey)}>
            <Text style={s.buttonText}>Key-A生成・envelope保存</Text>
          </Pressable>
          <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(clearLocalKeyA)}>
            <Text style={s.outlineText}>端末のKey-Aだけ削除（新端末テスト）</Text>
          </Pressable>
          <TextInput style={s.input} value={recoveryKey} onChangeText={setRecoveryKey} placeholder="Recovery Keyを入力" autoCapitalize="none" secureTextEntry={!recoveryKey} />
          {recoveryKey ? <Text selectable style={s.recovery}>{recoveryKey}</Text> : null}
          <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(recoverLocalKeyA)}>
            <Text style={s.outlineText}>Recovery Keyで端末Key-Aを復旧</Text>
          </Pressable>
          <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(listEnvelopes)}>
            <Text style={s.outlineText}>envelope一覧を更新</Text>
          </Pressable>
          {envelopes.map((item) => (
            <Text style={s.meta} key={item.key_version}>{item.key_version}: 暗号化Key-Aあり / 更新 {item.updated_at ?? '取得済み'}</Text>
          ))}
          <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(deleteEnvelope)}>
            <Text style={s.outlineText}>v1 envelopeを削除</Text>
          </Pressable>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>ログインセッション管理</Text>
          <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(listSessions)}>
            <Text style={s.outlineText}>セッション一覧を更新</Text>
          </Pressable>
          {sessions.map((item) => (
            <View style={s.row} key={item.id}>
              <View style={s.rowBody}>
                <Text style={s.rowText}>{item.current ? '現在のセッション' : '他のセッション'}: {item.id}</Text>
                <Text style={s.meta}>最終利用: {item.last_seen_at}</Text>
              </View>
              <Pressable style={s.smallButton} disabled={busy} onPress={() => void runPanelAction(() => revokeSession(item.id))}>
                <Text style={s.smallButtonText}>失効</Text>
              </Pressable>
            </View>
          ))}
          <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void runPanelAction(logoutAll)}>
            <Text style={s.outlineText}>全端末ログアウト</Text>
          </Pressable>
        </View>

        {session ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>退会・完全削除テスト</Text>
            <Text style={s.help}>確認文DELETEが必要です。実行後はこのアカウントのsession、Passkey、envelope、写真metadata、暗号文ファイルが削除されます。</Text>
            <Pressable style={[s.danger, busy && s.disabled]} disabled={busy} onPress={confirmDeleteAccount}>
              <Text style={s.buttonText}>DELETEして退会</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={s.endpoint}>接続先: {api}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 56, gap: 16 },
  title: { fontSize: 30, fontWeight: '700', color: '#111827' },
  status: { fontSize: 15, color: '#4b5563' },
  section: { gap: 10, padding: 16, borderRadius: 16, backgroundColor: '#f3f4f6' },
  sectionTitle: { fontSize: 19, fontWeight: '700', color: '#111827' },
  help: { fontSize: 13, lineHeight: 19, color: '#4b5563' },
  button: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#111827', paddingHorizontal: 14 },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#fff', textAlign: 'center' },
  outline: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#9ca3af', paddingHorizontal: 12 },
  outlineText: { fontSize: 15, fontWeight: '600', color: '#374151', textAlign: 'center' },
  danger: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#b91c1c', paddingHorizontal: 14 },
  disabled: { opacity: 0.5 },
  meta: { fontSize: 12, color: '#6b7280' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#fff', color: '#111827' },
  recovery: { fontSize: 13, color: '#991b1b', backgroundColor: '#fee2e2', padding: 10, borderRadius: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  rowBody: { flex: 1, gap: 2 },
  rowText: { flex: 1, fontSize: 12, color: '#374151' },
  smallButton: { minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#374151', paddingHorizontal: 10 },
  smallButtonText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  endpoint: { textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 },
});
