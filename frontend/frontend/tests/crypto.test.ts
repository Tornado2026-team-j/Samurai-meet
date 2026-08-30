import { describe, expect, it } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  ARGON2ID_DEFAULTS,
  canonicalizeRecoveryPhrase,
  createDeviceAgreementKeyMaterial,
  createDeviceTransferVerificationCode,
  createKeyMaterial,
  createRecoveryPhraseMaterial,
  decryptPhotoBytes,
  deriveAccountDataKey,
  deviceAgreementPublicKey,
  devicePublicKey,
  encryptPhotoBytes,
  fromBase64URL,
  hashBytes,
  normalizeRecoveryPhrase,
  recoveryProofMessage,
  recoveryPhraseMatches,
  recoverKeyAAsync,
  signRecoveryProof,
  signDeviceProof,
  unwrapMasterKeyForDevice,
  unwrapPhotoKey,
  unwrapPhotoKeyWithAccount,
  wrapMasterKeyForDevice,
  type Argon2idParams,
  type RandomBytes,
} from '../services/crypto';

const TEST_ARGON2ID: Argon2idParams = {
  memory_kib: 8192,
  iterations: 1,
  parallelism: 1,
};

function testRandomBytes(start = 1): RandomBytes {
  let seed = start;
  return async (length) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = (seed * 31 + index) % 256;
    }
    seed += 1;
    return bytes;
  };
}

async function testKeyMaterial(start = 1) {
  return createKeyMaterial(testRandomBytes(start), TEST_ARGON2ID);
}

