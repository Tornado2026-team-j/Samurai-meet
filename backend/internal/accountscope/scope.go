// Package accountscope centralizes the server-side isolation boundary between
// regular accounts and short-lived review demo accounts.
package accountscope

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

const (
	Regular = "regular"
	Demo    = "demo"
)

var (
	ErrUserNotFound = errors.New("account scope user not found")
	ErrInactive     = errors.New("account scope user is inactive")
	ErrExpired      = errors.New("account scope demo account expired")
	ErrInvalid      = errors.New("account scope is invalid")
	ErrMismatch     = errors.New("account scopes do not match")
)

// Queryer is implemented by both *sql.DB and *sql.Tx. Keeping the resolver on
// this small interface lets transaction-bound mutations use exactly the same
// checks as ordinary reads.
type Queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type Scope struct {
	AccountType   string
	DemoExpiresAt *time.Time
}

func Resolve(ctx context.Context, queryer Queryer, userID string, now time.Time) (Scope, error) {
	if queryer == nil || strings.TrimSpace(userID) == "" {
		return Scope{}, ErrUserNotFound
	}
	var status, accountType string
	var demoExpires sql.NullString
	if err := queryer.QueryRowContext(ctx, `
		SELECT status,account_type,demo_expires_at
		FROM users WHERE id=$1`, userID).Scan(&status, &accountType, &demoExpires); errors.Is(err, sql.ErrNoRows) {
		return Scope{}, ErrUserNotFound
	} else if err != nil {
		return Scope{}, err
	}
	if status != "active" {
		return Scope{}, ErrInactive
	}
	switch accountType {
	case Regular:
		if demoExpires.Valid && strings.TrimSpace(demoExpires.String) != "" {
			return Scope{}, ErrInvalid
		}
		return Scope{AccountType: Regular}, nil
	case Demo:
		if !demoExpires.Valid || strings.TrimSpace(demoExpires.String) == "" {
			return Scope{}, ErrInvalid
		}
		expiresAt, err := time.Parse(time.RFC3339Nano, demoExpires.String)
		if err != nil {
			return Scope{}, ErrInvalid
		}
		if !now.Before(expiresAt) {
			return Scope{}, ErrExpired
		}
		return Scope{AccountType: Demo, DemoExpiresAt: &expiresAt}, nil
	default:
		return Scope{}, ErrInvalid
	}
}

// RequireCompatible verifies that both users are active and belong to the
// same account scope. A regular account can never be paired with a demo
// account, even if a caller reaches this function with a forged client state.
func RequireCompatible(ctx context.Context, queryer Queryer, firstUserID, secondUserID string, now time.Time) (Scope, error) {
	first, err := Resolve(ctx, queryer, firstUserID, now)
	if err != nil {
		return Scope{}, err
	}
	second, err := Resolve(ctx, queryer, secondUserID, now)
	if err != nil {
		return Scope{}, err
	}
	if first.AccountType != second.AccountType {
		return Scope{}, ErrMismatch
	}
	return first, nil
}
