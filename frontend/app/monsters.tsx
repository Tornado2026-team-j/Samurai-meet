import { MaterialIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Header, colors, radius, shadows, spacing, typography } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { loadStoredKeyA, loadStoredKeyEnvelope } from "../services/key-management";
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
import { downloadAndDecryptPhoto } from "../services/photos";
import { toBase64 } from "../services/crypto";
import { getTabBarContentBottomPadding } from "../utils/layout";

const COPY = {
  ja: {
    title: "コレクション",
    loading: "読み込み中...",
    emptyTitle: "まだコレクションがありません",
    emptyBody: "案内をすると、交換したキャラクターがここに追加されます。",
    loadError: "コレクションを読み込めませんでした。",
    unknownDate: "日付未設定",
    unknownLocation: "場所未設定",
    location: "場所",
    object: "思い出のオブジェクト",
    memory: "思い出",
    photo: "思い出の写真",
    close: "閉じる",
    photoLoading: "写真を読み込み中...",
    photoUnavailable: "写真を表示できませんでした。",
  },
  en: {
    title: "Collection",
    loading: "Loading...",
    emptyTitle: "No collection yet",
    emptyBody: "Characters you exchange after a guide will appear here.",
    loadError: "Could not load your collection.",
    unknownDate: "Date unavailable",
    unknownLocation: "Location unavailable",
    location: "Place",
    object: "Memory object",
    memory: "Memory",
    photo: "Memory photo",
    close: "Close",
    photoLoading: "Loading photo...",
    photoUnavailable: "Could not display this photo.",
  },
} as const;

type SourcePhotoStatus = "loading" | "error";

