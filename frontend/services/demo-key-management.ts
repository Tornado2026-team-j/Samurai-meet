import type { Platform } from "react-native";
import { requestAPI } from "./api-client";
import type { Session } from "./auth-contract";
import {
  createDemoKeyMaterial,
  demoBase64URLToBytes,
  demoBytesToBase64URL,
  deriveDemoChatKey,
  deriveDemoAgreementPublicKey,
  type DemoKeyMaterial,
  type DemoPeerKey,
} from "./demo-crypto";

const DEMO_KEY_B_STORAGE_PREFIX = "samurai_meet_demo_key_b_v1_";
const DEMO_AGREEMENT_PRIVATE_STORAGE_PREFIX = "samurai_meet_demo_agreement_private_v1_";
const DEMO_AGREEMENT_PUBLIC_STORAGE_PREFIX = "samurai_meet_demo_agreement_public_v1_";
const DEMO_MATERIAL_DRAFT_STORAGE_PREFIX = "samurai_meet_demo_key_material_draft_v1_";

/**
 * Keep native storage modules out of the module graph for pure service
 * consumers. Storage is resolved only when a demo key is actually read or
 * written. Do not dynamically import `react-native` here: Metro's importAll
 * enumerates legacy native exports and crashes Expo Go before storage runs.
 */
function isWebPlatform(): boolean {
  try {
    // A CommonJS require is deliberately deferred until storage is used. In
    // contrast to dynamic import, Metro does not enumerate React Native's
    // deprecated native getters such as PushNotificationIOS.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require("react-native") as { Platform?: typeof Platform };
    return native.Platform?.OS === "web";
  } catch {
    return true;
  }
}

async function loadSecureStore(): Promise<typeof import("expo-secure-store")> {
  return import("expo-secure-store");
}

type DataResponse<T> = { data?: T };

type StoredDemoMaterial = {
  key_a: string;
  key_b: string;
  recovery_key: string;
  salt: string;
  agreement_private_key: string;
  agreement_public_key: string;
};

function storageSuffix(userID: string): string {
  return userID.replace(/[^A-Za-z0-9._-]/g, "_");
}

