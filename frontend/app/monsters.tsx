import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ThemeColors } from "../components/ui/tokens";
import { Button, LoadingSpinner } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { useDisplayLanguage } from "../hooks/useDisplayLanguage";
import { useTheme, useThemeStyles } from "../hooks/useTheme";
import { saveDataURIImageToLibrary } from "../services/device-image-save";
import {
  downloadMemoryMonsterImageDataURI,
  listMemoryMonsters,
  type MemoryMonster,
} from "../services/memory-monsters";
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
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const { session, getCurrentSession } = useAuth();
  const language = useDisplayLanguage();
  const [items, setItems] = useState<MemoryMonster[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingItemID, setSavingItemID] = useState<string | null>(null);
  const [savedItemID, setSavedItemID] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceSaveError, setDeviceSaveError] = useState<{ itemID: string; message: string } | null>(null);
  const copy = COPY[language ?? "ja"];

  const load = useCallback(async (refresh = false) => {
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
  }, [copy.loadError, getCurrentSession, session]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (!language) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
          <MaterialIcons color={colors.text.onSky} name="auto-awesome" size={42} />
        </View>
        <View style={styles.languageLoadingPanel}>
          <LoadingSpinner color={colors.brand.sky} size={24} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <MaterialIcons color={colors.text.onSky} name="auto-awesome" size={42} />
        <Text accessibilityRole="header" style={styles.headerTitle}>{copy.title}</Text>
      </View>

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
            <LoadingSpinner color={colors.brand.sky} size={24} />
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
  const styles = useThemeStyles(createStyles);
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.surface.screen,
    },
    header: {
      minHeight: 178,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingHorizontal: 24,
      paddingBottom: 26,
      borderBottomLeftRadius: 42,
      borderBottomRightRadius: 42,
      backgroundColor: colors.brand.sky,
    },
    headerTitle: {
      color: colors.text.onSky,
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: 0,
    },
    content: {
      alignItems: "center",
      paddingHorizontal: 24,
      paddingTop: 28,
      gap: 16,
    },
    languageLoadingPanel: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    card: {
      width: "100%",
      maxWidth: 420,
      gap: 14,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: 24,
      backgroundColor: colors.surface.default,
    },
    monsterImage: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: 16,
      backgroundColor: colors.surface.subtle,
    },
    imageFallback: {
      width: "100%",
      aspectRatio: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 16,
      backgroundColor: colors.surface.blueSoft,
    },
    statePanel: {
      width: "100%",
      maxWidth: 390,
      minHeight: 420,
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
      paddingHorizontal: 20,
    },
    emptyIconCircle: {
      width: 76,
      height: 76,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border.blue,
      borderRadius: 38,
      backgroundColor: colors.surface.blueSoft,
    },
    emptyTitle: {
      color: colors.text.secondary,
      fontSize: 17,
      fontWeight: "800",
      letterSpacing: 0,
      textAlign: "center",
    },
    stateText: {
      maxWidth: 290,
      color: colors.text.muted,
      fontSize: 14,
      fontWeight: "600",
      letterSpacing: 0,
      lineHeight: 22,
      textAlign: "center",
    },
    successText: {
      color: colors.state.success,
      fontSize: 14,
      fontWeight: "700",
      textAlign: "center",
    },
    saveError: {
      color: colors.state.danger,
      fontSize: 14,
      fontWeight: "600",
      textAlign: "center",
    },
    infoBlock: {
      width: "100%",
      gap: 6,
      padding: 14,
      borderRadius: 16,
      backgroundColor: colors.surface.subtle,
    },
    infoLabel: {
      color: colors.text.muted,
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 0,
    },
    infoValue: {
      color: colors.text.secondary,
      fontSize: 15,
      fontWeight: "700",
      letterSpacing: 0,
      lineHeight: 22,
    },
  });
}
