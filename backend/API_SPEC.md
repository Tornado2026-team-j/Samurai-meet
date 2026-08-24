# バックエンド API 仕様（実装基準）

最終更新: 2026-08-24

この文書は、現在のGo実装とExpoテストクライアントの契約です。状態は次の記号で表します。

- **実装済み**: 現在のサーバーコードにルートと処理が存在する。
- **準備中**: DBまたは部品は存在するが、HTTP契約が未実装。
- **予定**: 仕様のみで、クライアントから呼び出してはいけない。

## 1. 共通

- 本番 Base URL: `https://samurai-meet.disnana.com/api/v1`
- ローカル Base URL: `http://127.0.0.1:8080/api/v1`
- すべての業務APIはGo APIを経由する。SQLiteは使用しない。
- Content-Type: `application/json; charset=utf-8`
- 時刻: UTCのRFC3339文字列
- サービス内部ID:現在は暗号学的乱数から作るopaque `TEXT`。クライアントは形式を仮定しない。
- 保護API: `Authorization: Bearer <access_token>`

### 1.1 エラー

現行実装のエラーは、移行期間中は次の簡易形式です。

```json
{ "error": "refresh_failed" }
```

クライアントはHTTPステータスと`error`を組み合わせて処理します。Access Tokenの期限切れ・セッション失効は401、Refresh Token再利用検知は409です。

## 2. ヘルスチェック（実装済み）

| Method | Path | 認証 | 成功レスポンス |
| --- | --- | --- | --- |
| GET | `/healthz` または `/api/v1/healthz` | 不要 | `{ "status": "ok" }` |
| GET | `/readyz` または `/api/v1/readyz` | 不要 | `{ "status": "ready" }` |

Expoテストクライアントの「状態を更新」は`/api/v1/readyz`を呼びます。

## 3. Google OAuth2 / OIDC（実装済み）

### 3.1 開始

`GET /api/v1/auth/google/start`

必須query:

| 名前 | 説明 |
| --- | --- |
| `app_redirect_uri` | OAuth完了後に戻すアプリURI |
| `handoff_challenge` | アプリが保持するhandoff verifierのSHA-256 Base64URL |

許可URI:

- 本番アプリ: `samuraimeet://auth`
- 開発用Expo Go: `samuraimeettest://auth` または `exp://<host>/--/auth`
- Web開発クライアント: 設定済み`CLIENT_ORIGIN`または開発Originの`/auth/complete`（完全一致）
- `exp://` は`APP_ENV=development`、`test`、またはローカル専用の`ALLOW_EXPO_GO_REDIRECT=true`のときだけ許可する。
- Google Consoleに登録するURIはアプリURIではなく、常に `https://samurai-meet.disnana.com/auth/callback`。

サーバーはOAuth stateとGoogle用PKCE verifierをPostgreSQLへ10分保存し、Googleへリダイレクトします。stateはhashだけを検索キーにし、callbackで一回だけ消費します。

### 3.2 Google callback

`GET /auth/callback`

Googleからauthorization codeを受け取り、OIDCのissuer、audience、署名、期限、`sub`を検証します。成功時は、DBに保存したアプリURIへ次の一回限りhandoff codeを付けて302します。

```text
<app_redirect_uri>?handoff_code=<one-time-code>
```

サーバーはhandoff codeのhash、ユーザー、challenge、期限（10分）を保存します。handoff code自体をログへ出しません。

### 3.3 アプリへの交換

`POST /api/v1/auth/google/exchange`

Request:

```json
{
  "handoff_code": "callbackから受け取った一回限りコード",
  "handoff_verifier": "Secure Storageに保存したverifier"
}
```

Response:

```json
{
  "data": {
    "user_id": "opaque-user-id",
    "session_id": "opaque-session-id",
    "access_token": "JWS形式のJWT",
    "refresh_token": "256bit以上のopaque token"
  }
}
```

交換時にセッションとRefresh Tokenを作成します。DBコミット後にアプリが落ちても、handoff codeの期限内で同じverifierを使えば、暗号化して保存した同じ応答を再取得できます。

## 4. Passkey / WebAuthn

DBのchallengeは5分で期限切れになり、登録・認証の完了を問わず一回だけ消費します。WebAuthnのcredential JSON、公開鍵、sign counterをPostgreSQLへ保存します。

### 4.1 登録 options（実装済み）

`POST /api/v1/auth/passkey/register/options`