export default function MonstersScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { session, getCurrentSession } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [items, setItems] = useState<MemoryMonster[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [sourcePhotos, setSourcePhotos] = useState<Record<string, string>>({});
  const [sourcePhotoStatus, setSourcePhotoStatus] = useState<Record<string, SourcePhotoStatus>>({});
  const [selectedItem, setSelectedItem] = useState<MemoryMonster | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[language];
  const contentWidth = Math.min(Math.max(width - spacing.xl * 2, 0), 480);
  const monsterSize = Math.min(124, Math.max(86, (contentWidth - spacing.md * 2) / 3));
  const modalMaxHeight = Math.max(240, height - insets.top - insets.bottom - spacing.xl * 2);

  useEffect(() => {
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (nextLanguage) setLanguage(nextLanguage);
    });
    void loadLanguage().then((storedLanguage) => {
      if (storedLanguage) setLanguage(storedLanguage);
    });
    return unsubscribe;
  }, []);

  const load = useCallback(async (refresh = false) => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) {
      setItems([]);
      setImages({});
      setSourcePhotos({});
      setSourcePhotoStatus({});
      setLoading(false);
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
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

  const rows = useMemo(() => chunkByThree(items), [items]);

  const loadSourcePhoto = useCallback(async (item: MemoryMonster) => {
    if (sourcePhotos[item.id] || sourcePhotoStatus[item.id] === "loading") return;
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession) return;
    setSourcePhotoStatus((current) => ({ ...current, [item.id]: "loading" }));
    try {
      const [keyA, envelope] = await Promise.all([
        loadStoredKeyA(activeSession.user_id),
        loadStoredKeyEnvelope(activeSession.user_id),
      ]);
      if (!keyA || !envelope?.kdf_params.data_salt) throw new Error("missing photo key");
      const bytes = await downloadAndDecryptPhoto(
        activeSession,
        item.source_photo_id,
        keyA,
        envelope.kdf_params.data_salt,
      );
      const contentType = supportedSourcePhotoContentType(item.source_photo_content_type);
      const uri = `data:${contentType};base64,${toBase64(bytes)}`;
      setSourcePhotos((current) => ({ ...current, [item.id]: uri }));
      setSourcePhotoStatus((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    } catch {
      setSourcePhotoStatus((current) => ({ ...current, [item.id]: "error" }));
    }
  }, [getCurrentSession, session, sourcePhotoStatus, sourcePhotos]);

  const openDetails = (item: MemoryMonster) => {
    setSelectedItem(item);
    void loadSourcePhoto(item);
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
          <StatePanel>
            <ActivityIndicator color={colors.brand.sky} />
            <Text style={styles.stateText}>{copy.loading}</Text>
          </StatePanel>
        ) : error ? (
          <StatePanel>
            <MaterialIcons color={colors.state.danger} name="error-outline" size={34} />
            <Text accessibilityRole="alert" style={styles.stateText}>{error}</Text>
          </StatePanel>
        ) : items.length === 0 ? (
          <StatePanel>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons color={colors.brand.sky} name="auto-awesome" size={34} />
            </View>
            <Text style={styles.emptyTitle}>{copy.emptyTitle}</Text>
            <Text style={styles.stateText}>{copy.emptyBody}</Text>
          </StatePanel>
        ) : (
          <View style={[styles.shelves, { width: contentWidth }]}>
            {rows.map((row, rowIndex) => (
              <View key={`shelf-${rowIndex}`} style={styles.shelfRow}>
                <View style={styles.shelfItems}>
                  {row.map((item, index) => item ? (
                    <Pressable
                      accessibilityLabel={`${formatFullDate(displayDate(item), language, copy.unknownDate)} ${copy.memory}`}
                      accessibilityRole="button"
                      key={item.id}
                      onPress={() => openDetails(item)}
                      style={({ pressed }) => [
                        styles.shelfSlot,
                        { width: monsterSize },
                        pressed && styles.pressedItem,
                      ]}
                    >
                      <View style={[styles.displaySpace, { width: monsterSize, height: monsterSize * 1.08 }]}>
                        {images[item.id] ? (
                          <Image
                            resizeMode="contain"
                            source={{ uri: images[item.id] }}
                            style={[styles.monsterImage, { width: monsterSize, height: monsterSize }]}
                          />
                        ) : (
                          <View style={[styles.imageFallback, { width: monsterSize, height: monsterSize }]}>
                            <MaterialIcons color={colors.brand.sky} name="auto-awesome" size={32} />
                          </View>
                        )}
                      </View>
                      <Text numberOfLines={1} style={styles.shelfDate}>
                        {formatShelfDate(displayDate(item), language, copy.unknownDate)}
                      </Text>
                    </Pressable>
                  ) : (
                    <View key={`empty-${rowIndex}-${index}`} style={[styles.shelfSlot, styles.invisibleSlot, { width: monsterSize }]} />
                  ))}
                </View>
                <View style={styles.shelfBoard}>
                  <View style={styles.shelfBoardHighlight} />
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setSelectedItem(null)}
        transparent
        visible={Boolean(selectedItem)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, { maxHeight: modalMaxHeight }]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderSpacer} />
              <Text accessibilityRole="header" numberOfLines={1} style={styles.modalTitle}>
                {selectedItem ? formatFullDate(displayDate(selectedItem), language, copy.unknownDate) : copy.title}
              </Text>
              <Pressable
                accessibilityLabel={copy.close}
                accessibilityRole="button"
                onPress={() => setSelectedItem(null)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
              >
                <MaterialIcons color={colors.text.secondary} name="close" size={22} />
              </Pressable>
            </View>

            {selectedItem ? (
              <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
                {images[selectedItem.id] ? (
                  <Image
                    resizeMode="contain"
                    source={{ uri: images[selectedItem.id] }}
                    style={styles.modalMonsterImage}
                  />
                ) : (
                  <View style={styles.modalImageFallback}>
                    <MaterialIcons color={colors.brand.sky} name="auto-awesome" size={42} />
                  </View>
                )}

                <DetailSection label={copy.location} value={selectedItem.location_name || copy.unknownLocation} />
                <DetailSection label={copy.object} value={selectedItem.memorable_object} />

                <View style={styles.detailGroup}>
                  <Text style={styles.detailLabel}>{copy.memory}</Text>
                  <Text style={styles.memoryText}>{selectedItem.memory_text}</Text>
                </View>

                <View style={styles.detailGroup}>
                  <Text style={styles.detailLabel}>{copy.photo}</Text>
                  {sourcePhotoStatus[selectedItem.id] === "loading" ? (
                    <View style={styles.photoState}>
                      <ActivityIndicator color={colors.brand.sky} />
                      <Text style={styles.photoStateText}>{copy.photoLoading}</Text>
                    </View>
                  ) : sourcePhotos[selectedItem.id] ? (
                    <Image
                      resizeMode="contain"
                      source={{ uri: sourcePhotos[selectedItem.id] }}
                      style={styles.sourcePhoto}
                    />
                  ) : (
                    <View style={styles.photoState}>
                      <MaterialIcons color={colors.text.muted} name="image-not-supported" size={28} />
                      <Text style={styles.photoStateText}>{copy.photoUnavailable}</Text>
                    </View>
                  )}
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StatePanel({ children }: { children: ReactNode }) {
  return <View style={styles.statePanel}>{children}</View>;
}

function DetailSection({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailGroup}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function chunkByThree(items: MemoryMonster[]): Array<Array<MemoryMonster | null>> {
  const rows: Array<Array<MemoryMonster | null>> = [];
  for (let index = 0; index < items.length; index += 3) {
    const row: Array<MemoryMonster | null> = items.slice(index, index + 3);
    while (row.length < 3) row.push(null);
    rows.push(row);
  }
  return rows;
}

function displayDate(item: MemoryMonster): string {
  return item.guide_date || item.created_at;
}

function formatShelfDate(value: string, language: AppLanguage, fallback: string): string {
  const parts = dateParts(value);
  if (!parts) return fallback;
  if (language === "ja") return `${Number(parts.month)}月${Number(parts.day)}日`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parts.date);
}

function formatFullDate(value: string, language: AppLanguage, fallback: string): string {
  const parts = dateParts(value);
  if (!parts) return fallback;
  if (language === "ja") return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日`;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(parts.date);
}

function dateParts(value: string): { year: string; month: string; day: string; date: Date } | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = dateOnly[1] ?? "";
    const month = dateOnly[2] ?? "";
    const day = dateOnly[3] ?? "";
    return { year, month, day, date: new Date(Number(year), Number(month) - 1, Number(day)) };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  if (!values.year || !values.month || !values.day) return null;
  return { year: values.year, month: values.month, day: values.day, date };
}

function supportedSourcePhotoContentType(value: string | undefined): "image/png" | "image/jpeg" | "image/webp" {
  if (value === "image/png" || value === "image/webp") return value;
  return "image/jpeg";
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
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
  },
  shelves: {
    gap: spacing.xl,
  },
  shelfRow: {
    width: "100%",
  },
  shelfItems: {
    minHeight: 136,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  shelfSlot: {
    alignItems: "center",
    gap: spacing.xs,
  },
  pressedItem: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  invisibleSlot: {
    opacity: 0,
  },
  displaySpace: {
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
    borderTopLeftRadius: radius["3xl"],
    borderTopRightRadius: radius["3xl"],
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    backgroundColor: "#fbfbfb",
    boxShadow: "inset 0 1px 5px rgba(16, 19, 24, 0.05)",
  },
  monsterImage: {
    backgroundColor: "transparent",
  },
  imageFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xl,
    backgroundColor: colors.surface.blueSoft,
  },
  shelfDate: {
    ...typography.micro,
    color: colors.text.muted,
    textAlign: "center",
  },
  shelfBoard: {
    width: "100%",
    height: 18,
    marginTop: -spacing.xs,
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: "#fdfdfd",
    ...shadows.card,
  },
  shelfBoardHighlight: {
    height: 6,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  statePanel: {
    width: "100%",
    maxWidth: 390,
    alignItems: "center",
    gap: spacing.md,
    padding: spacing["2xl"],
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface.default,
    ...shadows.card,
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
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: "rgba(16, 19, 24, 0.36)",
  },
  modalPanel: {
    width: "100%",
    maxWidth: 430,
    overflow: "hidden",
    borderRadius: radius["3xl"],
    backgroundColor: colors.surface.default,
    boxShadow: "0 8px 24px rgba(16, 19, 24, 0.16)",
  },
  modalHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  modalHeaderSpacer: {
    width: 38,
  },
  modalTitle: {
    flex: 1,
    ...typography.subheading,
    color: colors.text.primary,
    textAlign: "center",
  },
  closeButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: colors.surface.subtle,
  },
  closeButtonPressed: {
    opacity: 0.72,
  },
  modalContent: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing["2xl"],
  },
  modalMonsterImage: {
    alignSelf: "center",
    width: "76%",
    aspectRatio: 1,
    borderRadius: radius.xl,
    backgroundColor: colors.surface.subtle,
  },
  modalImageFallback: {
    alignSelf: "center",
    width: "76%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xl,
    backgroundColor: colors.surface.blueSoft,
  },
  detailGroup: {
    gap: spacing.xs,
  },
  detailLabel: {
    ...typography.smallStrong,
    color: colors.text.subtle,
  },
  detailValue: {
    ...typography.body,
    color: colors.text.primary,
  },
  memoryText: {
    ...typography.body,
    color: colors.text.primary,
  },
  sourcePhoto: {
    width: "100%",
    aspectRatio: 1.42,
    borderRadius: radius.xl,
    backgroundColor: colors.surface.subtle,
  },
  photoState: {
    minHeight: 156,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.surface.subtle,
  },
  photoStateText: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: "center",
  },
});
