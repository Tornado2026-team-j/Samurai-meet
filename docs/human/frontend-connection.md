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

開発時は `frontend/.env` の `EXPO_PUBLIC_API_BASE_URL` を `http://127.0.0.1:8080/api/v1` 等に設定します。ブラウザから接続する場合だけ、バックエンドの `DEV_CLIENT_ORIGIN` または `CLIENT_ORIGIN` と一致させます。CORSは「指定された一つのOriginだけ」を許可します。

Passkey用Web画面は、正式フロントエンドのWeb配信に置きます。現在の `WEB_PASSKEY_URL` の到達先を、正式なWeb Passkey実装へ置換することがリリース前の必須作業です。APIをUI配信元として使ってはいけません。