describe('フロント端末所有Master Key envelope', () => {
  it('Recovery Phraseの安全なKDFパラメータを維持する', () => {
    expect(ARGON2ID_DEFAULTS).toEqual({
      memory_kib: 32 * 1024,
      iterations: 3,
      parallelism: 1,
    });
  });

  it('Recovery Phraseは256ビットentropy由来の24語で生成される', async () => {
    const material = await testKeyMaterial();

    expect(material.envelope.key_version).toBe('v2');
    expect(material.recoveryPhrase).toBe(material.recoveryKey);
    expect(material.recoveryKey.trim().split(/\s+/u)).toHaveLength(24);
    expect(material.envelope.kdf_params.algorithm).toBe('Argon2id+HKDF-SHA256');
  });

  it('コピーした改行・不可視文字を含む24語を同じPhraseとして扱う', async () => {
    const material = await testKeyMaterial();
    const copied = `\uFEFF${material.recoveryKey.replaceAll(' ', '\n\u200B')}`;

    expect(canonicalizeRecoveryPhrase(copied)).toBe(material.recoveryKey);
    expect(recoveryPhraseMatches(material.recoveryKey, copied)).toBe(true);
    expect(normalizeRecoveryPhrase(copied)).toBe(material.recoveryKey);
  });

  it('Recovery PhraseでMaster Keyを端末内復号できる', async () => {
    const material = await testKeyMaterial();
    const recovered = await recoverKeyAAsync(material.recoveryKey, material.envelope);
    expect(Array.from(recovered)).toEqual(Array.from(material.keyA));
  });

  it('違うRecovery Phraseでは復号できない', async () => {
    const material = await testKeyMaterial(1);
    const other = await testKeyMaterial(10);
    await expect(recoverKeyAAsync(other.recoveryKey, material.envelope)).rejects.toThrow();
  });

  it('salt、nonce、data saltを暗号化境界に含める', async () => {
    const material = await testKeyMaterial();
    expect(material.envelope.kdf_params.salt.length).toBeGreaterThan(0);
    expect(material.envelope.kdf_params.data_salt.length).toBeGreaterThan(0);
    expect(material.envelope.nonce.length).toBeGreaterThan(0);

    const other = await testKeyMaterial(40);
    const tampered = {
      ...material.envelope,
      kdf_params: {
        ...material.envelope.kdf_params,
        data_salt: other.envelope.kdf_params.data_salt,
      },
    };
    await expect(recoverKeyAAsync(material.recoveryKey, tampered)).rejects.toThrow();
  });

  it('Master KeyからRecovery Phraseを再生成してdata saltを維持する', async () => {
    const material = await testKeyMaterial();
    const rotated = await createRecoveryPhraseMaterial(material.keyA, material.envelope, testRandomBytes(80));

    expect(Array.from(await recoverKeyAAsync(rotated.recoveryKey, rotated.envelope))).toEqual(Array.from(material.keyA));
    expect(rotated.envelope.kdf_params.data_salt).toBe(material.envelope.kdf_params.data_salt);
    expect(rotated.recoveryKey).not.toBe(material.recoveryKey);
    expect(rotated.envelope.kdf_params.salt).not.toBe(material.envelope.kdf_params.salt);
    expect(rotated.envelope.encrypted_key_a).not.toBe(material.envelope.encrypted_key_a);
    await expect(recoverKeyAAsync(material.recoveryKey, rotated.envelope)).rejects.toThrow();
  });

  it('アカウントrootは端末Key-Bに依存しない', async () => {
    const material = await testKeyMaterial();
    const root = deriveAccountDataKey(material.keyA, material.envelope.kdf_params.data_salt);
    const sameRoot = deriveAccountDataKey(material.keyA, material.envelope.kdf_params.data_salt);
    expect(Array.from(root)).toEqual(Array.from(sameRoot));
  });

  it('画像鍵はアカウント包みと端末包みを分ける', async () => {
    const material = await testKeyMaterial();
    const keyB = new Uint8Array(32).fill(21);
    const otherKeyB = new Uint8Array(32).fill(22);
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    const encrypted = await encryptPhotoBytes(
      plaintext,
      material.keyA,
      keyB,
      material.envelope.kdf_params.data_salt,
      'device-a',
      testRandomBytes(100),
    );
    const imageKey = unwrapPhotoKey(encrypted.deviceWrappedImageKey, keyB, 'samurai-meet:image-key-wrap/v1\ndevice\ndevice-a');
    expect(Array.from(decryptPhotoBytes(encrypted.ciphertext, encrypted.nonce, imageKey))).toEqual(Array.from(plaintext));
    expect(() => unwrapPhotoKey(encrypted.deviceWrappedImageKey, otherKeyB, 'samurai-meet:image-key-wrap/v1\ndevice\ndevice-a')).toThrow();
    const recoveredImageKey = unwrapPhotoKeyWithAccount(encrypted.accountWrappedImageKey, material.keyA, material.envelope.kdf_params.data_salt);
    expect(Array.from(recoveredImageKey)).toEqual(Array.from(imageKey));
  });

  it('端末Key-Bから導出した公開鍵でリクエスト署名を検証できる', () => {
    const keyB = new Uint8Array(32).fill(31);
    const bodyHash = hashBytes(new Uint8Array([1, 2, 3]));
    const timestamp = '2026-08-26T00:00:00.000Z';
    const nonce = 'bm9uY2U';
    const signature = fromBase64URL(signDeviceProof(keyB, 'user-1', 'device-a', 'GET', '/api/v1/me/photos/p1', timestamp, nonce, bodyHash));
    expect(ed25519.verify(
      signature,
      new TextEncoder().encode(`samurai-meet:device-proof/v1\nuser-1\ndevice-a\nGET\n/api/v1/me/photos/p1\n${timestamp}\n${nonce}\n${bodyHash}`),
      fromBase64URL(devicePublicKey(keyB)),
    )).toBe(true);
  });

  it('端末間移行はX25519でMaster Keyだけを新端末公開鍵へ包む', async () => {
    const material = await testKeyMaterial();
    const target = await createDeviceAgreementKeyMaterial(testRandomBytes(200));
    const wrapped = await wrapMasterKeyForDevice(material.keyA, target.publicKey, 'transfer-1', 'target-device', testRandomBytes(220));
    const recovered = unwrapMasterKeyForDevice(wrapped, target.privateKey, 'transfer-1', 'target-device');
    expect(Array.from(recovered)).toEqual(Array.from(material.keyA));
    expect(deviceAgreementPublicKey(target.privateKey)).toBe(target.publicKey);
    const other = await createDeviceAgreementKeyMaterial(testRandomBytes(240));
    expect(() => unwrapMasterKeyForDevice(wrapped, other.privateKey, 'transfer-1', 'target-device')).toThrow();
  });

  it('端末移行確認コードは曖昧文字を含まない8文字', async () => {
    const code = await createDeviceTransferVerificationCode(testRandomBytes());
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('Recovery proofはv2 root protocolへ署名する', async () => {
    const material = await testKeyMaterial();
    const challenge = 'challenge-value';
    const signature = fromBase64URL(signRecoveryProof(material.keyA, 'user-1', 'v2', challenge));
    const publicKey = fromBase64URL(material.envelope.recovery_public_key);
    expect(ed25519.verify(signature, recoveryProofMessage('user-1', 'v2', challenge), publicKey)).toBe(true);
    expect(ed25519.verify(signature, recoveryProofMessage('user-1', 'v2', 'other'), publicKey)).toBe(false);
  });
});
