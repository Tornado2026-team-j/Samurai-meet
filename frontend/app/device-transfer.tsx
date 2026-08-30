import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Header, colors, opacity, radius, spacing, typography } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import {
  acceptDeviceTransfer,
  approveDeviceTransfer,
  beginDeviceTransfer,
  getDeviceTransferForTarget,
  listDeviceTransfers,
  listRegisteredDevices,
  loadDeviceTransferDraft,
  loadStoredDeviceKeyB,
  loadStoredKeyA,
  type DeviceTransfer,
  type DeviceTransferDraft,
  type RegisteredDevice,
} from "../services/key-management";
import { loadLanguage, type AppLanguage } from "../services/onboarding";

const COPY = {
  ja: {
    title: "端末引き継ぎ",
    description: "Recovery Phraseを入力せず、ログイン済みの旧端末から暗号鍵を安全に引き継げます。",
    newDevice: "新しい端末",
    newDescription: "新しい端末で引き継ぎを開始し、表示された確認コードを旧端末へ入力します。",
    start: "この端末への引き継ぎを開始",
    transferId: "引き継ぎID",
    code: "確認コード",
    copy: "コピー",
    copied: "コピーしました",
    waiting: "旧端末で承認したあと、下のボタンを押してください。",
    receive: "承認済みの鍵を受け取る",
    received: "この端末への引き継ぎが完了しました。",
    oldDevice: "旧端末",
    registeredDevices: "暗号鍵を登録した端末",
    currentDevice: "この端末",
    lastSeen: "最終利用",
    oldDescription: "この端末に暗号鍵が保存されている場合、新しい端末からの申請を承認できます。",
    loadRequests: "Passkeyで確認して申請を読み込む",
    noRequests: "承認待ちの申請はありません。",
    codePlaceholder: "確認コードを入力",
    approve: "この端末から承認",
    approved: "承認しました。新しい端末で受け取ってください。",
    sourceUnavailable: "この端末には引き継ぐ暗号鍵がありません。旧端末またはRecovery Phraseを使用してください。",
    processing: "処理中...",
    error: "端末引き継ぎを完了できませんでした。コードと通信状況を確認してください。",
    pending: "旧端末の承認を待っています。",
  },
  en: {
    title: "Transfer device",
    description: "Securely transfer your encryption key from an old signed-in device without entering the Recovery Phrase.",
    newDevice: "New device",
    newDescription: "Start on the new device, then enter the displayed verification code on the old device.",
    start: "Start transfer to this device",
    transferId: "Transfer ID",
    code: "Verification code",
    copy: "Copy",
    copied: "Copied",
    waiting: "Approve on the old device, then use the button below.",
    receive: "Receive approved key",
    received: "Transfer to this device is complete.",
    oldDevice: "Old device",
    registeredDevices: "Devices with encryption keys",
    currentDevice: "This device",
    lastSeen: "Last active",
    oldDescription: "If this device has the encryption key, it can approve requests from a new device.",
    loadRequests: "Verify with Passkey and load requests",
    noRequests: "There are no requests waiting for approval.",
    codePlaceholder: "Enter verification code",
    approve: "Approve from this device",
    approved: "Approved. Receive the key on the new device.",
    sourceUnavailable: "This device does not have the encryption key. Use the old device or Recovery Phrase.",
    processing: "Processing...",
    error: "The device transfer could not be completed. Check the code and connection.",
    pending: "Waiting for approval on the old device.",
  },
} as const;

