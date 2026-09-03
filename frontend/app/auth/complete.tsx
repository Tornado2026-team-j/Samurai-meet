import { MaterialIcons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/ui';

export default function OAuthCompleteScreen() {
  const {
    handoff_code: handoffCode,
    session_handoff_code: sessionHandoffCode,
  } = useLocalSearchParams<{ handoff_code?: string; session_handoff_code?: string }>();
  const { error, status } = useAuth();
  const router = useRouter();
  const hasHandoffCode = typeof handoffCode === 'string' && handoffCode.length > 0
    || typeof sessionHandoffCode === 'string' && sessionHandoffCode.length > 0;

  if (status === 'pre_auth' || status === 'signed_in') return <Redirect href="/" />;

  const invalid = !hasHandoffCode;
  if (invalid || error) {
    return (
      <View style={styles.screen}>
        <View style={styles.iconCircle}>
          <MaterialIcons color="#b42318" name="error-outline" size={38} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>ログインを完了できませんでした</Text>
        <Text accessibilityRole="alert" style={styles.message}>
          {invalid ? '認証コードが見つかりません。最初からやり直してください。' : error}
        </Text>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/')} style={styles.button}>
          <MaterialIcons color="#ffffff" name="arrow-back" size={20} />
          <Text style={styles.buttonText}>アカウント作成へ戻る</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View accessibilityLabel="Google認証を完了しています" style={styles.screen}>
      <View style={styles.iconCircle}>
        <LoadingSpinner color="#e7b454" size={28} speedMs={640} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>Google認証を確認中</Text>
      <Text style={styles.message}>安全なログイン処理を完了しています。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5ec5f5',
  },
  iconCircle: {
    width: 88,
    height: 88,
    marginBottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 44,
    backgroundColor: '#ffffff',
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
  },
  message: {
    maxWidth: 380,
    marginTop: 10,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 22,
    letterSpacing: 0,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    maxWidth: 360,
    minHeight: 54,
    marginTop: 28,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 8,
    backgroundColor: '#e7b454',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
