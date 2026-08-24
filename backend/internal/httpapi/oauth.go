package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

func googleStart(service *auth.OAuthLoginService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		url, err := service.Start(r.Context(), time.Now())
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "oauth_unavailable"})
			return
		}
		http.Redirect(w, r, url, http.StatusFound)
	}
}

func googleCallbackPage(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprint(w, `<!doctype html><meta charset="utf-8"><title>Google ログイン処理中</title><pre id="result">Google ログインを処理しています。</pre><script>const p=new URLSearchParams(location.search),o=document.querySelector('#result');fetch('/api/v1/auth/google/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:p.get('code'),state:p.get('state')})}).then(async r=>({status:r.status,body:await r.json()})).then(x=>o.textContent=JSON.stringify(x,null,2)).catch(e=>o.textContent='失敗: '+e.message);</script>`)
}
func googleExchange(service *auth.OAuthLoginService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Code  string `json:"code"`
			State string `json:"state"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Code == "" || request.State == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		result, err := service.Complete(r.Context(), request.Code, request.State, time.Now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "google_exchange_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"user_id": result.UserID, "session_id": result.SessionID, "access_token": result.AccessToken, "refresh_token": result.RefreshToken, "is_new_user": result.IsNewUser}})
	}
}
