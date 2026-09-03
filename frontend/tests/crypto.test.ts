import { describe, expect, it } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  ARGON2ID_DEFAULTS,
  canonicalizeRecoveryPhrase,
  createDeviceAgreementKeyMaterial,
  createDeviceTransferVerificationCode,
  createKeyMaterial,
  createRecoveryPhraseMaterial,
  chatKeyCommitment,
  decryptChatAttachmentBytes,
  decryptPhotoBytes,
  deriveAccountDataKey,
  deviceAgreementPublicKey,
  devicePublicKey,
  encryptPhotoBytes,
  fromBase64URL,
  hashBytes,
  hashBytesHex,
  encryptChatAttachmentBytes,
  normalizeRecoveryPhrase,
  recoveryProofMessage,
  recoveryPhraseMatches,
  recoverKeyAAsync,
  signRecoveryProof,
  signDeviceProof,
  toBase64URL,
  unwrapMasterKeyForDevice,
  unwrapChatAttachmentKey,
  unwrapChatKeyForAccount,
  unwrapChatKeyForDevice,
  unwrapPhotoKey,
  unwrapPhotoKeyWithAccount,
  wrapMasterKeyForDevice,
  wrapChatAttachmentKey,
  wrapChatKeyForAccount,
  wrapChatKeyForDevice,
  CHAT_ATTACHMENT_MAX_BYTES,
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