- Authorization必須（Google OAuth exchangeまたは既存Passkeyで得たAccess Token）。
- Response:

```json
{
  "data": {
    "ceremony_token": "5分だけ有効なopaque token",
    "options": { "publicKey": "WebAuthnの登録options" }
  }
}
```

### 4.2 登録 verify（実装済み）

`POST /api/v1/auth/passkey/register/verify`

- Authorization必須。
- Header: `X-Passkey-Ceremony-Token: <ceremony_token>`
- Body: OS / WebAuthn APIが返したcredential JSONをそのまま送る。
- 成功: `200 { "status": "registered" }`

### 4.3 ログイン options（実装済み）

`POST /api/v1/auth/passkey/login/options`

Bodyを空にするとdiscoverable loginです。既知ユーザーで行う場合だけ次を送れます。

```json
{ "user_id": "opaque-user-id" }
```

Responseの`data.ceremony_token`と`data.options`は登録optionsと同じ形式です。ログインoptions自体にはAccess Tokenは不要です。

### 4.4 ログイン verify（実装済み）

`POST /api/v1/auth/passkey/login/verify`

- Header: `X-Passkey-Ceremony-Token: <ceremony_token>`
- Body: OS / WebAuthn APIが返したassertion JSONをそのまま送る。
- 成功: Google exchangeと同じ`data`形式で新しいセッションを返す。
- 成功時にcredentialのsign counterと`last_used_at`を更新する。

### 4.5 登録済みPasskeyの管理（実装済み）

| Method | Path | 説明 |
| --- | --- | --- |
| GET | `/api/v1/auth/passkey` | 自分のcredential ID、作成日時、最終利用日時を取得 |
| DELETE | `/api/v1/auth/passkey/{credential_id}` | 自分のcredentialだけを削除 |

## 5. JWS Access Token / Refresh Token

### 5.1 Token policy

| Token | 現行値 | 保存 |
| --- | --- | --- |
| Access Token | HS256 JWS-JWT、TTL 1分 | アプリのメモリ優先。Secure Storageへ長期保存しない |
| Refresh Token | 32byte opaque乱数 | アプリSecure Storage。DBはSHA-256 hashのみ |
| Session | 絶対期限90日、アイドル期限30日 | PostgreSQL `sessions` |
| 同一Refresh再送 | 30秒 | PostgreSQL `refresh_attempts`に暗号化レスポンスを保存 |

署名鍵はAPIだけが保持します。JWS claimsの`sid`は`sessions.id`、`sub`は`users.id`です。APIは署名と期限だけでなく、`sid`のセッション状態、期限、アイドル期限、ユーザー状態をDBで確認します。

### 5.2 更新

`POST /api/v1/auth/refresh`

Request（新クライアントは`request_id`を使用。互換のため`refresh_request_id`も受理）:

```json
{
  "refresh_token": "opaque-token",
  "request_id": "client-generated-id"
}
```

処理は対象Refresh Tokenを`FOR UPDATE`でロックし、次を一つのPostgreSQL transactionで実行します。

1. sessionがactive、絶対期限内、アイドル期限内か確認。
2. 未使用なら旧tokenを`used_at`にし、新Refresh Tokenと新Access Tokenを発行。
3. 同じsession・同じrequest ID・同じ旧token hashの成功記録が30秒以内なら、暗号化した同じ応答を返す。
4. 使用済みtokenが別request IDで送られたらreuseとみなし、sessionと全Refresh Tokenを失効し、409を返す。

成功レスポンスはGoogle exchangeと同じ`data`形式です。新しいtokenをSecure Storageへ保存してから、アプリ側の旧tokenを置き換えます。

### 5.3 セッション管理（実装済み）

| Method | Path | 説明 |
| --- | --- | --- |
| POST | `/api/v1/auth/logout` | 現在のsessionとそのRefresh Tokenを失効 |
| POST | `/api/v1/auth/logout-all` | ユーザーの全sessionを失効 |
| GET | `/api/v1/me/sessions` | 有効なsession一覧。token値は返さない |
| DELETE | `/api/v1/me/sessions/{session_id}` | 所有者の指定sessionを失効 |

失効後のAccess Tokenは署名が正しくても、DBのsession確認で拒否されます。

## 6. Key-A envelope・画像・退会

### 6.1 Key-A envelope（実装済み）

