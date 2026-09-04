import { MaterialIcons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, colors, radius, spacing, typography } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { saveDataURIImageToLibrary } from "../../services/device-image-save";
import { loadStoredKeyA, loadStoredKeyEnvelope } from "../../services/key-management";
import {
  createMemoryMonster,
  downloadMemoryMonsterImageDataURI,
  type MemoryMonster,
} from "../../services/memory-monsters";
import { uploadEncryptedPhoto } from "../../services/photos";
import { getTabBarContentBottomPadding } from "../../utils/layout";

type CapturedPhoto = {
  uri: string;
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
};

const COPY = {
  title: "今日の思い出",
  subtitle: "案内の体験からコレクション用キャラクターを作ります。",
  takePhoto: "写真を撮る",
  retake: "撮り直す",
  shoot: "撮影",
  objectLabel: "一番記憶に残ったオブジェクト",
  objectPlaceholder: "例：赤い提灯",
  objectLimit: "15字以内",
  memoryLabel: "案内したときの思い出",
  memoryPlaceholder: "例：一緒に抹茶を飲んで、文化について話したのが楽しかった",
  memoryLimit: "100字以内",
  generate: "キャラクターを生成",
  generating: "生成中…",
  saved: "コレクションに保存しました",
  resultTitle: "キャラクターができました",
  keepInCollection: "コレクションに保管",
  finishGuide: "案内を終了する",
  saveToDevice: "端末に保存",
  savingToDevice: "保存中…",
  savedToDevice: "端末に保存しました",
  openCollection: "コレクションを見る",
  permissionTitle: "カメラを使用します",
  permissionBody: "その場で撮影した写真だけを思い出キャラクターに使います。",
  requestPermission: "カメラを許可",
  photoRequired: "写真を撮影してください",
  inputRequired: "オブジェクトと思い出を入力してください",
  windowExpired: "思い出を作れる期間（終了後24時間）を過ぎました。",
  keyError: "この端末の保存鍵が見つかりません。Recovery Phraseで復旧してください。",
  error: "生成に失敗しました。写真と入力内容を確認して再試行してください。",
  deviceSavePermissionError: "写真への保存が許可されていません。",
  deviceSaveUnavailable: "この環境では端末への画像保存を利用できません。",
  deviceSaveError: "端末に保存できませんでした。",
};

