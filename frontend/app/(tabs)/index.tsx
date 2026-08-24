import { Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../hooks/useAuth';

export default function HomeScreen() {
  const { session, status, refresh, continuePasskey, logout, logoutAll, error } = useAuth();
  if (status !== 'signed_in' || !session) return <Redirect href="/(auth)/login" />;
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>SAMURAI MEET</Text>
      <Text style={styles.title}>ログイン中</Text>
      <View style={styles.card}>
        <Text style={styles.label}>ユーザー</Text>
        <Text style={styles.value} selectable>{session.user_id}</Text>
        <Text style={styles.label}>セッション</Text>
        <Text style={styles.value} selectable>{session.session_id}</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.primary} onPress={() => void refresh()}><Text style={styles.primaryText}>セッションを更新</Text></Pressable>
      <Pressable style={styles.outline} onPress={() => void continuePasskey()}><Text style={styles.outlineText}>Passkeyを再認証</Text></Pressable>
      <Pressable style={styles.outline} onPress={() => void logout()}><Text style={styles.outlineText}>ログアウト</Text></Pressable>
      <Pressable style={styles.danger} onPress={() => void logoutAll()}><Text style={styles.dangerText}>全端末からログアウト</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 28, gap: 16, backgroundColor: '#fff' },
  eyebrow: { color: '#9a3412', fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#111827', fontSize: 34, fontWeight: '800' },
  card: { gap: 6, padding: 16, borderRadius: 14, backgroundColor: '#f3f4f6' },
  label: { color: '#6b7280', fontSize: 12, fontWeight: '700' },
  value: { color: '#111827', fontSize: 13, marginBottom: 8 },
  primary: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#111827' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  outline: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#9ca3af' },
  outlineText: { color: '#374151', fontSize: 15, fontWeight: '700' },
  danger: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#fee2e2' },
  dangerText: { color: '#991b1b', fontSize: 15, fontWeight: '700' },
  error: { color: '#b91c1c', fontSize: 14 },
});
