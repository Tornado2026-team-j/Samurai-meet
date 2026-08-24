import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

WebBrowser.maybeCompleteAuthSession();

const api = 'https://samurai-meet.disnana.com/api/v1';
const verifierKey = 'oauth_handoff_verifier';
const sessionKey = 'session';
const refreshRequestKey = 'refresh_request_id';

type Session = {
  user_id: string;
  session_id: string;
  access_token: string;
  refresh_token: string;
};

type SessionResponse = { data?: Session };

const base64URL = (value: string) => value.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export default function App() {
  const [status, setStatus] = useState('ログイン待機中');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (next: Session) => {
    await SecureStore.setItemAsync(sessionKey, JSON.stringify(next));
    setSession(next);
    setStatus(`セッション復元済み: ${next.user_id}`);
  };

  const refresh = async (current: Session) => {
    const requestID = (await SecureStore.getItemAsync(refreshRequestKey)) ?? Crypto.randomUUID();
    await SecureStore.setItemAsync(refreshRequestKey, requestID);
    setStatus('セッションを安全に更新しています…');
    try {
      const response = await fetch(`${api}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token, request_id: requestID }),
      });
      const payload = (await response.json()) as SessionResponse;
      if (!response.ok || !payload.data) throw new Error('refresh failed');
      await SecureStore.deleteItemAsync(refreshRequestKey);
      await save(payload.data);
    } catch {
      setStatus('更新失敗。再ログインしてください');
    }
  };

  const complete = async (url: string) => {
    const parsed = Linking.parse(url);
    const code = typeof parsed.queryParams?.handoff_code === 'string' ? parsed.queryParams.handoff_code : null;
    const verifier = await SecureStore.getItemAsync(verifierKey);
    if (!code || !verifier) return;
    setStatus('セッションを復元しています…');
    try {
      const response = await fetch(`${api}/auth/google/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoff_code: code, handoff_verifier: verifier }),
      });
      const payload = (await response.json()) as SessionResponse;
      if (!response.ok || !payload.data) throw new Error('exchange failed');
      await SecureStore.deleteItemAsync(verifierKey);
      await save(payload.data);
    } catch {
      setStatus('セッション交換に失敗しました');
    }
  };

  useEffect(() => {
    void SecureStore.getItemAsync(sessionKey).then((value) => {
      if (value) void save(JSON.parse(value) as Session);
    });
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
      const response = await fetch(`${api}/readyz`);
      if (!response.ok) throw new Error('readiness failed');
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
      await fetch(`${api}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
    } finally {
      await SecureStore.deleteItemAsync(sessionKey);
      setSession(null);
      setBusy(false);
      setStatus('ログアウトしました');
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.content}>
        <View>
          <Text style={s.title}>Samurai Meet</Text>
          <Text style={s.status}>{status}</Text>
        </View>
        <View style={s.actions}>
          <Pressable style={[s.button, busy && s.disabled]} disabled={busy} onPress={() => void reload()}>
            <Text style={s.buttonText}>{busy ? '更新中…' : '状態を更新'}</Text>
          </Pressable>
          {session ? (
            <>
              <Pressable style={[s.outline, busy && s.disabled]} disabled={busy} onPress={() => void refresh(session)}>
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
          <Text style={s.endpoint}>接続先: {api}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  content: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 40, paddingBottom: 36 },
  title: { fontSize: 30, fontWeight: '700', color: '#111827' },
  status: { marginTop: 8, fontSize: 16, color: '#4b5563' },
  actions: { gap: 12 },
  button: { minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#111827' },
  buttonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  outline: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#9ca3af' },
  outlineText: { fontSize: 16, fontWeight: '600', color: '#374151' },
  disabled: { opacity: 0.5 },
  endpoint: { textAlign: 'center', fontSize: 12, color: '#6b7280' },
});
