import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../hooks/useAuth';

export default function Index() {
  const { status } = useAuth();
  if (status === 'loading') {
    return <View style={styles.loading}><ActivityIndicator size="large" /></View>;
  }
  if (status === 'signed_in') return <Redirect href="/(tabs)" />;
  if (status === 'pre_auth') return <Redirect href="/(auth)/passkey" />;
  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
