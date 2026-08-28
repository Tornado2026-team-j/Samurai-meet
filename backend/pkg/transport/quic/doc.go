// Package quic contains the transport-neutral policy and configuration
// boundary for a future Samurai Meet QUIC transport.
//
// This package is intentionally not integrated with the current chat, HTTP
// API, authentication, router, migrations, or application screens. It does
// not open listeners, dial peers, or perform external I/O. A future adapter
// may translate the validated configuration to a QUIC implementation after
// the connection authentication and application protocol have been reviewed.
package quic
