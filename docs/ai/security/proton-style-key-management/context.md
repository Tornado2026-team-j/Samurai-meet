# Context: Proton-style client-owned encryption

## Problem

The previous implementation had a useful v1 boundary, but it mixed two different
purposes in the client model:

- Key-A is the account recovery root.
- Key-B is a device-only key used for image envelopes and request proof.
- `deriveDataKey(Key-A, Key-B, ...)` makes a generic data key device-dependent.
- private photo ciphertext already has an account wrapper, while the public
  profile-image route still decrypts on the server by design.

That is sufficient for the existing v1 flow, but it is not the final
Proton-style migration model. A device change must move the account root to a
new device without re-encrypting every image, and a server compromise must not
give the server a decryption path.

## Constraints

- The pre-release cutover is intentionally breaking for root-key material:
  only v2 envelopes and 24-word Recovery Phrases are accepted. Existing object
  ciphertext is preserved where its account wrapper is still valid.
- Key-B raw material must not cross the API or be written to PostgreSQL.
- A request with only an Access Token must not create or approve a migration.
- A server cannot be trusted to choose a new device public key on behalf of the
  old device. The user must compare a short code/fingerprint or scan a QR/OOB
  payload between devices.
- Expo Go cannot be treated as proof of hardware-backed key storage. Native
  production builds must report the actual Secure Enclave/Keystore posture.

## Evidence boundary

This proposal uses the same user-controlled recovery principle documented by
[Proton's recovery phrase guidance](https://proton.me/support/recovery-phrase)
and the platform storage guidance from
[Apple Secure Enclave](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave)
and [Android Keystore](https://developer.android.com/privacy-and-security/keystore).
Those references inform the design; they do not constitute an audit of this
repository or a claim that the current Expo build is hardware-backed.
