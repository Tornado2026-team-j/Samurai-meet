package quic

import (
	"crypto/tls"
	"errors"
	"testing"
)

func TestDefaultConfigGeneratesTLS13AndDedicatedALPN(t *testing.T) {
	cfg := DefaultConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("DefaultConfig().Validate() error = %v", err)
	}

	tlsConfig, err := cfg.TLSConfig()
	if err != nil {
		t.Fatalf("TLSConfig() error = %v", err)
	}
	if tlsConfig.MinVersion != tls.VersionTLS13 || tlsConfig.MaxVersion != tls.VersionTLS13 {
		t.Fatalf("TLS version bounds = %d..%d, want TLS 1.3 only", tlsConfig.MinVersion, tlsConfig.MaxVersion)
	}
	if len(tlsConfig.NextProtos) != 1 || tlsConfig.NextProtos[0] != ProtocolALPN {
		t.Fatalf("NextProtos = %#v, want [%q]", tlsConfig.NextProtos, ProtocolALPN)
	}
	if cfg.EarlyDataPolicy != EarlyDataDisabled {
		t.Fatalf("default early-data policy = %q, want %q", cfg.EarlyDataPolicy, EarlyDataDisabled)
	}
}

func TestNormalizeFillsSafeDefaults(t *testing.T) {
	got, err := (Config{}).Normalize()
	if err != nil {
		t.Fatalf("Normalize() error = %v", err)
	}
	if got != DefaultConfig() {
		t.Fatalf("normalized config = %+v, want %+v", got, DefaultConfig())
	}
}

func TestNormalizeDoesNotHideExplicitInvalidValues(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
	}{
		{name: "wrong ALPN", cfg: Config{ALPN: "h3"}},
		{name: "TLS 1.2", cfg: Config{TLSMinVersion: tls.VersionTLS12}},
		{name: "negative handshake timeout", cfg: Config{HandshakeTimeout: -1}},
		{name: "idle timeout before handshake", cfg: Config{HandshakeTimeout: 30 * 1e9, IdleTimeout: 20 * 1e9}},
		{name: "keep alive not below idle", cfg: Config{IdleTimeout: 30 * 1e9, KeepAlivePeriod: 30 * 1e9}},
		{name: "too many streams", cfg: Config{MaxIncomingStreams: HardMaxIncomingStreams + 1}},
		{name: "stream receive limit too large", cfg: Config{MaxReceiveStreamBytes: HardMaxReceiveStreamBytes + 1}},
		{name: "connection below stream", cfg: Config{MaxReceiveStreamBytes: 2, MaxReceiveConnectionBytes: 1}},
		{name: "unknown early data policy", cfg: Config{EarlyDataPolicy: "all"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tc.cfg.Normalize(); !errors.Is(err, ErrInvalidConfig) {
				t.Fatalf("Normalize() error = %v, want ErrInvalidConfig", err)
			}
		})
	}
}

func TestValidateRejectsUnsafeExplicitValues(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ALPN = "samurai-meet-other-v1"
	if err := cfg.Validate(); !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("Validate() error = %v, want ErrInvalidConfig", err)
	}

	cfg = DefaultConfig()
	cfg.TLSMaxVersion = tls.VersionTLS12
	if err := cfg.Validate(); !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("Validate() TLS error = %v, want ErrInvalidConfig", err)
	}
}

func TestZeroRTTPolicyNeverAllowsStateChanges(t *testing.T) {
	defaultConfig := DefaultConfig()
	if defaultConfig.Allows0RTT(RequestClassStateChanging) {
		t.Fatal("default policy allows a state-changing 0-RTT operation")
	}
	if err := defaultConfig.Validate0RTT(RequestClassStateChanging); !errors.Is(err, ErrEarlyDataNotAllowed) {
		t.Fatalf("default state-changing validation error = %v, want ErrEarlyDataNotAllowed", err)
	}

	readOnlyConfig := defaultConfig
	readOnlyConfig.EarlyDataPolicy = EarlyDataReadOnly
	if err := readOnlyConfig.Validate(); err != nil {
		t.Fatalf("read-only policy rejected: %v", err)
	}
	if !readOnlyConfig.Allows0RTT(RequestClassReadOnly) {
		t.Fatal("read-only policy does not allow a read-only 0-RTT operation")
	}
	if err := readOnlyConfig.Validate0RTT(RequestClassReadOnly); err != nil {
		t.Fatalf("read-only operation rejected: %v", err)
	}
	if readOnlyConfig.Allows0RTT(RequestClassStateChanging) {
		t.Fatal("read-only policy allows a state-changing 0-RTT operation")
	}
	if err := readOnlyConfig.Validate0RTT(RequestClassStateChanging); !errors.Is(err, ErrEarlyDataNotAllowed) {
		t.Fatalf("state-changing validation error = %v, want ErrEarlyDataNotAllowed", err)
	}
}
