import { describe, expect, it } from "bun:test";
import {
  createDemoKeyMaterial,
  decryptDemoChatBytes,
  decryptDemoChatMessage,
  demoBytesToBase64URL,
  deriveDemoAgreementPublicKey,
  deriveDemoChatKey,
  encryptDemoChatBytes,
  encryptDemoChatPlaintext,
  isDemoRecoveryPhrase,
} from "../services/demo-crypto";

function bytes(start: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
}

function sequence(...values: Uint8Array[]): (length: number) => Promise<Uint8Array> {
  let index = 0;
  return async (length) => {
    const value = values[index++];
    if (!value || value.length !== length) throw new Error(`unexpected random request: ${length}`);
    return value.slice();
  };
}

describe("Demo crypto provider", () => {
  it("derives the separate fast Key-A/Key-B family and agreement public key", async () => {
    const material = await createDemoKeyMaterial(sequence(bytes(1, 16), bytes(17, 32)));

    expect(isDemoRecoveryPhrase(material.recoveryKey)).toBe(true);
    expect(material.recoveryKey.trim().split(/\s+/u)).toHaveLength(24);
    expect(material.keyA).toHaveLength(32);
    expect(material.keyB).toHaveLength(32);
    expect(material.salt).toHaveLength(16);
    expect(material.agreementPrivateKey).toHaveLength(32);
    expect(material.agreementPublicKey).toHaveLength(32);
    expect(demoBytesToBase64URL(material.keyA)).not.toBe(demoBytesToBase64URL(material.keyB));
    expect(demoBytesToBase64URL(material.agreementPublicKey)).toBe(
      demoBytesToBase64URL(deriveDemoAgreementPublicKey(material.agreementPrivateKey)),
    );
  });

  it("derives the same chat key on both Demo peers", async () => {
    const alice = await createDemoKeyMaterial(sequence(bytes(1, 16), bytes(17, 32)));
    const bob = await createDemoKeyMaterial(sequence(bytes(51, 16), bytes(67, 32)));

    const aliceKey = deriveDemoChatKey(alice.agreementPrivateKey, bob.agreementPublicKey, "chat-1");
    const bobKey = deriveDemoChatKey(bob.agreementPrivateKey, alice.agreementPublicKey, "chat-1");
    expect(demoBytesToBase64URL(aliceKey)).toBe(demoBytesToBase64URL(bobKey));

    aliceKey.fill(0);
    bobKey.fill(0);
  });

  it("uses demo-chat-v1 AES-GCM with bound chat and content metadata", async () => {
    const alice = await createDemoKeyMaterial(sequence(bytes(1, 16), bytes(17, 32)));
    const bob = await createDemoKeyMaterial(sequence(bytes(51, 16), bytes(67, 32)));
    const key = deriveDemoChatKey(alice.agreementPrivateKey, bob.agreementPublicKey, "chat-1");
    const encrypted = await encryptDemoChatPlaintext(
      "chat-1",
      "改札前で待ち合わせしましょう。",
      key,
      "text",
      async (length) => bytes(101, length),
    );

    expect(encrypted.algorithm).toBe("AES-256-GCM");
    expect(encrypted.key_version).toBe("demo-chat-v1");
    expect(decryptDemoChatMessage("chat-1", encrypted.ciphertext, encrypted.nonce, key, "text"))
      .toBe("改札前で待ち合わせしましょう。");
    expect(decryptDemoChatMessage("chat-2", encrypted.ciphertext, encrypted.nonce, key, "text"))
      .toBeNull();
    expect(decryptDemoChatMessage("chat-1", encrypted.ciphertext, encrypted.nonce, key, "location"))
      .toBeNull();

    key.fill(0);
  });

  it("round-trips binary Demo payloads for chat image attachments", async () => {
    const alice = await createDemoKeyMaterial(sequence(bytes(1, 16), bytes(17, 32)));
    const bob = await createDemoKeyMaterial(sequence(bytes(51, 16), bytes(67, 32)));
    const key = deriveDemoChatKey(alice.agreementPrivateKey, bob.agreementPublicKey, "chat-1");
    const image = bytes(0, 64);
    const encrypted = await encryptDemoChatBytes(
      "chat-1",
      image,
      key,
      "image",
      async (length) => bytes(151, length),
    );
    const decrypted = decryptDemoChatBytes("chat-1", encrypted.ciphertext, encrypted.nonce, key, "image");

    expect(decrypted ? Array.from(decrypted) : null).toEqual(Array.from(image));
    expect(decryptDemoChatBytes("chat-1", encrypted.ciphertext, encrypted.nonce, key, "text")).toBeNull();

    decrypted?.fill(0);
    image.fill(0);
    key.fill(0);
  });
});
