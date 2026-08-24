import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../hooks/useAuth';

export default function RegisterScreen() {
  const { login, error } = useAuth();
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>WELCOME</Text>
      <Text style={styles.title}>新しく始める</Text>
      <Text style={styles.description}>Googleアカウントで登録し、続けてPasskeyを登録します。プロフィールは認証完了後に作成できます。</Text>
      <Pressable style={styles.primary} onPress={() => void login()}>
        <Text style={styles.primaryText}>Googleで登録を始める</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Link href="/(auth)/login" style={styles.link}>すでにアカウントをお持ちの方</Link>
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
  link: { color: '#9a3412', fontSize: 15, fontWeight: '700' },
});
