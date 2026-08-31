package chat

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

// WebTransportConfig is deliberately explicit. HTTP/3 is never served from
// the normal TCP HTTP address, and production must provide its own TLS key.
type WebTransportConfig struct {
	Enabled        bool
	UDPAddr        string
	CertFile       string
	KeyFile        string
	AllowedOrigins []string
	Logf           func(string, ...any)
}

// WebTransportServer owns the UDP listener used for the sole realtime chat
// transport. Tokens are accepted only in the CONNECT Authorization header;
// query parameters and cookies are never read for authentication.
type WebTransportServer struct {
	endpoint       *QUICEndpoint
	server         *webtransport.Server
	packet         net.PacketConn
	shutdownCtx    context.Context
	shutdownCancel context.CancelFunc
	mu             sync.Mutex
}

const webTransportRevalidationInterval = 15 * time.Second

type webTransportSession struct {
	session *webtransport.Session
	userID  string
}

type webTransportHub struct {
	mu    sync.RWMutex
	rooms map[string]map[*webTransportSession]struct{}
}

func newWebTransportHub() *webTransportHub {
	return &webTransportHub{rooms: make(map[string]map[*webTransportSession]struct{})}
}
func (h *webTransportHub) register(chatID, userID string, session *webtransport.Session) *webTransportSession {
	connection := &webTransportSession{session: session, userID: userID}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[chatID] == nil {
		h.rooms[chatID] = make(map[*webTransportSession]struct{})
	}
	h.rooms[chatID][connection] = struct{}{}
	return connection
}
func (h *webTransportHub) unregister(chatID string, session *webTransportSession) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.rooms[chatID], session)
	if len(h.rooms[chatID]) == 0 {
		delete(h.rooms, chatID)
	}
}
func (h *webTransportHub) broadcast(chatID string, payload []byte) {
	h.broadcastMatching(chatID, "", payload)
}
func (h *webTransportHub) broadcastExceptUser(chatID, userID string, payload []byte) {
	h.broadcastMatching(chatID, userID, payload)
}
func (h *webTransportHub) broadcastMatching(chatID, excludeUserID string, payload []byte) {
	h.mu.RLock()
	sessions := make([]*webTransportSession, 0, len(h.rooms[chatID]))
	for session := range h.rooms[chatID] {
		if session.userID != excludeUserID {
			sessions = append(sessions, session)
		}
	}
	h.mu.RUnlock()
	for _, session := range sessions {
		stream, err := session.session.OpenUniStream()
		if err != nil {
			continue
		}
		_, err = stream.Write(payload)
		_ = stream.Close()
		if err != nil {
			_ = session.session.CloseWithError(0, "fanout_write_failed")
		}
	}
}

func StartWebTransport(ctx context.Context, service *Service, cfg WebTransportConfig) (*WebTransportServer, error) {
	if !cfg.Enabled {
		return nil, nil
	}
	if strings.TrimSpace(cfg.UDPAddr) == "" || strings.TrimSpace(cfg.CertFile) == "" || strings.TrimSpace(cfg.KeyFile) == "" {
		return nil, errors.New("webtransport requires UDP address, TLS certificate, and TLS key")
	}
	certificate, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("load webtransport TLS keypair: %w", err)
	}
	h3 := &http3.Server{Addr: cfg.UDPAddr, TLSConfig: http3.ConfigureTLSConfig(&tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{certificate}}), QUICConfig: &quic.Config{EnableDatagrams: true, EnableStreamResetPartialDelivery: true}}
	webtransport.ConfigureHTTP3Server(h3)
	shutdownCtx, shutdownCancel := context.WithCancel(ctx)
	result := &WebTransportServer{
		endpoint:       NewQUICEndpoint(service, true),
		shutdownCtx:    shutdownCtx,
		shutdownCancel: shutdownCancel,
	}
	mux := http.NewServeMux()
	result.server = &webtransport.Server{H3: h3, CheckOrigin: originAllowed(cfg.AllowedOrigins)}
	mux.HandleFunc("/api/v1/wt/chats/", result.handleConnect)
	h3.Handler = mux
	packet, err := net.ListenPacket("udp", cfg.UDPAddr)
	if err != nil {
		return nil, fmt.Errorf("listen webtransport UDP: %w", err)
	}
	result.packet = packet
	go func() {
		if serveErr := result.server.Serve(packet); serveErr != nil && !errors.Is(serveErr, net.ErrClosed) && cfg.Logf != nil {
			cfg.Logf("chat WebTransport listener stopped: %v", serveErr)
		}
	}()
	go func() {
		<-ctx.Done()
		_ = result.Close()
	}()
	return result, nil
}

