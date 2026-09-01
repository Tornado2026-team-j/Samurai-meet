import { describe, expect, it } from "bun:test";
import {
  canUseChatAttachmentEncryption,
  ChatAttachmentCryptoUnavailableError,
  ensureChatAttachmentEncryptionAvailable,
  isChatAttachmentCryptoUnavailable,
  secureRandomUUID,
  sha256Base64,
  type NativeModuleLoader,
} from "../services/runtime-crypto";

function nativeLoader(expoCrypto: unknown): NativeModuleLoader {
  return async (moduleName) => {
    if (moduleName === "ExpoCrypto") {
      return expoCrypto;
    }
    return null;
  };
}

describe("runtime crypto capability gate", () => {
  it("calculates the OAuth SHA-256 challenge without importing expo-crypto", () => {
    expect(sha256Base64("abc")).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  });

  it("uses a UUID-shaped value from a secure runtime source", async () => {
    await expect(secureRandomUUID()).resolves.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it("allows image attachments when ExpoCrypto provides secure randomness", async () => {
    await expect(canUseChatAttachmentEncryption({
      globalRandomSource: null,
      nativeModuleLoader: nativeLoader({ getRandomValues: (bytes: Uint8Array) => bytes.fill(7) }),
    })).resolves.toBe(true);
  });

  it("does not require the optional ExpoCryptoAES module", async () => {
    const requested: string[] = [];
    await expect(canUseChatAttachmentEncryption({
      globalRandomSource: null,
      nativeModuleLoader: async (moduleName) => {
        requested.push(moduleName);
        return moduleName === "ExpoCrypto" ? { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } : null;
      },
    })).resolves.toBe(true);
    expect(requested).toEqual(["ExpoCrypto"]);
  });

  it("fails closed only when no secure random source is available", async () => {
    await expect(canUseChatAttachmentEncryption({
      globalRandomSource: null,
      nativeModuleLoader: nativeLoader(null),
    })).resolves.toBe(false);
  });

  it("fails closed with a typed error when secure randomness is missing", async () => {
    const error = new ChatAttachmentCryptoUnavailableError();
    expect(isChatAttachmentCryptoUnavailable(error)).toBe(true);
    await expect(ensureChatAttachmentEncryptionAvailable({
      globalRandomSource: null,
      nativeModuleLoader: nativeLoader(null),
    })).rejects.toMatchObject({ code: "chat_attachment_crypto_unavailable" });
  });
});