Key-Aそのものではなく、Recovery Keyから端末上で導出した鍵で暗号化した値だけを保存します。

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/me/key-envelopes` | Access Token | 自分のenvelope一覧 |
| PUT | `/api/v1/me/key-envelopes/{key_version}` | Access Token | envelopeを作成・同一versionを更新 |
| GET | `/api/v1/me/key-envelopes/{key_version}` | Access Token | 指定version取得 |
| DELETE | `/api/v1/me/key-envelopes/{key_version}` | Access Token | 指定version削除 |

PUT body:

```json
{
  "key_version": "v1",
  "encrypted_key_a": "Base64URLの暗号化済みKey-A",
  "nonce": "Base64URLのAES-GCM nonce",
  "kdf_params": { "algorithm": "scrypt", "salt": "端末側のsalt" }
}
```

サーバーはBase64URL形式・最小長・JSON形式だけを検証し、KDFを実行したりKey-Aを復号したりしません。

### 6.2 画像（実装済み）

画像本体はリクエスト前に端末でAES-256-GCM暗号化し、バイナリ暗号文を送ります。SQLite、DBのbytea、平文ファイルは使用しません。

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/keys/profile-image` | 不要 | profile画像用RSA-OAEP-256公開JWK取得 |
| POST | `/api/v1/me/photos` | Access Token | 暗号文をprivate領域へ保存 |
| GET | `/api/v1/me/photos/{id}` | 所有者Access Token | 暗号文を配信。レスポンスbodyはJSONではない |
| DELETE | `/api/v1/me/photos/{id}` | 所有者Access Token | DB、ファイル、cacheを削除 |
| GET | `/api/v1/profile-photos/{id}` | 不要 | `profile`だけをサーバー復号して表示 |

POSTは次のヘッダーを使用します。

| Header | 内容 |
| --- | --- |
| `X-Photo-Visibility` | `private` または `profile` |
| `X-Photo-Content-Type` | `application/octet-stream`、`image/jpeg`、`image/png`、`image/webp`のいずれか。未指定はoctet-stream |
| `X-Photo-Nonce` | 12byte AES-GCM nonceのBase64URL |
| `X-Photo-Algorithm` | `AES-256-GCM` |
| `X-Photo-Key-Version` | 端末鍵のversion |
| `X-Photo-Wrapped-Key` | 端末側でラップした画像鍵 |
| `X-Photo-Server-Wrapped-Key` | `profile`のみ。API公開RSA鍵でラップした画像鍵 |
| `X-Photo-Wrapping-Algorithm` | 端末側ラップ方式 |

本文は暗号文のみで、既定の最大サイズは20MiBです。Goサーバーのcacheも暗号文だけを保持し、profile配信時に一時生成する平文はcacheしません。
SVG、GIF、HTMLなどブラウザで解釈され得る未許可MIMEは拒否します。profile配信には`X-Content-Type-Options: nosniff`とCSPも付与します。

### 6.3 退会（実装済み）

`DELETE /api/v1/me` に `{"confirm":"DELETE"}` を送り、Access Tokenを認証します。処理中に全sessionを失効し、refresh/passkey/challenge/key envelope/handoff/photo metadataを削除し、暗号文画像フォルダとcacheを削除してからユーザー行を削除します。削除後は旧Access TokenもDBのsession行がないため拒否されます。

### 6.4 未実装業務API

プロフィール、本人確認、募集、検索、マッチ、評価、チャットQUIC用短命Chat Tokenは引き続き予定です。画像平文、Key-A、Key-B、Recovery Key、Refresh TokenをAPIログへ出さない不変条件は全機能に適用します。

## 7. クライアント更新手順

1. 起動、フォアグラウンド復帰、API呼び出し前にAccess Tokenの残り時間を確認する。
2. 残り30秒以下ならクライアント内single-flightでRefreshを一つだけ実行する。
3. 通信結果が不明なら同じ`request_id`で30秒以内に一度だけ再送する。
4. 409 `refresh_reuse_detected`、Refresh失敗、handoff失敗時はAccess/Refreshと一時verifierを削除してログイン画面へ戻す。
5. Refresh TokenはWebSocket・QUICのURLやメッセージへ送らない。Chat TokenはRESTで別発行する。

## 8. 実装追加時の必須更新

実装を追加したら、同じ変更で次を更新します。

- `backend/API_SPEC.md`
- `backend/STATUS.md`
- `backend/TODO.md`
- `docs/features/auth.md` または該当機能仕様
- `docs/database.md` とmigration README
- Go単体テスト、PostgreSQL統合テスト、Expoクライアントの型検査
