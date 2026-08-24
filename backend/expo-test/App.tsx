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

const base64URL = (value: string) => value.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export default function App() {
  const [status, setStatus] = useState('ログイン待機中');
  const complete = async (url: string) => {
    const code = new URL(url).searchParams.get('handoff_code');
    const verifier = await SecureStore.getItemAsync(verifierKey);
    if (!code || !verifier) return;
    setStatus('セッションを復元しています…');
    const response = await fetch(`${api}/auth/google/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handoff_code: code, handoff_verifier: verifier }) });
    const payload = await response.json();
    if (!response.ok) { setStatus('セッション交換に失敗しました'); return; }
    await SecureStore.setItemAsync('session', JSON.stringify(payload.data));
    await SecureStore.deleteItemAsync(verifierKey);
    setStatus(`ログイン成功: ${payload.data.user_id}`);
  };
  useEffect(() => { Linking.getInitialURL().then((url) => { if (url) void complete(url); }); return Linking.addEventListener('url', ({ url }) => { void complete(url); }).remove; }, []);
  const login = async () => {
    const verifier = `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
    const challenge = base64URL(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
    await SecureStore.setItemAsync(verifierKey, verifier);
    const redirect = Linking.createURL('auth');
    const start = `${api}/auth/google/start?app_redirect_uri=${encodeURIComponent(redirect)}&handoff_challenge=${encodeURIComponent(challenge)}`;
    setStatus('Googleへ移動しています…');
    const result = await WebBrowser.openAuthSessionAsync(start, redirect);
    if (result.type === 'success') await complete(result.url);
  };
  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}><View style={styles.content}><View><Text style={styles.title}>Samurai Meet</Text><Text style={styles.description}>{status}</Text></View><View style={styles.actions}><Pressable accessibilityRole="button" style={({ pressed }) => [styles.loginButton, pressed && styles.loginButtonPressed]} onPress={() => void login()}><Text style={styles.loginButtonText}>Googleでログイン</Text></Pressable><Text style={styles.endpoint}>接続先: {api}</Text></View></View></SafeAreaView>;
}

const styles = StyleSheet.create({ safeArea:{flex:1,backgroundColor:'#fff'},content:{flex:1,justifyContent:'space-between',paddingHorizontal:24,paddingTop:40,paddingBottom:36},title:{fontSize:30,fontWeight:'700',color:'#111827'},description:{marginTop:8,fontSize:16,color:'#4b5563'},actions:{width:'100%',gap:16},loginButton:{minHeight:56,alignItems:'center',justifyContent:'center',borderRadius:14,backgroundColor:'#111827'},loginButtonPressed:{opacity:.75},loginButtonText:{fontSize:17,fontWeight:'700',color:'#fff'},endpoint:{textAlign:'center',fontSize:12,color:'#6b7280'} });
