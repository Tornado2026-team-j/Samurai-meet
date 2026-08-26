import { describe, expect, it } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  createRecoveryKeyMaterial,
  createKeyMaterial,
  decryptPhotoBytes,
  deriveDataKey,
  devicePublicKey,
  encryptPhotoBytes,
  fromBase64URL,
  hashBytes,
  recoverKeyA,
  recoveryProofMessage,
  signRecoveryProof,
  signDeviceProof,
  unwrapPhotoKey,
  unwrapPhotoKeyWithAccount,
  type RandomBytes,
} from '../services/crypto';

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

describe('フロント端末Key-A envelope', () => {
  it('Recovery Keyは256ビットのBase64URL文字列として生成される', async () => {
    const material = await createKeyMaterial(testRandomBytes());

    expect(fromBase64URL(material.recoveryKey)).toHaveLength(32);
    expect(material.recoveryKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('Recovery KeyでKey-Aを復号できる', async () => {
    const material = await createKeyMaterial(testRandomBytes());
    const recovered = recoverKeyA(material.recoveryKey, material.envelope);
    expect(Array.from(recovered)).toEqual(Array.from(material.keyA));
  });

  it('違うRecovery Keyでは復号できない', async () => {
    const material = await createKeyMaterial(testRandomBytes(1));
    const other = await createKeyMaterial(testRandomBytes(10));
    expect(() => recoverKeyA(other.recoveryKey, material.envelope)).toThrow();
  });

  it('salt、nonce、data saltを暗号化境界に含める', async () => {
    const material = await createKeyMaterial(testRandomBytes());
    expect(material.envelope.kdf_params.salt.length).toBeGreaterThan(0);
    expect(material.envelope.kdf_params.data_salt.length).toBeGreaterThan(0);
    expect(material.envelope.nonce.length).toBeGreaterThan(0);

    const tampered = {
      ...material.envelope,
      kdf_params: {
        ...material.envelope.kdf_params,
        data_salt: (await createKeyMaterial(testRandomBytes(40))).envelope.kdf_params.data_salt,
      },
    };
    expect(() => recoverKeyA(material.recoveryKey, tampered)).toThrow();
  });

  it('Key-AからRecovery proof署名を作成できる', async () => {
    const material = await createKeyMaterial(testRandomBytes());
    const challenge = 'challenge-value';
    const signature = fromBase64URL(signRecoveryProof(material.keyA, 'user-1', 'v1', challenge));
    const publicKey = fromBase64URL(material.envelope.recovery_public_key);
    expect(ed25519.verify(signature, recoveryProofMessage('user-1', 'v1', challenge), publicKey)).toBe(true);
    expect(ed25519.verify(signature, recoveryProofMessage('user-1', 'v1', 'other'), publicKey)).toBe(false);
  });

  it('Key-AとKey-Bの結合鍵は入力ごとに変わる', async () => {
    const material = await createKeyMaterial(testRandomBytes());
    const keyB = new Uint8Array(32).fill(9);
    const otherKeyB = new Uint8Array(32).fill(10);
    const dataKey = deriveDataKey(material.keyA, keyB, material.envelope.kdf_params.data_salt);
    const otherDataKey = deriveDataKey(material.keyA, otherKeyB, material.envelope.kdf_params.data_salt);
    expect(Array.from(dataKey)).not.toEqual(Array.from(otherDataKey));
  });

  it('Recovery Key再生成ではKey-Aとdata saltを維持する', async () => {
    const material = await createKeyMaterial(testRandomBytes());
    const rotated = await createRecoveryKeyMaterial(material.keyA, material.envelope, testRandomBytes(80));

    expect(Array.from(recoverKeyA(rotated.recoveryKey, rotated.envelope))).toEqual(Array.from(material.keyA));
    expect(rotated.envelope.kdf_params.data_salt).toBe(material.envelope.kdf_params.data_salt);
    expect(rotated.recoveryKey).not.toBe(material.recoveryKey);
    expect(rotated.envelope.kdf_params.salt).not.toBe(material.envelope.kdf_params.salt);
    expect(rotated.envelope.encrypted_key_a).not.toBe(material.envelope.encrypted_key_a);
    expect(() => recoverKeyA(material.recoveryKey, rotated.envelope)).toThrow();
  });

  it('画像鍵はアカウント包みと端末包みを分け、端末Key-Bが違えば復号できない', async () => {
    const material = await createKeyMaterial(testRandomBytes());
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
});