function keyBStorageKey(userID: string): string {
  return `${DEMO_KEY_B_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function agreementPrivateStorageKey(userID: string): string {
  return `${DEMO_AGREEMENT_PRIVATE_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function agreementPublicStorageKey(userID: string): string {
  return `${DEMO_AGREEMENT_PUBLIC_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

function materialDraftStorageKey(userID: string): string {
  return `${DEMO_MATERIAL_DRAFT_STORAGE_PREFIX}${storageSuffix(userID)}`;
}

async function getDeviceStoredItem(key: string): Promise<string | null> {
  if (isWebPlatform()) return globalThis.sessionStorage?.getItem(key) ?? null;
  const SecureStore = await loadSecureStore();
  return SecureStore.getItemAsync(key);
}

async function setDeviceStoredItem(key: string, value: string): Promise<void> {
  if (isWebPlatform()) {
    globalThis.sessionStorage?.setItem(key, value);
    return;
  }
  const SecureStore = await loadSecureStore();
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function deleteDeviceStoredItem(key: string): Promise<void> {
  if (isWebPlatform()) {
    globalThis.sessionStorage?.removeItem(key);
    return;
  }
  const SecureStore = await loadSecureStore();
  await SecureStore.deleteItemAsync(key);
}

function assertDemoSession(session: Session): void {
  if (session.account_type !== "demo") throw new Error("demo_account_required");
}

function validateMaterial(material: DemoKeyMaterial): void {
  if (material.keyA.length !== 32 || material.keyB.length !== 32
    || material.salt.length !== 16 || material.agreementPrivateKey.length !== 32
    || material.agreementPublicKey.length !== 32
    || demoBytesToBase64URL(material.agreementPublicKey)
      !== demoBytesToBase64URL(deriveDemoAgreementPublicKey(material.agreementPrivateKey))) {
    throw new Error("invalid_demo_key_material");
  }
}

// The private/public pair is validated by createDemoKeyMaterial and by the
// server. This lightweight local check avoids reintroducing the normal
// key-management module solely to compute a public key.
function validateStoredBytes(value: string, expectedLength: number): Uint8Array {
  const bytes = demoBase64URLToBytes(value);
  if (bytes.length !== expectedLength) throw new Error("invalid_demo_key_material");
  return bytes;
}

function serializeMaterial(material: DemoKeyMaterial): string {
  validateMaterial(material);
  const stored: StoredDemoMaterial = {
    key_a: demoBytesToBase64URL(material.keyA),
    key_b: demoBytesToBase64URL(material.keyB),
    recovery_key: material.recoveryKey,
    salt: demoBytesToBase64URL(material.salt),
    agreement_private_key: demoBytesToBase64URL(material.agreementPrivateKey),
    agreement_public_key: demoBytesToBase64URL(material.agreementPublicKey),
  };
  return JSON.stringify(stored);
}

function parseMaterial(value: string): DemoKeyMaterial | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredDemoMaterial>;
    if (typeof parsed.key_a !== "string" || typeof parsed.key_b !== "string"
      || typeof parsed.recovery_key !== "string" || typeof parsed.salt !== "string"
      || typeof parsed.agreement_private_key !== "string" || typeof parsed.agreement_public_key !== "string") {
      return null;
    }
    const material: DemoKeyMaterial = {
      keyA: validateStoredBytes(parsed.key_a, 32),
      keyB: validateStoredBytes(parsed.key_b, 32),
      recoveryKey: parsed.recovery_key,
      salt: validateStoredBytes(parsed.salt, 16),
      agreementPrivateKey: validateStoredBytes(parsed.agreement_private_key, 32),
      agreementPublicKey: validateStoredBytes(parsed.agreement_public_key, 32),
    };
    validateMaterial(material);
    return material;
  } catch {
    return null;
  }
}

export async function saveDemoKeyMaterialDraft(userID: string, material: DemoKeyMaterial): Promise<void> {
  await setDeviceStoredItem(materialDraftStorageKey(userID), serializeMaterial(material));
}

export async function loadDemoKeyMaterialDraft(userID: string): Promise<DemoKeyMaterial | null> {
  const stored = await getDeviceStoredItem(materialDraftStorageKey(userID));
  return stored ? parseMaterial(stored) : null;
}

export async function saveDemoKeyMaterial(userID: string, material: DemoKeyMaterial): Promise<void> {
  validateMaterial(material);
  await Promise.all([
    setDeviceStoredItem(keyBStorageKey(userID), demoBytesToBase64URL(material.keyB)),
    setDeviceStoredItem(agreementPrivateStorageKey(userID), demoBytesToBase64URL(material.agreementPrivateKey)),
    setDeviceStoredItem(agreementPublicStorageKey(userID), demoBytesToBase64URL(material.agreementPublicKey)),
    deleteDeviceStoredItem(materialDraftStorageKey(userID)),
  ]);
}

export async function loadStoredDemoAgreementPrivateKey(userID: string): Promise<Uint8Array | null> {
  const stored = await getDeviceStoredItem(agreementPrivateStorageKey(userID));
  if (!stored) return null;
  try {
    return validateStoredBytes(stored, 32);
  } catch {
    return null;
  }
}

export async function clearDemoKeyMaterial(userID: string): Promise<void> {
  await Promise.all([
    deleteDeviceStoredItem(keyBStorageKey(userID)),
    deleteDeviceStoredItem(agreementPrivateStorageKey(userID)),
    deleteDeviceStoredItem(agreementPublicStorageKey(userID)),
    deleteDeviceStoredItem(materialDraftStorageKey(userID)),
  ]);
}

export async function registerDemoDeviceKey(session: Session, material: DemoKeyMaterial): Promise<void> {
  assertDemoSession(session);
  validateMaterial(material);
  const response = await requestAPI<DataResponse<unknown>>(
    "/me/demo/device-key",
    session,
    {
      method: "POST",
      body: JSON.stringify({
        key_version: "demo-keyb-v1",
        public_key: demoBytesToBase64URL(material.agreementPublicKey),
      }),
    },
  );
  if (!response.data || typeof response.data !== "object") throw new Error("demo_device_key_response_invalid");
  const result = response.data as Partial<{ user_id: unknown; key_version: unknown; public_key: unknown }>;
  if (result.user_id !== session.user_id || result.key_version !== "demo-keyb-v1"
    || result.public_key !== demoBytesToBase64URL(material.agreementPublicKey)) {
    throw new Error("demo_device_key_response_invalid");
  }
}

export async function loadDemoPeerKey(
  chatID: string,
  session: Session,
  signal?: AbortSignal,
): Promise<DemoPeerKey> {
  assertDemoSession(session);
  const response = await requestAPI<DataResponse<unknown>>(
    `/chats/${encodeURIComponent(chatID)}/demo/peer-key`,
    session,
    { method: "GET", signal },
  );
  if (!response.data || typeof response.data !== "object") throw new Error("demo_peer_key_response_invalid");
  const result = response.data as Partial<DemoPeerKey>;
  if (typeof result.user_id !== "string" || !result.user_id
    || result.key_version !== "demo-keyb-v1" || typeof result.public_key !== "string") {
    throw new Error("demo_peer_key_response_invalid");
  }
  const publicKey = validateStoredBytes(result.public_key, 32);
  publicKey.fill(0);
  return result as DemoPeerKey;
}

export async function loadDemoChatKey(
  chatID: string,
  session: Session,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  assertDemoSession(session);
  const privateKey = await loadStoredDemoAgreementPrivateKey(session.user_id);
  if (!privateKey) throw new Error("demo_agreement_key_unavailable");
  try {
    const peer = await loadDemoPeerKey(chatID, session, signal);
    const publicKey = demoBase64URLToBytes(peer.public_key);
    try {
      if (publicKey.length !== 32) throw new Error("demo_peer_key_response_invalid");
      return deriveDemoChatKey(privateKey, publicKey, chatID);
    } finally {
      publicKey.fill(0);
    }
  } finally {
    privateKey.fill(0);
  }
}