function tamperChatAttachmentEnvelope(
  encoded: string,
  field: 'chat_id' | 'attachment_id' | 'recipient_device_id' | 'key_version',
  value: string,
): string {
  const parsed = JSON.parse(new TextDecoder().decode(fromBase64URL(encoded))) as Record<string, unknown>;
  parsed[field] = value;
  return toBase64URL(new TextEncoder().encode(JSON.stringify(parsed)));
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

  it('チャットDEKはAccount envelopeと端末envelopeで復旧できる', async () => {
    const material = await testKeyMaterial();
    const accountDataKey = deriveAccountDataKey(material.keyA, material.envelope.kdf_params.data_salt);
    const recipient = await createDeviceAgreementKeyMaterial(testRandomBytes(280));
    const chatKey = new Uint8Array(32).fill(0x42);
    const accountEnvelope = await wrapChatKeyForAccount(
      chatKey,
      accountDataKey,
      'user-1',
      'chat-1',
      testRandomBytes(285),
    );
    const deviceEnvelope = await wrapChatKeyForDevice(
      chatKey,
      recipient.publicKey,
      'chat-1',
      'user-2',
      'device-2',
      testRandomBytes(290),
    );

    expect(Array.from(unwrapChatKeyForAccount(accountEnvelope, accountDataKey, 'user-1', 'chat-1'))).toEqual(Array.from(chatKey));
    expect(Array.from(unwrapChatKeyForDevice(deviceEnvelope, recipient.privateKey, 'chat-1', 'user-2', 'device-2'))).toEqual(Array.from(chatKey));
    expect(() => unwrapChatKeyForAccount(accountEnvelope, accountDataKey, 'user-2', 'chat-1')).toThrow();
    expect(() => unwrapChatKeyForDevice(deviceEnvelope, recipient.privateKey, 'chat-1', 'user-2', 'other-device')).toThrow();
    expect(() => unwrapChatKeyForDevice(deviceEnvelope, new Uint8Array(32).fill(7), 'chat-1', 'user-2', 'device-2')).toThrow();
  });

  it('チャットDEK commitmentは鍵ごとに異なる固定長値になる', () => {
    const first = chatKeyCommitment(new Uint8Array(32).fill(0x42));
    const second = chatKeyCommitment(new Uint8Array(32).fill(0x43));
    expect(first).toHaveLength(43);
    expect(second).toHaveLength(43);
    expect(second).not.toBe(first);
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

  it('チャット画像は端末間Key B公開鍵のenvelopeでラップして往復できる', async () => {
    const recipient = await createDeviceAgreementKeyMaterial(testRandomBytes(300));
    const plaintext = new TextEncoder().encode('encrypted chat photo');
    const encrypted = await encryptChatAttachmentBytes(
      plaintext,
      'image/jpeg',
      'chat-1',
      testRandomBytes(320),
    );
    const cipherSHA256 = hashBytesHex(encrypted.ciphertext);
    const envelope = await wrapChatAttachmentKey(
      encrypted.imageKey,
      recipient.publicKey,
      'chat-1',
      'attachment-1',
      'device-1',
      cipherSHA256,
      encrypted.nonce,
      testRandomBytes(340),
    );
    const recoveredKey = unwrapChatAttachmentKey(
      envelope,
      recipient.privateKey,
      'chat-1',
      'attachment-1',
      'device-1',
      cipherSHA256,
      encrypted.nonce,
    );
    expect(Array.from(decryptChatAttachmentBytes(
      encrypted.ciphertext,
      encrypted.nonce,
      recoveredKey,
      encrypted.contentType,
      'chat-1',
    ))).toEqual(Array.from(plaintext));

    encrypted.imageKey.fill(0);
    recoveredKey.fill(0);
    expect(encrypted.imageKey.every((value) => value === 0)).toBe(true);
    expect(recoveredKey.every((value) => value === 0)).toBe(true);
  });

  it('チャット画像envelopeは別端末とchat/attachment/device/hash/nonce改ざんを拒否する', async () => {
    const recipient = await createDeviceAgreementKeyMaterial(testRandomBytes(360));
    const otherDevice = await createDeviceAgreementKeyMaterial(testRandomBytes(380));
    const encrypted = await encryptChatAttachmentBytes(
      new Uint8Array([9, 8, 7, 6]),
      'image/png',
      'chat-2',
      testRandomBytes(400),
    );
    const cipherSHA256 = hashBytesHex(encrypted.ciphertext);
    const envelope = await wrapChatAttachmentKey(
      encrypted.imageKey,
      recipient.publicKey,
      'chat-2',
      'attachment-2',
      'device-2',
      cipherSHA256,
      encrypted.nonce,
      testRandomBytes(420),
    );

    expect(() => unwrapChatAttachmentKey(
      envelope,
      otherDevice.privateKey,
      'chat-2',
      'attachment-2',
      'device-2',
      cipherSHA256,
      encrypted.nonce,
    )).toThrow();
    expect(() => unwrapChatAttachmentKey(
      envelope,
      recipient.privateKey,
      'wrong-chat',
      'attachment-2',
      'device-2',
      cipherSHA256,
      encrypted.nonce,
    )).toThrow();
    expect(() => unwrapChatAttachmentKey(
      envelope,
      recipient.privateKey,
      'chat-2',
      'wrong-attachment',
      'device-2',
      cipherSHA256,
      encrypted.nonce,
    )).toThrow();
    expect(() => unwrapChatAttachmentKey(
      envelope,
      recipient.privateKey,
      'chat-2',
      'attachment-2',
      'wrong-device',
      cipherSHA256,
      encrypted.nonce,
    )).toThrow();
    expect(() => unwrapChatAttachmentKey(
      envelope,
      recipient.privateKey,
      'chat-2',
      'attachment-2',
      'device-2',
      '0'.repeat(64),
      encrypted.nonce,
    )).toThrow();
    expect(() => unwrapChatAttachmentKey(
      envelope,
      recipient.privateKey,
      'chat-2',
      'attachment-2',
      'device-2',
      cipherSHA256,
      toBase64URL(new Uint8Array(12).fill(3)),
    )).toThrow();

    const parsed = JSON.parse(new TextDecoder().decode(fromBase64URL(envelope))) as Record<string, unknown>;
    parsed.cipher_sha256 = '0'.repeat(64);
    const tampered = toBase64URL(new TextEncoder().encode(JSON.stringify(parsed)));
    expect(() => unwrapChatAttachmentKey(
      tampered,
      recipient.privateKey,
      'chat-2',
      'attachment-2',
      'device-2',
      cipherSHA256,
      encrypted.nonce,
    )).toThrow();

    expect(() => unwrapChatAttachmentKey(
      tamperChatAttachmentEnvelope(envelope, 'chat_id', 'tampered-chat'),
      recipient.privateKey,
      'tampered-chat',
      'attachment-2',
      'device-2',
      cipherSHA256,
      encrypted.nonce,
    )).toThrow();
    expect(() => unwrapChatAttachmentKey(
      tamperChatAttachmentEnvelope(envelope, 'attachment_id', 'tampered-attachment'),
      recipient.privateKey,
      'chat-2',
      'tampered-attachment',
      'device-2',
      cipherSHA256,
      encrypted.nonce,
    )).toThrow();
    expect(() => unwrapChatAttachmentKey(
      tamperChatAttachmentEnvelope(envelope, 'recipient_device_id', 'tampered-device'),
      recipient.privateKey,
      'chat-2',
      'attachment-2',
      'tampered-device',
      cipherSHA256,
      encrypted.nonce,
    )).toThrow();
  });

  it('legacy envelope・unsupported MIME・超過サイズを拒否する', async () => {
    const recipient = await createDeviceAgreementKeyMaterial(testRandomBytes(440));
    const encrypted = await encryptChatAttachmentBytes(
      new Uint8Array([5, 4, 3, 2, 1]),
      'image/webp',
      'chat-legacy',
      testRandomBytes(450),
    );
    const cipherSHA256 = hashBytesHex(encrypted.ciphertext);
    const envelope = await wrapChatAttachmentKey(
      encrypted.imageKey,
      recipient.publicKey,
      'chat-legacy',
      'attachment-legacy',
      'device-legacy',
      cipherSHA256,
      encrypted.nonce,
      testRandomBytes(460),
    );

    expect(() => unwrapChatAttachmentKey(
      tamperChatAttachmentEnvelope(envelope, 'key_version', 'chat-attachment-mvp-v1'),
      recipient.privateKey,
      'chat-legacy',
      'attachment-legacy',
      'device-legacy',
      cipherSHA256,
      encrypted.nonce,
    )).toThrow();
    await expect(encryptChatAttachmentBytes(
      new Uint8Array([1, 2, 3]),
      'image/gif' as never,
      'chat-unsupported-mime',
      testRandomBytes(470),
    )).rejects.toThrow();
    expect(() => decryptChatAttachmentBytes(
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.imageKey,
      'image/gif' as never,
      'chat-legacy',
    )).toThrow();
    await expect(encryptChatAttachmentBytes(
      new Uint8Array(CHAT_ATTACHMENT_MAX_BYTES - 15),
      'image/png',
      'chat-too-large',
      testRandomBytes(480),
    )).rejects.toThrow();
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