func originAllowed(allowed []string) func(*http.Request) bool {
	set := make(map[string]struct{}, len(allowed))
	for _, origin := range allowed {
		if origin = strings.TrimSpace(origin); origin != "" {
			set[origin] = struct{}{}
		}
	}
	return func(r *http.Request) bool {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			return true
		}
		_, ok := set[origin]
		return ok
	}
}

func (s *WebTransportServer) Close() error {
	if s == nil {
		return nil
	}
	if s.shutdownCancel != nil {
		s.shutdownCancel()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var err error
	if s.server != nil {
		err = s.server.Close()
	}
	if s.packet != nil {
		if closeErr := s.packet.Close(); err == nil {
			err = closeErr
		}
		s.packet = nil
	}
	return err
}

func (s *WebTransportServer) handleConnect(w http.ResponseWriter, r *http.Request) {
	// Never accept a token in a URL; reverse proxies commonly log URLs.
	if r.URL.RawQuery != "" {
		http.Error(w, "query authentication is forbidden", http.StatusBadRequest)
		return
	}
	chatID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/wt/chats/"), "/")
	token, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		http.Error(w, "missing chat token", http.StatusUnauthorized)
		return
	}
	connection, err := s.endpoint.Authenticate(r.Context(), chatID, token, time.Now())
	if err != nil {
		http.Error(w, "chat transport authentication failed", http.StatusForbidden)
		return
	}
	session, err := s.server.Upgrade(w, r)
	if err != nil {
		return
	}
	earlyData := session.SessionState().ConnectionState.Used0RTT
	registered := s.endpoint.service.wtHub.register(connection.ChatID, connection.UserID, session)
	go s.serveSession(s.shutdownCtx, session, registered, connection, earlyData)
}

func bearerToken(value string) (string, bool) {
	parts := strings.Fields(value)
	return func() (string, bool) {
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
			return "", false
		}
		return parts[1], true
	}()
}

func (s *WebTransportServer) serveSession(parentCtx context.Context, session *webtransport.Session, registered *webTransportSession, connection QUICConnection, earlyData bool) {
	defer s.endpoint.service.wtHub.unregister(connection.ChatID, registered)
	defer session.CloseWithError(0, "closed")
	ctx, cancel := context.WithCancel(parentCtx)
	defer cancel()
	go s.watchConnection(ctx, session, connection)
	for {
		stream, err := session.AcceptStream(ctx)
		if err != nil {
			return
		}
		go s.serveStream(stream, connection, earlyData)
	}
}

// watchConnection makes a revoked/expired token, disabled session, token
// rotation, or non-accepted match terminate an already-open transport. This
// is deliberately independent of client traffic: an idle connection never
// outlives its authorization state.
func (s *WebTransportServer) watchConnection(ctx context.Context, session *webtransport.Session, connection QUICConnection) {
	ticker := time.NewTicker(webTransportRevalidationInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := s.endpoint.RevalidateConnection(checkCtx, connection, time.Now())
			cancel()
			if err != nil {
				_ = session.CloseWithError(0, "authorization_expired")
				return
			}
		}
	}
}

func (s *WebTransportServer) serveStream(stream *webtransport.Stream, connection QUICConnection, earlyData bool) {
	defer stream.Close()
	var frame inboundFrame
	decoder := json.NewDecoder(io.LimitReader(stream, 192*1024))
	if err := decoder.Decode(&frame); err != nil {
		_ = json.NewEncoder(stream).Encode(errorFrame{Type: serverFrameError, Code: "invalid_frame"})
		return
	}
	message, duplicate, err := s.endpoint.HandleFrame(context.Background(), connection, earlyData, frame, time.Now())
	if err != nil {
		_ = json.NewEncoder(stream).Encode(errorFrame{Type: serverFrameError, Code: transportErrorCode(err)})
		return
	}
	if frame.Type == clientFrameMessageSend {
		_ = json.NewEncoder(stream).Encode(ackFrame{Type: serverFrameMessageAck, ClientMessageID: message.ClientMessageID, Message: message, Duplicate: duplicate})
	} else {
		_ = json.NewEncoder(stream).Encode(map[string]string{"type": "ok"})
	}
}
