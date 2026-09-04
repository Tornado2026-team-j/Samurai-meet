import { MaterialIcons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { ThemeColors } from '../../components/ui/tokens';
import { useTheme, useThemeStyles } from '../../hooks/useTheme';
import { parsePasskeyBridgeRequest, type PasskeyBridgeRequest } from '../../services/auth-contract';
import { completeWebPasskeyBridge } from '../../services/passkey-web';

function readBridgeRequest(): PasskeyBridgeRequest | null {
  if (Platform.OS !== 'web' || typeof globalThis.location === 'undefined') return null;
  const request = parsePasskeyBridgeRequest(globalThis.location.href);
  if (globalThis.location.hash) {
    globalThis.history.replaceState(
      globalThis.history.state,
      '',
      `${globalThis.location.pathname}${globalThis.location.search}`,
    );
  }
  return request;
}

export default function PasskeyScreen() {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const [request] = useState(readBridgeRequest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof globalThis.location === 'undefined') return;
    const cleanURL = `${globalThis.location.pathname}${globalThis.location.search}`;
    const stripFragment = () => {
      if (globalThis.location.hash) {
        globalThis.history.replaceState(globalThis.history.state, '', cleanURL);
      }
    };
    stripFragment();
    const animationFrame = globalThis.requestAnimationFrame(stripFragment);
    const timeout = globalThis.setTimeout(stripFragment, 50);
    return () => {
      globalThis.cancelAnimationFrame(animationFrame);
      globalThis.clearTimeout(timeout);
    };
  }, []);

  const title = 'Passkeyで本人確認';
  const description = 'アプリへ安全に戻るため、端末の画面ロックで本人確認を行います。';

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof globalThis.document === 'undefined') return;
    const previousTitle = globalThis.document.title;
    globalThis.document.title = `${title} | Samurai Meet`;
    return () => {
      globalThis.document.title = previousTitle;
    };
  }, [title]);

  if (Platform.OS !== 'web') return <Redirect href="/" />;

  const complete = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      const handoffCode = await completeWebPasskeyBridge(request);
      const returnURI = new URL(request.appReturnURI);
      returnURI.searchParams.set('session_handoff_code', handoffCode);
      globalThis.location.assign(returnURI.toString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Passkeyの処理に失敗しました');
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <MaterialIcons color={colors.text.inverse} name="key" size={58} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
        </View>

        <View style={styles.content}>
          {request ? (
            <>
              <View style={styles.securityRow}>
                <MaterialIcons color={colors.state.success} name="verified-user" size={23} />
                <View style={styles.securityCopy}>
                  <Text style={styles.securityTitle}>安全な本人確認</Text>
                  <Text style={styles.securityText}>顔・指紋などの生体情報がSamurai Meetへ送信されることはありません。</Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void complete()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  busy && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.text.inverse} />
                ) : (
                  <>
                    <MaterialIcons color={colors.text.inverse} name="fingerprint" size={25} />
                    <Text style={styles.primaryButtonText}>{title}</Text>
                  </>
                )}
              </Pressable>
            </>
          ) : (
            <View style={styles.invalidRequest}>
              <MaterialIcons color={colors.state.danger} name="error-outline" size={26} />
              <Text accessibilityRole="alert" style={styles.invalidText}>
                Passkeyリクエストが無効です。アプリからもう一度お試しください。
              </Text>
            </View>
          )}

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.noteRow}>
            <MaterialIcons color={colors.text.subtle} name="lock-outline" size={16} />
            <Text style={styles.note}>本人確認の完了後、一回限りの認証コードでアプリへ戻ります。</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.screen,
  },
  scrollContent: {
    flexGrow: 1,
  },
  hero: {
    width: '100%',
    minHeight: 365,
    paddingTop: 54,
    paddingHorizontal: 24,
    paddingBottom: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomLeftRadius: 44,
    borderBottomRightRadius: 44,
    backgroundColor: colors.brand.sky,
  },
  iconCircle: {
    width: 112,
    height: 112,
    marginBottom: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.text.inverse,
    borderRadius: 56,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  title: {
    color: colors.text.inverse,
    fontSize: 27,
    fontWeight: '900',
    lineHeight: 34,
    letterSpacing: 0,
    textAlign: 'center',
  },
  description: {
    width: '100%',
    maxWidth: 390,
    marginTop: 9,
    color: colors.text.inverse,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 22,
    letterSpacing: 0,
    textAlign: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 480,
    paddingTop: 30,
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignSelf: 'center',
    gap: 18,
  },
  securityRow: {
    minHeight: 82,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 8,
    backgroundColor: colors.surface.successSoft,
  },
  securityCopy: {
    flex: 1,
    gap: 3,
  },
  securityTitle: {
    color: colors.state.success,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  securityText: {
    color: colors.text.secondary,
    fontSize: 11,
    lineHeight: 17,
    letterSpacing: 0,
  },
  primaryButton: {
    width: '100%',
    minHeight: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
  },
  primaryButtonText: {
    color: colors.text.inverse,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },
  invalidRequest: {
    minHeight: 82,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border.danger,
    borderRadius: 8,
    backgroundColor: colors.surface.dangerSoft,
  },
  invalidText: {
    flex: 1,
    color: colors.state.dangerDark,
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0,
  },
  error: {
    color: colors.state.danger,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
    textAlign: 'center',
  },
  noteRow: {
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 7,
  },
  note: {
    flexShrink: 1,
    color: colors.text.subtle,
    fontSize: 11,
    lineHeight: 17,
    letterSpacing: 0,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.72,
  },
  });
}
