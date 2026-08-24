import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../hooks/useAuth';

export default function LoginScreen() {
  const { login, status, error } = useAuth();
  const busy = status === 'loading';
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>SAMURAI MEET</Text>
      <Text style={styles.title}>また会いましょう。</Text>
      <Text style={styles.description}>Googleで本人確認を始め、Passkeyを使って安全にログインします。</Text>
      <Pressable style={styles.primary} disabled={busy} onPress={() => void login()}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Googleでログイン</Text>}
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Text style={styles.note}>ログイン状態は端末のSecure StorageにRefresh Tokenだけを保存して保持します。</Text>
      <Link href="/(auth)/register" style={styles.link}>初めて利用する方はこちら</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 28, gap: 18, backgroundColor: '#fff' },
  eyebrow: { color: '#9a3412', fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#111827', fontSize: 34, fontWeight: '800' },
  description: { color: '#4b5563', fontSize: 16, lineHeight: 24 },
  primary: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#111827' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: '#b91c1c', fontSize: 14 },
  note: { color: '#6b7280', fontSize: 12, lineHeight: 18 },
  link: { color: '#9a3412', fontSize: 15, fontWeight: '700' },
});
