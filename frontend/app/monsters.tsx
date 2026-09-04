import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Header, colors, radius, spacing, typography } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { saveDataURIImageToLibrary } from "../services/device-image-save";
import {
  downloadMemoryMonsterImageDataURI,
  listMemoryMonsters,
  type MemoryMonster,
} from "../services/memory-monsters";
import {
  loadLanguage,
  subscribeLanguage,
  type AppLanguage,
} from "../services/onboarding";
import { getTabBarContentBottomPadding } from "../utils/layout";

const COPY = {
  ja: {
    title: "コレクション",
    loading: "読み込み中...",
    emptyTitle: "思い出キャラクターはまだありません",
    emptyBody: "案内終了後に写真と思い出を入力すると、ここに保存されます。",
    object: "モチーフ",
    memory: "思い出",
    sourcePhoto: "元写真ID",
    loadError: "コレクションを読み込めませんでした。",
    saveToDevice: "端末に保存",
    savingToDevice: "保存中...",
    savedToDevice: "端末に保存しました",
    deviceSavePermissionError: "写真への保存が許可されていません。",
    deviceSaveUnavailable: "この環境では端末への画像保存を利用できません。",
    deviceSaveError: "端末に保存できませんでした。",
  },
  en: {
    title: "Collection",
    loading: "Loading...",
    emptyTitle: "No memory characters yet",
    emptyBody: "After a guide, capture a photo and memory to save one here.",
    object: "Motif",
    memory: "Memory",
    sourcePhoto: "Source photo ID",
    loadError: "Could not load your collection.",
    saveToDevice: "Save to device",
    savingToDevice: "Saving...",
    savedToDevice: "Saved to device",
    deviceSavePermissionError: "Photo saving permission was not granted.",
    deviceSaveUnavailable: "Saving images to this device is unavailable here.",
    deviceSaveError: "Could not save to this device.",
  },
} as const;

export default function MonstersScreen() {
  const insets = useSafeAreaInsets();
  const { session, getCurrentSession } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [items, setItems] = useState<MemoryMonster[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingItemID, setSavingItemID] = useState<string | null>(null);
  const [savedItemID, setSavedItemID] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceSaveError, setDeviceSaveError] = useState<{ itemID: string; message: string } | null>(null);
  const copy = COPY[language];

  useEffect(() => {
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (nextLanguage) setLanguage(nextLanguage);
    });
    void loadLanguage().then((storedLanguage) => {
      if (storedLanguage) setLanguage(storedLanguage);
    });
    return unsubscribe;
  }, []);

  const load = async (refresh = false) => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) {
      setItems([]);
      setImages({});
      setLoading(false);
      setDeviceSaveError(null);
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setDeviceSaveError(null);
    try {
      const nextItems = await listMemoryMonsters(activeSession);
      setItems(nextItems);
      const entries = await Promise.all(nextItems.map(async (item) => {
        try {
          const image = await downloadMemoryMonsterImageDataURI(activeSession, item);
          return [item.id, image] as const;
        } catch {
          return null;
        }
      }));
      const nextImages: Record<string, string> = {};
      for (const entry of entries) {
        if (entry) nextImages[entry[0]] = entry[1];
      }
      setImages(nextImages);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session?.user_id]);

  const saveItemToDevice = async (item: MemoryMonster) => {
    const image = images[item.id];
    if (!image || savingItemID) return;
    setSavingItemID(item.id);
    setSavedItemID(null);
    setDeviceSaveError(null);
    try {
      const result = await saveDataURIImageToLibrary(image, `samurai-meet-memory-monster-${item.id}`);
      if (result === "permission_denied") {
        setDeviceSaveError({ itemID: item.id, message: copy.deviceSavePermissionError });
        return;
      }
      if (result === "unavailable") {
        setDeviceSaveError({ itemID: item.id, message: copy.deviceSaveUnavailable });
        return;
      }
      setSavedItemID(item.id);
    } catch {
      setDeviceSaveError({ itemID: item.id, message: copy.deviceSaveError });
    } finally {
      setSavingItemID(null);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header
        iconName="auto-awesome"
        style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}
        title={copy.title}
        titleStyle={styles.headerTitle}
        variant="hero"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: getTabBarContentBottomPadding(insets.bottom) },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.brand.sky} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color={colors.brand.sky} />
            <Text style={styles.stateText}>{copy.loading}</Text>
          </View>
        ) : error ? (
          <View style={styles.statePanel}>
            <MaterialIcons color={colors.state.danger} name="error-outline" size={34} />
            <Text accessibilityRole="alert" style={styles.stateText}>{error}</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.statePanel}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons color={colors.brand.sky} name="auto-awesome" size={34} />
            </View>
            <Text style={styles.emptyTitle}>{copy.emptyTitle}</Text>
            <Text style={styles.stateText}>{copy.emptyBody}</Text>
          </View>
        ) : (
          items.map((item) => (
            <View key={item.id} style={styles.card}>
              {images[item.id] ? (
                <Image source={{ uri: images[item.id] }} style={styles.monsterImage} />
              ) : (
                <View style={styles.imageFallback}>
                  <MaterialIcons color={colors.brand.sky} name="auto-awesome" size={38} />
                </View>
              )}
              <InfoBlock label={copy.object} value={item.memorable_object} />
              <InfoBlock label={copy.memory} value={item.memory_text} />
              <InfoBlock label={copy.sourcePhoto} value={item.source_photo_id} />
              {deviceSaveError?.itemID === item.id ? (
                <Text accessibilityRole="alert" style={styles.saveError}>{deviceSaveError.message}</Text>
              ) : null}
              {savedItemID === item.id ? <Text accessibilityLiveRegion="polite" style={styles.successText}>{copy.savedToDevice}</Text> : null}
              <Button
                disabled={!images[item.id] || savingItemID !== null}
                fullWidth
                iconLeft={<MaterialIcons color={colors.brand.sky} name="file-download" size={20} />}
                loading={savingItemID === item.id}
                onPress={() => void saveItemToDevice(item)}
                variant="secondary"
              >
                {savingItemID === item.id ? copy.savingToDevice : copy.saveToDevice}
              </Button>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  header: {
    minHeight: 178,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing["2xl"],
    paddingBottom: spacing["3xl"],
    borderBottomLeftRadius: 42,
    borderBottomRightRadius: 42,
    backgroundColor: colors.brand.sky,
  },
  headerTitle: { ...typography.title1, color: colors.text.inverse },
  content: {
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing["2xl"],
    paddingTop: spacing["3xl"],
  },
  card: {
    width: "100%",
    maxWidth: 420,
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.default,
  },
  monsterImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.subtle,
  },
  imageFallback: {
    width: "100%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surface.blueSoft,
  },
  statePanel: {
    width: "100%",
    maxWidth: 390,
    alignItems: "center",
    gap: spacing.md,
    padding: spacing["2xl"],
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.default,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 36,
    backgroundColor: colors.surface.blueSoft,
  },
  emptyTitle: { ...typography.heading, color: colors.text.primary, textAlign: "center" },
  stateText: { ...typography.caption, color: colors.text.secondary, textAlign: "center" },
  successText: { ...typography.captionStrong, color: colors.state.success, textAlign: "center" },
  saveError: { ...typography.caption, color: colors.state.danger, textAlign: "center" },
  infoBlock: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.subtle,
  },
  infoLabel: { ...typography.smallStrong, color: colors.text.subtle },
  infoValue: { ...typography.body, color: colors.text.secondary },
});
