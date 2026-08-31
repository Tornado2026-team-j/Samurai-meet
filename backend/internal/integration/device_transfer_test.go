package integration

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

func TestDeviceTransferCancelStateTransitions(t *testing.T) {
	database := openIsolatedDatabase(t)
	ctx := context.Background()
	now := time.Date(2026, time.August, 30, 12, 0, 0, 0, time.UTC)
	userID := randomID(t)
	if _, err := database.ExecContext(ctx,
		`INSERT INTO users (id,google_subject_id,status,created_at,updated_at) VALUES ($1,$2,'active',$3,$3)`,
		userID, "device-transfer-cancel-"+userID, now.Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}

	deviceID := "target-" + randomID(t)
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	agreementPublicKey := encode(randomBytes(t, 32))
	devices := keys.NewDeviceService(database)
	if _, err := devices.RegisterWithAgreement(ctx, userID, deviceID, keys.DeviceKeyVersion,
		encode(publicKey), keys.DeviceAgreementKeyVersion, agreementPublicKey, now); err != nil {
		t.Fatal(err)
	}
	transfers := keys.NewDeviceTransferService(database)

	create := func() keys.DeviceTransfer {
		t.Helper()
		transfer, err := transfers.Create(ctx, userID, deviceID, keys.DeviceAgreementKeyVersion, agreementPublicKey, "ABCDEFGH", now)
		if err != nil {
			t.Fatal(err)
		}
		return transfer
	}

	pending := create()
	if err := transfers.Cancel(ctx, userID, pending.ID, deviceID, now); err != nil {
		t.Fatalf("pending cancel error = %v", err)
	}
	assertCancelledTransfer(t, database, pending.ID)
	if err := transfers.Cancel(ctx, userID, pending.ID, deviceID, now); !errors.Is(err, keys.ErrDeviceTransferNotCancellable) {
		t.Fatalf("duplicate cancel error = %v, want ErrDeviceTransferNotCancellable", err)
	}

	approved := create()
	if _, err := database.ExecContext(ctx, `UPDATE device_key_transfers SET status='approved',wrapped_master_key='opaque',wrapping_algorithm='test' WHERE id=$1`, approved.ID); err != nil {
		t.Fatal(err)
	}
	if err := transfers.Cancel(ctx, userID, approved.ID, deviceID, now); err != nil {
		t.Fatalf("approved cancel error = %v", err)
	}
	assertCancelledTransfer(t, database, approved.ID)

	for _, status := range []string{"completed", "rejected", "expired", "cancelled"} {
		t.Run(status, func(t *testing.T) {
			transfer := create()
			if _, err := database.ExecContext(ctx, `UPDATE device_key_transfers SET status=$1 WHERE id=$2`, status, transfer.ID); err != nil {
				t.Fatal(err)
			}
			if err := transfers.Cancel(ctx, userID, transfer.ID, deviceID, now); !errors.Is(err, keys.ErrDeviceTransferNotCancellable) {
				t.Fatalf("%s cancel error = %v, want ErrDeviceTransferNotCancellable", status, err)
			}
		})
	}

	wrongTarget := create()
	if err := transfers.Cancel(ctx, userID, wrongTarget.ID, "wrong-target-"+randomID(t), now); !errors.Is(err, keys.ErrDeviceTransferTargetMismatch) {
		t.Fatalf("wrong target cancel error = %v, want ErrDeviceTransferTargetMismatch", err)
	}
}

func assertCancelledTransfer(t *testing.T, database *sql.DB, transferID string) {
	t.Helper()
	var status, wrappedMasterKey, wrappingAlgorithm string
	if err := database.QueryRowContext(context.Background(), `SELECT status,wrapped_master_key,wrapping_algorithm FROM device_key_transfers WHERE id=$1`, transferID).Scan(&status, &wrappedMasterKey, &wrappingAlgorithm); err != nil {
		t.Fatal(err)
	}
	if status != "cancelled" || wrappedMasterKey != "" || wrappingAlgorithm != "" {
		t.Fatalf("cancelled transfer = status %q, wrapped key %q, algorithm %q", status, wrappedMasterKey, wrappingAlgorithm)
	}
}
