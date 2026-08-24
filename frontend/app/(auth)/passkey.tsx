import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../hooks/useAuth';

export default function PasskeyScreen() {
  const { status, preAuth, continuePasskey, error } = useAuth();
  if (status === 'signed_in') return <Redirect href="/(tabs)" />;
  if (status === 'signed_out' && !preAuth) return <Redirect href="/(auth)/login" />;
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>SECURE SIGN-IN</Text>
      <Text style={styles.title}>Passkeyを登録</Text>
      <Text style={styles.description}>{preAuth?.passkey_registered ? '登録済みPasskeyで本人確認を完了してください。' : 'この端末のPasskeyを登録すると、通常ログインが完了します。'}</Text>
      <Pressable style={styles.primary} disabled={status === 'loading'} onPress={() => void continuePasskey()}>
        {status === 'loading' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>WebでPasskeyを続ける</Text>}
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Text style={styles.note}>Expo GoではWebAuthn対応ブラウザを開き、完了後にこのアプリへ安全に戻ります。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 28, gap: 18, backgroundColor: '#fff' },
  eyebrow: { color: '#9a3412', fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#111827', fontSize: 32, fontWeight: '800' },
  description: { color: '#4b5563', fontSize: 16, lineHeight: 24 },
  primary: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#111827' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: '#b91c1c', fontSize: 14 },
  note: { color: '#6b7280', fontSize: 12, lineHeight: 18 },
});