export default function MeetingResultScreen() {
  const insets = useSafeAreaInsets();
  const { matchId, meetingId } = useLocalSearchParams<{ matchId?: string; meetingId?: string }>();
  const { session, getCurrentSession } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const [memorableObject, setMemorableObject] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingToDevice, setSavingToDevice] = useState(false);
  const [savedToDevice, setSavedToDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<MemoryMonster | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [collectionStored, setCollectionStored] = useState(false);

  const activeSession = getCurrentSession() ?? session;
  const canGenerate = Boolean(captured && memorableObject.trim() && memoryText.trim() && !submitting && !generated);

  const openCamera = async () => {
    setError(null);
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) return;
    }
    setCameraVisible(true);
  };

  const takePhoto = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.82 });
      if (!photo?.uri) throw new Error("capture failed");
      const bytes = await readURI(photo.uri);
      setCaptured({ uri: photo.uri, bytes, contentType: contentTypeForURI(photo.uri) });
      setCameraVisible(false);
    } catch {
      setError(COPY.error);
    } finally {
      setCapturing(false);
    }
  };

  const submit = async () => {
    if (!matchId || Array.isArray(matchId) || !activeSession) return;
    if (!captured) {
      setError(COPY.photoRequired);
      return;
    }
    if (!memorableObject.trim() || !memoryText.trim()) {
      setError(COPY.inputRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const [keyA, envelope] = await Promise.all([
        loadStoredKeyA(activeSession.user_id),
        loadStoredKeyEnvelope(activeSession.user_id),
      ]);
      if (!keyA || !envelope?.kdf_params.data_salt) throw new Error(COPY.keyError);
      const savedPhoto = await uploadEncryptedPhoto(activeSession, captured.bytes, {
        contentType: captured.contentType,
        visibility: "private",
        keyA,
        dataSalt: envelope.kdf_params.data_salt,
      });
      const monster = await createMemoryMonster(activeSession, {
        matchId,
        meetingId: Array.isArray(meetingId) ? undefined : meetingId,
        sourcePhotoId: savedPhoto.photo.id,
        photoUri: captured.uri,
        photoContentType: captured.contentType,
        memorableObject: memorableObject.trim(),
        memoryText: memoryText.trim(),
      });
      setGenerated(monster);
      setGeneratedImage(await downloadMemoryMonsterImageDataURI(activeSession, monster));
      setSavedToDevice(false);
      setCollectionStored(false);
      setResultModalVisible(true);
    } catch (reason) {
      if (reason instanceof Error && reason.message === COPY.keyError) {
        setError(COPY.keyError);
      } else if (reason instanceof Error && reason.message.includes("memory_monster_creation_window_expired")) {
        setError(COPY.windowExpired);
      } else {
        setError(COPY.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const keepGeneratedInCollection = () => {
    setCollectionStored(true);
    setResultModalVisible(false);
  };

  const finishGuide = () => {
    if (router.canDismiss()) router.dismissAll();
    router.replace("/");
  };

  const saveGeneratedImageToDevice = async () => {
    if (!generatedImage || !generated || savingToDevice) return;
    setSavingToDevice(true);
    setSavedToDevice(false);
    setError(null);
    try {
      const result = await saveDataURIImageToLibrary(generatedImage, `samurai-meet-memory-monster-${generated.id}`);
      if (result === "permission_denied") {
        setError(COPY.deviceSavePermissionError);
        return;
      }
      if (result === "unavailable") {
        setError(COPY.deviceSaveUnavailable);
        return;
      }
      setSavedToDevice(true);
    } catch {
      setError(COPY.deviceSaveError);
    } finally {
      setSavingToDevice(false);
    }
  };

  if (cameraVisible) {
    return (
      <View style={styles.cameraScreen}>
        <StatusBar style="light" />
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        <View style={[styles.cameraControls, { paddingBottom: Math.max(insets.bottom, 22) }]}>
          <Pressable accessibilityRole="button" onPress={() => setCameraVisible(false)} style={styles.iconButton}>
            <MaterialIcons color={colors.text.inverse} name="close" size={28} />
          </Pressable>
          <Pressable accessibilityRole="button" disabled={capturing} onPress={() => void takePhoto()} style={styles.shutter}>
            {capturing ? <ActivityIndicator color={colors.brand.sky} /> : <Text style={styles.shutterText}>{COPY.shoot}</Text>}
          </Pressable>
          <View style={styles.iconButton} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <MaterialIcons color={colors.text.inverse} name="auto-awesome" size={38} />
        <Text accessibilityRole="header" style={styles.headerTitle}>{COPY.title}</Text>
        <Text style={styles.headerSubtitle}>{COPY.subtitle}</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: getTabBarContentBottomPadding(insets.bottom) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!generated ? (
          <>
            {!permission?.granted && !captured ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>{COPY.permissionTitle}</Text>
                <Text style={styles.bodyText}>{COPY.permissionBody}</Text>
                <Button fullWidth iconLeft={<MaterialIcons color={colors.text.inverse} name="photo-camera" size={20} />} onPress={() => void openCamera()}>
                  {COPY.requestPermission}
                </Button>
              </View>
            ) : null}

            <View style={styles.panel}>
              {captured ? (
                <Image source={{ uri: captured.uri }} style={styles.preview} />
              ) : (
                <View style={styles.emptyPreview}>
                  <MaterialIcons color={colors.brand.sky} name="photo-camera" size={42} />
                </View>
              )}
              <View style={styles.actionRow}>
                <Button fullWidth iconLeft={<MaterialIcons color={colors.text.inverse} name="photo-camera" size={20} />} onPress={() => void openCamera()}>
                  {captured ? COPY.retake : COPY.takePhoto}
                </Button>
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.label}>{COPY.objectLabel}</Text>
              <Text style={styles.limitText}>{COPY.objectLimit}</Text>
              <TextInput
                maxLength={15}
                onChangeText={setMemorableObject}
                placeholder={COPY.objectPlaceholder}
                placeholderTextColor={colors.text.muted}
                style={styles.input}
                value={memorableObject}
              />
              <Text style={styles.label}>{COPY.memoryLabel}</Text>
              <Text style={styles.limitText}>{COPY.memoryLimit}</Text>
              <TextInput
                maxLength={100}
                multiline
                onChangeText={setMemoryText}
                placeholder={COPY.memoryPlaceholder}
                placeholderTextColor={colors.text.muted}
                style={[styles.input, styles.textarea]}
                textAlignVertical="top"
                value={memoryText}
              />
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <Button
                disabled={!canGenerate}
                fullWidth
                iconLeft={<MaterialIcons color={colors.text.inverse} name="auto-awesome" size={20} />}
                loading={submitting}
                onPress={() => void submit()}
              >
                {submitting ? COPY.generating : COPY.generate}
              </Button>
            </View>
          </>
        ) : null}

        {generated ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{collectionStored ? COPY.saved : COPY.resultTitle}</Text>
            {generatedImage ? <Image source={{ uri: generatedImage }} style={styles.generatedImage} /> : null}
            <Text style={styles.bodyText}>{generated.memorable_object}</Text>
            <Text style={styles.memoryText}>{generated.memory_text}</Text>
            {savedToDevice ? <Text accessibilityLiveRegion="polite" style={styles.successText}>{COPY.savedToDevice}</Text> : null}
            <Button
              disabled={!generatedImage || savingToDevice}
              fullWidth
              iconLeft={<MaterialIcons color={colors.brand.sky} name="file-download" size={20} />}
              loading={savingToDevice}
              onPress={() => void saveGeneratedImageToDevice()}
              variant="secondary"
            >
              {savingToDevice ? COPY.savingToDevice : COPY.saveToDevice}
            </Button>
            <Button
              fullWidth
              iconLeft={<MaterialIcons color={colors.text.inverse} name="home" size={20} />}
              onPress={finishGuide}
            >
              {COPY.finishGuide}
            </Button>
          </View>
        ) : null}
      </ScrollView>
      <Modal
        animationType="fade"
        onRequestClose={() => undefined}
        transparent
        visible={resultModalVisible && Boolean(generated)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <Text accessibilityRole="header" style={styles.panelTitle}>{COPY.resultTitle}</Text>
            {generatedImage ? <Image source={{ uri: generatedImage }} style={styles.generatedImage} /> : null}
            {generated ? (
              <>
                <Text style={styles.bodyText}>{generated.memorable_object}</Text>
                <Text style={styles.memoryText}>{generated.memory_text}</Text>
              </>
            ) : null}
            <Button
              fullWidth
              iconLeft={<MaterialIcons color={colors.text.inverse} name="inventory-2" size={20} />}
              onPress={keepGeneratedInCollection}
            >
              {COPY.keepInCollection}
            </Button>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

async function readURI(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  return new Uint8Array(await response.arrayBuffer());
}

function contentTypeForURI(uri: string): CapturedPhoto["contentType"] {
  const path = uri.toLocaleLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  header: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing["2xl"],
    paddingBottom: spacing["3xl"],
    borderBottomLeftRadius: 42,
    borderBottomRightRadius: 42,
    backgroundColor: colors.brand.sky,
  },
  headerTitle: { ...typography.title1, color: colors.text.inverse, textAlign: "center" },
  headerSubtitle: { ...typography.caption, color: colors.text.inverse, textAlign: "center" },
  content: { gap: spacing.lg, padding: spacing["2xl"] },
  panel: {
    width: "100%",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.default,
  },
  panelTitle: { ...typography.heading, color: colors.text.primary, textAlign: "center" },
  bodyText: { ...typography.caption, color: colors.text.secondary, textAlign: "center" },
  preview: { width: "100%", aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surface.subtle },
  emptyPreview: {
    width: "100%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surface.blueSoft,
  },
  actionRow: { gap: spacing.sm },
  label: { ...typography.captionStrong, color: colors.text.secondary },
  limitText: { ...typography.small, color: colors.text.muted, marginTop: -spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text.primary,
    backgroundColor: colors.surface.default,
    ...typography.body,
  },
  textarea: { minHeight: 116 },
  error: { ...typography.caption, color: colors.state.danger, textAlign: "center" },
  successText: { ...typography.captionStrong, color: colors.state.success, textAlign: "center" },
  generatedImage: { width: "100%", aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surface.subtle },
  memoryText: { ...typography.body, color: colors.text.primary, textAlign: "center" },
  cameraScreen: { flex: 1, backgroundColor: colors.text.black },
  camera: { flex: 1 },
  cameraControls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing["2xl"],
    paddingTop: spacing.lg,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
    backgroundColor: "rgba(15,23,42,0.58)",
  },
  modalPanel: {
    width: "100%",
    maxWidth: 390,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.default,
  },
  iconButton: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 27,
  },
  shutter: {
    width: 86,
    height: 86,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 43,
    borderWidth: 6,
    borderColor: colors.text.inverse,
    backgroundColor: colors.surface.default,
  },
  shutterText: { ...typography.captionStrong, color: colors.brand.sky },
});
