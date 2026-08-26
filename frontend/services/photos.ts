import { API_BASE_URL } from './api-config';
import type { Session } from './auth-contract';
import {
  decryptPhotoBytes,
  encryptPhotoBytes,
  unwrapPhotoKey,
  unwrapPhotoKeyWithAccount,
  wrapPhotoKeyForDevice,
  type EncryptedPhotoMaterial,
} from './crypto';
import {
  createDeviceProofHeaders,
  loadStoredDeviceKeyB,
  type DeviceKeyMaterial,
} from './key-management';

const PHOTO_REQUEST_TIMEOUT_MS = 30_000;
const PHOTO_KEY_VERSION = 'v1';
const DEVICE_IMAGE_KEY_AAD_PREFIX = 'samurai-meet:image-key-wrap/v1\ndevice\n';

export type PhotoMetadata = {
  id: string;
  visibility: 'private' | 'profile';
  content_type: string;
  size_bytes: number;
  cipher_sha256: string;
  nonce: string;
  algorithm: string;
  key_version: string;
  wrapped_image_key: string;
  account_wrapped_image_key?: string;
  wrapping_algorithm: string;
  created_at: string;
};

export type UploadPhotoOptions = {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/octet-stream';
  visibility: 'private' | 'profile';
  keyA: Uint8Array;
  dataSalt: string;
  serverWrappedKey?: string;
};

export type DownloadedPhoto = {
  ciphertext: Uint8Array;
  nonce: string;
  algorithm: string;
  keyVersion: string;
  deviceWrappedImageKey: string;
  accountWrappedImageKey: string;
  wrappingAlgorithm: string;
};

async function request(path: string, init: RequestInit, token: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutID = setTimeout(() => controller.abort(), PHOTO_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'AbortError') {
      throw new Error('画像通信がタイムアウトしました。接続を確認して再試行してください。');
    }
    throw reason;
  } finally {
    clearTimeout(timeoutID);
  }
}

async function assertResponse(response: Response): Promise<void> {
  if (response.ok) return;
  let error = 'request failed';
  try {
    const body = await response.json() as { error?: string };
    error = body.error ?? error;
  } catch {
    // Keep transport/status details out of the user-facing crypto flow.
  }
  throw new Error(`${response.status}: ${error}`);
}

export async function uploadEncryptedPhoto(
  session: Session,
  plaintext: Uint8Array,
  options: UploadPhotoOptions,
): Promise<{ photo: PhotoMetadata; device: DeviceKeyMaterial; encrypted: EncryptedPhotoMaterial }> {
  const device = await loadStoredDeviceKeyB(session.user_id);
  if (!device) throw new Error('この端末の暗号鍵が登録されていません。Passkeyで再認証してください。');
  const encrypted = await encryptPhotoBytes(plaintext, options.keyA, device.keyB, options.dataSalt, device.deviceID);
  const path = '/api/v1/me/photos';
  const proofHeaders = await createDeviceProofHeaders(session, device, 'POST', path, encrypted.ciphertext);
  const headers: Record<string, string> = {
    ...proofHeaders,
    'Content-Type': 'application/octet-stream',
    'X-Photo-Visibility': options.visibility,
    'X-Photo-Content-Type': options.contentType,
    'X-Photo-Nonce': encrypted.nonce,
    'X-Photo-Algorithm': 'AES-256-GCM',
    'X-Photo-Key-Version': encrypted.keyVersion,
    'X-Photo-Wrapped-Key': encrypted.deviceWrappedImageKey,
    'X-Photo-Account-Wrapped-Key': encrypted.accountWrappedImageKey,
    'X-Photo-Device-ID': device.deviceID,
    'X-Photo-Wrapping-Algorithm': encrypted.wrappingAlgorithm,
  };
  if (options.serverWrappedKey) headers['X-Photo-Server-Wrapped-Key'] = options.serverWrappedKey;
  const response = await request('/me/photos', { method: 'POST', headers, body: encrypted.ciphertext as unknown as BodyInit }, session.access_token);
  await assertResponse(response);
  const body = await response.json() as { data?: PhotoMetadata };
  if (!body.data?.id) throw new Error('画像アップロード応答が不正です。');
  return { photo: body.data, device, encrypted };
}