export default function DeviceTransferScreen() {
  const router = useRouter();
  const { continuePasskey, getCurrentSession, session } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const [draft, setDraft] = useState<DeviceTransferDraft | null>(null);
  const [targetTransfer, setTargetTransfer] = useState<DeviceTransfer | null>(null);
  const [requests, setRequests] = useState<DeviceTransfer[]>([]);
  const [registeredDevices, setRegisteredDevices] = useState<RegisteredDevice[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [hasSourceKey, setHasSourceKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[language];

  useEffect(() => {
    const userId = session?.user_id;
    if (!userId) return;
    void Promise.all([
      loadLanguage(),
      loadDeviceTransferDraft(userId),
      loadStoredDeviceKeyB(userId),
      loadStoredKeyA(userId),
    ]).then(([storedLanguage, storedDraft, device, keyA]) => {
      setLanguage(storedLanguage ?? "ja");
      setDraft(storedDraft);
      setCurrentDeviceId(device?.deviceID ?? null);
      setHasSourceKey(Boolean(keyA));
    });
  }, [session?.user_id]);

  const pendingRequests = useMemo(() => requests.filter((item) => (
    item.status === "pending" && item.target_device_id !== currentDeviceId
  )), [currentDeviceId, requests]);

  const verify = async () => {
    const verified = await continuePasskey(language);
    const activeSession = getCurrentSession() ?? session;
    if (!verified || !activeSession) throw new Error("reauthentication failed");
    return activeSession;
  };

  const startTransfer = async () => {
    if (busy) return;
    setBusy("start");
    setError(null);
    setMessage(null);
    try {
      const activeSession = await verify();
      const result = await beginDeviceTransfer(activeSession);
      setDraft({
        transferID: result.transfer.id,
        verificationCode: result.verificationCode,
        targetDeviceID: result.device.deviceID,
        createdAt: result.transfer.created_at,
      });
      setTargetTransfer(result.transfer);
      setCurrentDeviceId(result.device.deviceID);
      setHasSourceKey(Boolean(await loadStoredKeyA(activeSession.user_id)));
    } catch {
      setError(copy.error);
    } finally {
      setBusy(null);
    }
  };

  const receiveTransfer = async () => {
    if (!draft || busy) return;
    setBusy("receive");
    setError(null);
    setMessage(null);
    try {
      const activeSession = await verify();
      const current = await getDeviceTransferForTarget(activeSession, draft.transferID);
      setTargetTransfer(current);
      if (current.status === "pending") {
        setMessage(copy.pending);
        return;
      }
      await acceptDeviceTransfer(activeSession, draft.transferID);
      setHasSourceKey(true);
      setTargetTransfer({ ...current, status: "completed" });
      setMessage(copy.received);
    } catch {
      setError(copy.error);
    } finally {
      setBusy(null);
    }
  };

  const loadRequests = async () => {
    if (busy) return;
    setBusy("load");
    setError(null);
    setMessage(null);
    try {
      const activeSession = await verify();
      const [nextRequests, nextDevices, keyA, device] = await Promise.all([
        listDeviceTransfers(activeSession),
        listRegisteredDevices(activeSession),
        loadStoredKeyA(activeSession.user_id),
        loadStoredDeviceKeyB(activeSession.user_id),
      ]);
      setRequests(nextRequests);
      setRegisteredDevices(nextDevices);
      setHasSourceKey(Boolean(keyA));
      setCurrentDeviceId(device?.deviceID ?? null);
    } catch {
      setError(copy.error);
    } finally {
      setBusy(null);
    }
  };

  const approve = async (transfer: DeviceTransfer) => {
    if (busy) return;
    setBusy(transfer.id);
    setError(null);
    setMessage(null);
    try {
      const activeSession = await verify();
      const keyA = await loadStoredKeyA(activeSession.user_id);
      if (!keyA) throw new Error("source key unavailable");
      const approved = await approveDeviceTransfer(activeSession, transfer, codes[transfer.id] ?? "", keyA);
      setRequests((current) => current.map((item) => item.id === transfer.id ? approved : item));
      setMessage(copy.approved);
    } catch {
      setError(copy.error);
    } finally {
      setBusy(null);
    }
  };

  const copyValue = async (value: string) => {
    await Clipboard.setStringAsync(value);
    setMessage(copy.copied);
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="devices-other" onBack={() => router.back()} title={copy.title} variant="hero" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.description}>{copy.description}</Text>

        <Section icon="phone-iphone" title={copy.newDevice}>
          <Text style={styles.sectionDescription}>{copy.newDescription}</Text>
          {!draft ? (
            <PrimaryButton busy={busy === "start"} label={copy.start} onPress={() => void startTransfer()} />
          ) : (
            <>
              <ValueRow label={copy.transferId} onCopy={() => void copyValue(draft.transferID)} value={draft.transferID} copyLabel={copy.copy} />
              <ValueRow label={copy.code} onCopy={() => void copyValue(draft.verificationCode)} value={draft.verificationCode} copyLabel={copy.copy} prominent />
              <Text style={styles.note}>{copy.waiting}</Text>
              {targetTransfer?.status !== "completed" ? <PrimaryButton busy={busy === "receive"} label={copy.receive} onPress={() => void receiveTransfer()} /> : null}
            </>
          )}
        </Section>

        <Section icon="smartphone" title={copy.oldDevice}>
          <Text style={styles.sectionDescription}>{copy.oldDescription}</Text>
          <SecondaryButton busy={busy === "load"} label={copy.loadRequests} onPress={() => void loadRequests()} />
          {!hasSourceKey && requests.length > 0 ? <Text style={styles.warning}>{copy.sourceUnavailable}</Text> : null}
          {requests.length > 0 && pendingRequests.length === 0 ? <Text style={styles.empty}>{copy.noRequests}</Text> : null}
          {pendingRequests.map((item) => (
            <View key={item.id} style={styles.request}>
              <Text numberOfLines={1} style={styles.requestId}>{item.id}</Text>
              <TextInput
                accessibilityLabel={copy.codePlaceholder}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={16}
                onChangeText={(value) => setCodes((current) => ({ ...current, [item.id]: value.toUpperCase().replace(/\s/gu, "") }))}
                placeholder={copy.codePlaceholder}
                placeholderTextColor={colors.text.muted}
                style={styles.input}
                value={codes[item.id] ?? ""}
              />
              <PrimaryButton
                busy={busy === item.id}
                disabled={!hasSourceKey || !(codes[item.id] ?? "").trim()}
                label={copy.approve}
                onPress={() => void approve(item)}
              />
            </View>
          ))}
        </Section>

        {registeredDevices.length > 0 ? (
          <Section icon="smartphone" title={copy.registeredDevices}>
            {registeredDevices.map((item) => (
              <View key={item.device_id} style={styles.deviceRow}>
                <View style={styles.deviceIcon}><MaterialIcons color={colors.brand.sky} name="smartphone" size={20} /></View>
                <View style={styles.deviceBody}>
                  <Text numberOfLines={1} style={styles.deviceId}>{item.device_id}</Text>
                  <Text style={styles.deviceMeta}>{copy.lastSeen}: {new Date(item.last_seen_at).toLocaleString(language === "ja" ? "ja-JP" : "en-US")}</Text>
                </View>
                {item.device_id === currentDeviceId ? <Text style={styles.currentBadge}>{copy.currentDevice}</Text> : null}
              </View>
            ))}
          </Section>
        ) : null}

        {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

function Section({ children, icon, title }: { children: React.ReactNode; icon: "phone-iphone" | "smartphone"; title: string }) {
  return <View style={styles.section}><View style={styles.sectionTitle}><MaterialIcons color={colors.brand.sky} name={icon} size={23} /><Text style={styles.sectionTitleText}>{title}</Text></View>{children}</View>;
}

function ValueRow({ copyLabel, label, onCopy, prominent = false, value }: { copyLabel: string; label: string; onCopy: () => void; prominent?: boolean; value: string }) {
  return <View style={styles.valueBlock}><Text style={styles.valueLabel}>{label}</Text><View style={styles.valueRow}><Text selectable style={[styles.value, prominent && styles.valueProminent]}>{value}</Text><Pressable onPress={onCopy} style={styles.copyButton}><MaterialIcons color={colors.brand.sky} name="content-copy" size={17} /><Text style={styles.copyText}>{copyLabel}</Text></Pressable></View></View>;
}

function PrimaryButton({ busy, disabled = false, label, onPress }: { busy: boolean; disabled?: boolean; label: string; onPress: () => void }) {
  return <Pressable disabled={busy || disabled} onPress={onPress} style={({ pressed }) => [styles.primary, (busy || disabled) && styles.disabled, pressed && styles.pressed]}>{busy ? <ActivityIndicator color={colors.text.inverse} /> : <Text style={styles.primaryText}>{label}</Text>}</Pressable>;
}

function SecondaryButton({ busy, label, onPress }: { busy: boolean; label: string; onPress: () => void }) {
  return <Pressable disabled={busy} onPress={onPress} style={({ pressed }) => [styles.secondary, busy && styles.disabled, pressed && styles.pressed]}>{busy ? <ActivityIndicator color={colors.brand.sky} /> : <Text style={styles.secondaryText}>{label}</Text>}</Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { padding: spacing.xl, paddingBottom: 130, gap: spacing.lg },
  description: { color: colors.text.secondary, ...typography.body, lineHeight: 23 },
  section: { gap: spacing.md, paddingVertical: spacing.sm },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitleText: { color: colors.text.primary, ...typography.heading },
  sectionDescription: { color: colors.text.subtle, ...typography.caption, lineHeight: 20 },
  valueBlock: { gap: spacing.xs },
  valueLabel: { color: colors.text.subtle, ...typography.smallStrong },
  valueRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.md, backgroundColor: colors.surface.subtle },
  value: { flex: 1, color: colors.text.secondary, ...typography.small },
  valueProminent: { color: colors.text.primary, fontSize: 22, lineHeight: 28, fontWeight: "900", letterSpacing: 0 },
  copyButton: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm },
  copyText: { color: colors.brand.sky, ...typography.smallStrong },
  note: { color: colors.text.subtle, ...typography.small, lineHeight: 18 },
  warning: { color: colors.state.warning, ...typography.caption, lineHeight: 20 },
  request: { gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  requestId: { color: colors.text.muted, ...typography.micro },
  deviceRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  deviceIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface.blueSoft },
  deviceBody: { flex: 1, gap: spacing.xs },
  deviceId: { color: colors.text.secondary, ...typography.smallStrong },
  deviceMeta: { color: colors.text.muted, ...typography.micro },
  currentBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface.blueSoft, color: colors.brand.sky, ...typography.micro },
  input: { minHeight: 48, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border.default, borderRadius: radius.md, backgroundColor: colors.surface.default, color: colors.text.primary, ...typography.bodyStrong },
  primary: { minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.brand.sky },
  primaryText: { color: colors.text.inverse, ...typography.body },
  secondary: { minHeight: 46, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border.blueStrong, borderRadius: radius.pill, backgroundColor: colors.surface.default },
  secondaryText: { color: colors.brand.sky, ...typography.captionStrong },
  success: { color: colors.state.success, ...typography.caption, textAlign: "center" },
  error: { color: colors.state.danger, ...typography.caption, textAlign: "center" },
  empty: { paddingVertical: spacing.lg, color: colors.text.muted, ...typography.caption, textAlign: "center" },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: opacity.pressed },
});
