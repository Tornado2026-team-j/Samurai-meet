package auth

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

// This small driver verifies transaction ownership without requiring a
// PostgreSQL instance. consumeCeremony returns a transaction to the caller so
// the WebAuthn/session mutation can be committed atomically; an unconditional
// rollback in that helper would make the returned *sql.Tx unusable.
type passkeyCeremonyDriverState struct {
	rollbackCount int
	commitCount   int
}

type passkeyCeremonyDriver struct {
	state *passkeyCeremonyDriverState
}

func (d passkeyCeremonyDriver) Open(string) (driver.Conn, error) {
	return &passkeyCeremonyConn{state: d.state}, nil
}

type passkeyCeremonyConn struct {
	state *passkeyCeremonyDriverState
}

func (c *passkeyCeremonyConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (c *passkeyCeremonyConn) Close() error                        { return nil }

func (c *passkeyCeremonyConn) Begin() (driver.Tx, error) {
	return &passkeyCeremonyTx{state: c.state}, nil
}

func (c *passkeyCeremonyConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return c.Begin()
}

func (c *passkeyCeremonyConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if !strings.Contains(query, "SELECT user_id,scope,used_at FROM auth_challenges") {
		return nil, errors.New("unexpected query")
	}
	scope, err := json.Marshal(passkeyCeremony{})
	if err != nil {
		return nil, err
	}
	return &passkeyCeremonyRows{
		values: []driver.Value{"user-1", string(scope), nil},
	}, nil
}

func (c *passkeyCeremonyConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}

type passkeyCeremonyTx struct {
	state *passkeyCeremonyDriverState
}

func (tx *passkeyCeremonyTx) Commit() error {
	tx.state.commitCount++
	return nil
}

func (tx *passkeyCeremonyTx) Rollback() error {
	tx.state.rollbackCount++
	return nil
}

type passkeyCeremonyRows struct {
	values []driver.Value
	read   bool
}

func (r *passkeyCeremonyRows) Columns() []string {
	return []string{"user_id", "scope", "used_at"}
}

func (r *passkeyCeremonyRows) Close() error { return nil }

func (r *passkeyCeremonyRows) Next(destination []driver.Value) error {
	if r.read {
		return io.EOF
	}
	r.read = true
	copy(destination, r.values)
	return nil
}

func TestConsumeCeremonyLeavesReturnedTransactionOpen(t *testing.T) {
	state := &passkeyCeremonyDriverState{}
	driverName := "samurai-passkey-ceremony-" + strings.NewReplacer("/", "-", " ", "-").Replace(t.Name())
	sql.Register(driverName, passkeyCeremonyDriver{state: state})
	database, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	service := &PasskeyService{db: database}
	ceremony, transaction, err := service.consumeCeremony(
		context.Background(),
		"ceremony-token",
		"passkey_register",
		"user-1",
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if ceremony.Session.UserID != nil {
		t.Fatalf("unexpected session user ID: %v", ceremony.Session.UserID)
	}
	if state.rollbackCount != 0 {
		t.Fatalf("consumeCeremony rolled back before caller commit: %d", state.rollbackCount)
	}
	if _, err := transaction.ExecContext(context.Background(), "UPDATE passkey_credentials SET sign_count=sign_count", nil); err != nil {
		t.Fatalf("returned transaction is unusable: %v", err)
	}
	if err := transaction.Commit(); err != nil {
		t.Fatalf("caller commit failed: %v", err)
	}
	if state.commitCount != 1 {
		t.Fatalf("commit count = %d, want 1", state.commitCount)
	}
}