export async function downloadEncryptedPhoto(session: Session, photoID: string): Promise<{ photo: DownloadedPhoto; device: DeviceKeyMaterial }> {
  const device = await loadStoredDeviceKeyB(session.user_id);
  if (!device) throw new Error('この端末の暗号鍵が登録されていません。Passkeyで再認証してください。');
  const path = `/api/v1/me/photos/${encodeURIComponent(photoID)}`;
  const proofHeaders = await createDeviceProofHeaders(session, device, 'GET', path);
  const response = await request(`/me/photos/${encodeURIComponent(photoID)}`, {
    method: 'GET',
    headers: { ...proofHeaders, 'X-Photo-Device-ID': device.deviceID },
  }, session.access_token);
  await assertResponse(response);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  const nonce = response.headers.get('X-Photo-Nonce');
  const algorithm = response.headers.get('X-Photo-Algorithm');
  const keyVersion = response.headers.get('X-Photo-Key-Version');
  const deviceWrappedImageKey = response.headers.get('X-Photo-Wrapped-Key') ?? '';
  const accountWrappedImageKey = response.headers.get('X-Photo-Account-Wrapped-Key') ?? '';
  const wrappingAlgorithm = response.headers.get('X-Photo-Wrapping-Algorithm');
  if (!nonce || !algorithm || !keyVersion || !wrappingAlgorithm || !accountWrappedImageKey) {
    throw new Error('画像の暗号メタデータが不正です。');
  }
  return {
    photo: { ciphertext, nonce, algorithm, keyVersion, deviceWrappedImageKey, accountWrappedImageKey, wrappingAlgorithm },
    device,
  };
}

export async function downloadAndDecryptPhoto(
  session: Session,
  photoID: string,
  keyA: Uint8Array,
  dataSalt: string,
): Promise<Uint8Array> {
  const downloaded = await downloadEncryptedPhoto(session, photoID);
  let imageKey: Uint8Array;
  if (downloaded.photo.deviceWrappedImageKey) {
    imageKey = unwrapPhotoKey(
      downloaded.photo.deviceWrappedImageKey,
      downloaded.device.keyB,
      `${DEVICE_IMAGE_KEY_AAD_PREFIX}${downloaded.device.deviceID}`,
    );
  } else {
    imageKey = unwrapPhotoKeyWithAccount(downloaded.photo.accountWrappedImageKey, keyA, dataSalt);
    const deviceWrappedImageKey = await wrapPhotoKeyForDevice(imageKey, downloaded.device.keyB, downloaded.device.deviceID);
    await savePhotoDeviceEnvelope(session, photoID, downloaded.device, deviceWrappedImageKey, downloaded.photo.wrappingAlgorithm);
  }
  return decryptPhotoBytes(downloaded.photo.ciphertext, downloaded.photo.nonce, imageKey);
}

export async function savePhotoDeviceEnvelope(
  session: Session,
  photoID: string,
  device: DeviceKeyMaterial,
  wrappedImageKey: string,
  wrappingAlgorithm = 'KEY-B-AES-GCM',
): Promise<void> {
  const body = JSON.stringify({
    key_version: PHOTO_KEY_VERSION,
    wrapped_image_key: wrappedImageKey,
    wrapping_algorithm: wrappingAlgorithm,
  });
  const path = `/api/v1/me/photos/${encodeURIComponent(photoID)}/key-envelope`;
  const proofHeaders = await createDeviceProofHeaders(session, device, 'PUT', path, new TextEncoder().encode(body));
  const response = await request(`/me/photos/${encodeURIComponent(photoID)}/key-envelope`, {
    method: 'PUT',
    headers: {
      ...proofHeaders,
      'Content-Type': 'application/json',
      'X-Photo-Device-ID': device.deviceID,
    },
    body,
  }, session.access_token);
  await assertResponse(response);
}
