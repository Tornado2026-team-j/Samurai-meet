# フロントエンドとAPIのつなぎ方

フロントエンドは `frontend/`、APIは `backend/` です。テスト専用画面をバックエンドに同梱しないため、本番と開発で画面の実装がずれません。

```mermaid
flowchart TD
  Screen[画面 / hook] --> Auth[services/auth.ts]
  Auth --> Store[Secure Storage
Refresh token・IDのみ]
  Auth --> API[Go API /api/v1]
  API -->|Access token| Protected[保護API]
  API -->|401| Refresh[Refresh tokenで更新]
  Refresh -->|成功| Protected
  Refresh -->|失敗| Login[ログイン画面]
```

Web Passkeyは、アプリの秘密tokenをURLへ載せない設計です。

```mermaid
sequenceDiagram
  participant App as Expoアプリ
  participant API as Go API
  participant Web as Web Passkey画面
  App->>API: bootstrap発行（Bearer pre-authまたはAccess）
  API-->>App: 1分・一回限りbootstrap token
  App->>Web: URL fragmentにbootstrap tokenだけ
  Web->>API: options（X-Web-Passkey-Token）
  API-->>Web: WebAuthn options + ceremony token
  Web->>API: verify（bootstrap + ceremony headers）
  API-->>Web: handoff codeだけ
  Web-->>App: 許可済みdeep link
  App->>API: handoff exchange + verifier + request_id
  API-->>App: Access/Refresh session
```

URLにAccess Token、Refresh Token、`pre_auth_token`、ユーザーIDは入りません。Web APIの応答はキャッシュされず、ブラウザから参照元情報も送られないようにします。handoffの再送は、同じ`request_id`で短時間に行った場合だけ許可されます。

開発時は `frontend/.env` の `EXPO_PUBLIC_API_BASE_URL` を `http://127.0.0.1:8080/api/v1` 等に設定できます。未指定でも、`NODE_ENV=development` のExpo Webを `http://localhost` または `http://127.0.0.1` で開いた場合はフロントがローカルGo API（`http://127.0.0.1:8080/api/v1`）を自動選択します。ネイティブ開発クライアントでは、Expo CLIが公開するプライベートLANホストの8080番を自動選択します。HTTPSトンネルや本番APIは明示的な上書きを使用してください。Expo Webを標準ポートで起動する場合はブラウザのOriginが `http://localhost:8081` になるため、バックエンドも `APP_ENV=development`、`DEV_CLIENT_ORIGIN=http://localhost:8081`、`WEBAUTHN_RP_ID=localhost`、`WEBAUTHN_RP_ORIGIN=http://localhost:8081` に揃えます。Google OAuthをローカルGo APIで完結させる場合は`GOOGLE_REDIRECT_URI=http://localhost:8080/auth/callback`をGoogle Cloud Consoleへ登録し、同じcallbackをGo側へ設定します。`APP_ENV`だけを変更しても`.env`に残った本番callbackやDB接続先は切り替わりません。`localhost` と `127.0.0.1`、ポート番号は完全一致です。本番の `CLIENT_ORIGIN` や本番WebAuthn OriginをローカルWebへ流用しないでください。CORSは固定Originだけを許可します。

Passkey用Web画面は、Goバックエンドの `/passkey` から配信します。`WEB_PASSKEY_URL` はこの同一Originの画面を指し、画面から相対URLでPasskey APIを呼び出します。
