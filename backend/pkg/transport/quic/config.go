package quic

import (
	"crypto/tls"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ProtocolALPN is the dedicated application protocol identifier for the
// future chat transport. It must not be shared with HTTP/3 or another
// application protocol.
const ProtocolALPN = "samurai-meet-chat-quic-v1"

const (
	// Defaults are deliberately conservative for a chat transport. They are
	// expressed as constants so adapters can map them to their QUIC library
	// without inventing per-call limits.
	DefaultHandshakeTimeout          = 10 * time.Second
	DefaultIdleTimeout               = 2 * time.Minute
	DefaultKeepAlivePeriod           = 20 * time.Second
	DefaultMaxIncomingStreams        = int64(32)
	DefaultMaxIncomingUniStreams     = int64(8)
	DefaultMaxReceiveStreamBytes     = int64(1 << 20)
	DefaultMaxReceiveConnectionBytes = int64(8 << 20)

	// Hard limits prevent a caller from turning a transport configuration into
	// an unbounded memory or stream reservation.
	HardMaxHandshakeTimeout       = 30 * time.Second
	HardMaxIdleTimeout            = 10 * time.Minute
	HardMaxKeepAlivePeriod        = 5 * time.Minute
	HardMaxIncomingStreams        = int64(256)
	HardMaxIncomingUniStreams     = int64(64)
	HardMaxReceiveStreamBytes     = int64(16 << 20)
	HardMaxReceiveConnectionBytes = int64(64 << 20)
)

var (
	// ErrInvalidConfig identifies a configuration that cannot safely be
	// passed to a QUIC adapter.
	ErrInvalidConfig = errors.New("invalid QUIC transport configuration")

	// ErrEarlyDataNotAllowed is returned when an operation is not safe to send
	// as QUIC 0-RTT application data.
	ErrEarlyDataNotAllowed = errors.New("QUIC 0-RTT application data is not allowed for this operation")
)

// EarlyDataPolicy describes the only 0-RTT modes this package permits.
// State-changing operations are never allowed by either mode.
type EarlyDataPolicy string

const (
	// EarlyDataDisabled is the secure default: no application data is accepted
	// before the handshake completes.
	EarlyDataDisabled EarlyDataPolicy = "disabled"

	// EarlyDataReadOnly permits only operations that are explicitly classified
	// as read-only. It does not permit messages, read receipts, or any other
	// state change.
	EarlyDataReadOnly EarlyDataPolicy = "read-only"
)

// RequestClass is the application-level classification used by the 0-RTT
// guard. The caller must classify an operation before sending it.
type RequestClass uint8

const (
	RequestClassReadOnly RequestClass = iota + 1
	RequestClassStateChanging
)

// Config is the common policy and resource configuration for a future QUIC
// adapter. It contains no socket, listener, certificate, or network state.
type Config struct {
	// ALPN must remain ProtocolALPN. It is exposed so a future adapter can pass
	// the validated value to its TLS/QUIC configuration.
	ALPN string

	// QUIC requires TLS 1.3. Both bounds are explicit to prevent an adapter
	// from silently widening the negotiated TLS version.
	TLSMinVersion uint16
	TLSMaxVersion uint16

	HandshakeTimeout time.Duration
	IdleTimeout      time.Duration
	KeepAlivePeriod  time.Duration

	MaxIncomingStreams    int64
	MaxIncomingUniStreams int64

	// Receive limits are application-facing ceilings. A QUIC library may also
	// have flow-control windows; an adapter must not configure those above
	// these validated limits without a separate security review.
	MaxReceiveStreamBytes     int64
	MaxReceiveConnectionBytes int64

	EarlyDataPolicy EarlyDataPolicy
}

// DefaultConfig returns the safe baseline for a future adapter. 0-RTT is
// disabled until an adapter deliberately opts into read-only operations.
func DefaultConfig() Config {
	return Config{
		ALPN:                      ProtocolALPN,
		TLSMinVersion:             tls.VersionTLS13,
		TLSMaxVersion:             tls.VersionTLS13,
		HandshakeTimeout:          DefaultHandshakeTimeout,
		IdleTimeout:               DefaultIdleTimeout,
		KeepAlivePeriod:           DefaultKeepAlivePeriod,
		MaxIncomingStreams:        DefaultMaxIncomingStreams,
		MaxIncomingUniStreams:     DefaultMaxIncomingUniStreams,
		MaxReceiveStreamBytes:     DefaultMaxReceiveStreamBytes,
		MaxReceiveConnectionBytes: DefaultMaxReceiveConnectionBytes,
		EarlyDataPolicy:           EarlyDataDisabled,
	}
}

// Normalize fills only zero-valued optional fields from DefaultConfig and
// then validates the complete result. Negative values and explicit unsafe
// values are not treated as missing configuration.
func (c Config) Normalize() (Config, error) {
	d := DefaultConfig()
	if c.ALPN == "" {
		c.ALPN = d.ALPN
	}
	if c.TLSMinVersion == 0 {
		c.TLSMinVersion = d.TLSMinVersion
	}
	if c.TLSMaxVersion == 0 {
		c.TLSMaxVersion = d.TLSMaxVersion
	}
	if c.HandshakeTimeout == 0 {
		c.HandshakeTimeout = d.HandshakeTimeout
	}
	if c.IdleTimeout == 0 {
		c.IdleTimeout = d.IdleTimeout
	}
	if c.KeepAlivePeriod == 0 {
		c.KeepAlivePeriod = d.KeepAlivePeriod
	}
	if c.MaxIncomingStreams == 0 {
		c.MaxIncomingStreams = d.MaxIncomingStreams
	}
	if c.MaxIncomingUniStreams == 0 {
		c.MaxIncomingUniStreams = d.MaxIncomingUniStreams
	}
	if c.MaxReceiveStreamBytes == 0 {
		c.MaxReceiveStreamBytes = d.MaxReceiveStreamBytes
	}
	if c.MaxReceiveConnectionBytes == 0 {
		c.MaxReceiveConnectionBytes = d.MaxReceiveConnectionBytes
	}
	if c.EarlyDataPolicy == "" {
		c.EarlyDataPolicy = d.EarlyDataPolicy
	}
	if err := c.Validate(); err != nil {
		return Config{}, err
	}
	return c, nil
}

// Validate rejects configurations that could weaken the transport boundary
// or exceed the resource ceilings. It performs no I/O.
func (c Config) Validate() error {
	if c.ALPN != ProtocolALPN {
		return fmt.Errorf("%w: ALPN must be %q", ErrInvalidConfig, ProtocolALPN)
	}
	if c.TLSMinVersion != tls.VersionTLS13 || c.TLSMaxVersion != tls.VersionTLS13 {
		return fmt.Errorf("%w: TLS 1.3 must be the only negotiated version", ErrInvalidConfig)
	}
	if c.HandshakeTimeout <= 0 || c.HandshakeTimeout > HardMaxHandshakeTimeout {
		return fmt.Errorf("%w: handshake timeout must be between 1ns and %s", ErrInvalidConfig, HardMaxHandshakeTimeout)
	}
	if c.IdleTimeout <= c.HandshakeTimeout || c.IdleTimeout > HardMaxIdleTimeout {
		return fmt.Errorf("%w: idle timeout must exceed handshake timeout and be at most %s", ErrInvalidConfig, HardMaxIdleTimeout)
	}
	if c.KeepAlivePeriod <= 0 || c.KeepAlivePeriod >= c.IdleTimeout || c.KeepAlivePeriod > HardMaxKeepAlivePeriod {
		return fmt.Errorf("%w: keep-alive period must be positive, below idle timeout, and at most %s", ErrInvalidConfig, HardMaxKeepAlivePeriod)
	}
	if c.MaxIncomingStreams < 0 || c.MaxIncomingStreams > HardMaxIncomingStreams {
		return fmt.Errorf("%w: bidirectional stream limit must be between 0 and %d", ErrInvalidConfig, HardMaxIncomingStreams)
	}
	if c.MaxIncomingUniStreams < 0 || c.MaxIncomingUniStreams > HardMaxIncomingUniStreams {
		return fmt.Errorf("%w: unidirectional stream limit must be between 0 and %d", ErrInvalidConfig, HardMaxIncomingUniStreams)
	}
	if c.MaxReceiveStreamBytes <= 0 || c.MaxReceiveStreamBytes > HardMaxReceiveStreamBytes {
		return fmt.Errorf("%w: stream receive limit must be between 1 and %d bytes", ErrInvalidConfig, HardMaxReceiveStreamBytes)
	}
	if c.MaxReceiveConnectionBytes < c.MaxReceiveStreamBytes || c.MaxReceiveConnectionBytes > HardMaxReceiveConnectionBytes {
		return fmt.Errorf("%w: connection receive limit must contain the stream limit and be at most %d bytes", ErrInvalidConfig, HardMaxReceiveConnectionBytes)
	}
	switch c.EarlyDataPolicy {
	case EarlyDataDisabled, EarlyDataReadOnly:
		return nil
	default:
		return fmt.Errorf("%w: unsupported early-data policy %q", ErrInvalidConfig, strings.TrimSpace(string(c.EarlyDataPolicy)))
	}
}

// TLSConfig creates a standard-library TLS configuration containing the
// mandatory TLS 1.3 bounds and dedicated ALPN. Certificates, server names,
// and peer verification remain the responsibility of the future adapter.
func (c Config) TLSConfig() (*tls.Config, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	return &tls.Config{
		MinVersion: c.TLSMinVersion,
		MaxVersion: c.TLSMaxVersion,
		NextProtos: []string{c.ALPN},
	}, nil
}

// Allows0RTT reports whether an operation class can be accepted as 0-RTT
// application data under the policy. State-changing operations always return
// false, including when read-only 0-RTT is enabled.
func (c Config) Allows0RTT(class RequestClass) bool {
	return c.EarlyDataPolicy == EarlyDataReadOnly && class == RequestClassReadOnly
}

// Validate0RTT returns an explicit error for an operation that must wait for
// the 1-RTT handshake. Callers should use this guard before dispatching any
// application data marked as early data.
func (c Config) Validate0RTT(class RequestClass) error {
	if c.Allows0RTT(class) {
		return nil
	}
	return ErrEarlyDataNotAllowed
}
