package keys

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestDeviceTransferCodeRejectsAmbiguousOrMalformedValues(t *testing.T) {
	valid := "ABCDEFGH"
	for _, value := range []string{valid, "23456789"} {
		if !validDeviceTransferCode(value) {
			t.Fatalf("valid transfer code %q was rejected", value)
		}
	}
	for _, value := range []string{"abcdefgH", "ABCDEF0H", "ABCDEFG", "ABCDEFGHI", "ABCDEFG!"} {
		if validDeviceTransferCode(value) {
			t.Fatalf("invalid transfer code %q was accepted", value)
		}
	}
}

func TestValidateWrappedMasterKeyBindsEnvelopeContext(t *testing.T) {
	transferID := "transfer-1"
	targetDeviceID := "target-device-1"
	targetPublicKey := encodeTransferTestBytes(0x11, 32)
	envelope := wrappedMasterKeyEnvelope{
		Algorithm:          DeviceTransferAlgorithm,
		Version:            1,
		TransferID:         transferID,
		TargetDeviceID:     targetDeviceID,
		EphemeralPublicKey: encodeTransferTestBytes(0x22, 32),
		RecipientPublicKey: targetPublicKey,
		Nonce:              encodeTransferTestBytes(0x33, 12),
		Ciphertext:         encodeTransferTestBytes(0x44, 32+16),
	}
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	if err := validateWrappedMasterKey(encoded, transferID, targetDeviceID, targetPublicKey); err != nil {
		t.Fatalf("valid transfer envelope was rejected: %v", err)
	}

	cases := []struct {
		name     string
		transfer string
		device   string
		key      string
		mutate   func(*wrappedMasterKeyEnvelope)
	}{
		{name: "wrong transfer", transfer: "other-transfer"},
		{name: "wrong device", device: "other-device-1"},
		{name: "wrong recipient", key: encodeTransferTestBytes(0x55, 32)},
		{name: "wrong algorithm", mutate: func(item *wrappedMasterKeyEnvelope) { item.Algorithm = "AES-GCM" }},
		{name: "wrong ciphertext length", mutate: func(item *wrappedMasterKeyEnvelope) { item.Ciphertext = encodeTransferTestBytes(0x44, 32) }},
		{name: "wrong nonce length", mutate: func(item *wrappedMasterKeyEnvelope) { item.Nonce = encodeTransferTestBytes(0x33, 11) }},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := envelope
			if testCase.mutate != nil {
				testCase.mutate(&candidate)
			}
			candidateRaw, err := json.Marshal(candidate)
			if err != nil {
				t.Fatal(err)
			}
			candidateEncoded := base64.RawURLEncoding.EncodeToString(candidateRaw)
			transfer := transferID
			if testCase.transfer != "" {
				transfer = testCase.transfer
			}
			device := targetDeviceID
			if testCase.device != "" {
				device = testCase.device
			}
			key := targetPublicKey
			if testCase.key != "" {
				key = testCase.key
			}
			if err := validateWrappedMasterKey(candidateEncoded, transfer, device, key); err == nil {
				t.Fatal("invalid transfer envelope was accepted")
			}
		})
	}
}

func encodeTransferTestBytes(value byte, size int) string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{value}, size))
}
