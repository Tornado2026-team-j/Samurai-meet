# Implementation and rollout plan

## Landed in this change

- v2-only envelope validation for Argon2id + HKDF parameters. Legacy v1 root
  envelopes are rejected by the API and removed by the pre-release cutover
  migration.
- Separate X25519 device-agreement key material from Ed25519 Key-B.
- Authenticated, rate-limited device-transfer request/approve/poll/complete
  endpoints. The server stores only public keys, hashes, metadata, and the
  opaque wrapped root-key envelope.
- Client-side phrase generation/validation and local recovery wrapping.
- Client helpers for stable account-root derivation and account/device
  envelopes. Existing ciphertext bytes are not re-encrypted during device
  migration; account-wrapped object keys are re-wrapped locally as needed.
- Documentation and migration inventory for the profile-image public exception.

## Still required before production claim

1. Connect the transfer API to a user-facing old-device/new-device flow with QR
   or a clearly verified short code. Do not auto-approve from a browser return.
2. Add a resumable bulk per-photo DEK rewrap with progress, retry, and old-device
   revocation only after verification.
3. Migrate legacy profile images or explicitly keep them public and label them as
   such in the product. The current public profile-image route is an explicit
   zero-access exception.
4. Add one-time Recovery Codes and the policy for Passkey re-registration.
5. Add native Secure Enclave/Keystore integration and Android key attestation;
   test on real iOS and Android devices, not only Expo Go.
6. Add object-ID/version AAD, encrypted backup/restore, key-envelope rollback
   detection, audit events without secrets, and PostgreSQL integration tests.

## Release gates

- `bun run typecheck`, `bun run lint`, `bun test`
- `go test -count=1 ./...`, `go vet ./...`, `go build ./...`
- PostgreSQL migration applied twice successfully and transfer tables verified
- old-device flow: wrong code, wrong target key, replay, expiry, revoke
- recovery flow: valid/invalid phrase, v1 rejection, phrase rotation, pending
  save retry, and loss-of-all-factors behavior
- production-equivalent API checks confirm no response/log contains plaintext
  Master Key, Recovery Phrase, Key-B, or private image plaintext
