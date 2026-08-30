# バックエンド API 仕様（実装基準）

最終更新: 2026-08-27

この文書は、現在のGo実装とExpoテストクライアントの契約です。状態は次の記号で表します。

- **実装済み**: 現在のサーバーコードにルートと処理が存在する。
- **準備中**: DBまたは部品は存在するが、HTTP契約が未実装。
- **予定**: 仕様のみで、クライアントから呼び出してはいけない。

## 1. 共通

- 本番 Base URL: `https://samurai-meet.disnana.com/api/v1`
- ローカル Base URL: `http://127.0.0.1:8080/api/v1`。ネイティブアプリは本番Base URLを通常値とし、ローカル／LANを使う場合だけ環境変数で明示する。自動切替はしない。
- すべての業務APIはGo APIを経由する。SQLiteは使用しない。
- `APP_ENV=production` では `CLIENT_ORIGIN` とWebAuthn Origin/RP IDを公開Originに揃える。単一ホスト構成でPostgreSQLが同一ホストのloopback（`127.0.0.1`、`::1`、`localhost`）に限定される場合だけ、TLSなしの`DB_SSLMODE=disable`を許可する。外部DBは`require`、`verify-ca`、`verify-full`のいずれかを必須とする。
- Content-Type: `application/json; charset=utf-8`
- 募集の利用日・開始／終了時刻は国内利用向けに`Asia/Tokyo`固定の壁時計として解釈する。`timezone`を省略または空にした入力は`Asia/Tokyo`へ正規化し、他のtimezoneは拒否する。`created_at`、`expires_at`、`captured_at`などの絶対時刻はUTCのRFC3339で表す。
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
- `exp://<host>/--/auth` は通常`APP_ENV=development`または`test`だけで許可する。CF Tunnelなどでproduction設定のバックエンドへExpo Goから接続する場合は、`ALLOW_EXPO_GO_REDIRECT=true`を明示したときだけ許可する。APIのorigin（例: `https://samurai-meet.disnana.com`）とアプリの戻り先（`exp://...`）は別の値であり、前者を通っていても後者の形式検証は維持する。
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
    "pre_auth_token": "Passkey専用の5分token",
    "passkey_required": true,
    "passkey_registered": false,
    "recovery_available": false
  }
}
```

Google交換時点では通常のAccess/Refresh sessionを作成しません。`pre_auth_token`はPasskey options/verifyだけに使え、プロフィール、鍵、写真、チャットなどの通常APIには使えません。Passkey成功後に通常のAccess/Refresh sessionを同じDBトランザクションで発行します。DBコミット後にアプリが落ちても、handoff codeの期限内で同じverifierを使えば、暗号化して保存した同じ応答を再取得できます。

### 3.4 Web PasskeyからExpo Goへのセッション復帰（実装済み）

Google交換後の`pre_auth_token`や既存sessionのAccess TokenをWeb URLへ渡してはいけません。Expo Goはまず、Bearer認証付きでbootstrapを発行します。

`POST /api/v1/auth/passkey/bootstrap`

Request:

```json
{
  "scope": "passkey_register",
  "app_redirect_uri": "samuraimeet://auth",
  "app_handoff_challenge": "verifierのSHA-256 Base64URL"
}
```

`scope`は`passkey_register`、`passkey_login`、`passkey_reauth`のいずれかです。初回登録・既知ユーザーログインでは`Authorization: Bearer <pre_auth_token>`、再認証では`Authorization: Bearer <access_token>`を送ります。サーバーはbootstrapのhash、ユーザー、元sessionまたはpre-auth hash、scope、redirect、challenge、期限（現在1分）、使用日時だけを保存し、平文bootstrapは保存しません。

成功レスポンス:

```json
{
  "data": {
    "bootstrap_token": "短命・一回限りのopaque token",
    "scope": "passkey_register",
    "expires_at": "UTC RFC3339"
  }
}
```

Web URLのfragmentに入れてよい認証値は`bootstrap_token`だけです。Access Token、Refresh Token、`pre_auth_token`、ユーザーIDはURLへ入れません。Web画面はbootstrapを`X-Web-Passkey-Token`ヘッダーで送ります。

`POST /api/v1/auth/passkey/web/options`

- Header: `X-Web-Passkey-Token: <bootstrap_token>`
- 成功時はWebAuthn optionsと短命ceremony tokenを返す。
- `Cache-Control: no-store`、`Referrer-Policy: no-referrer`を付ける。
- bootstrapへのceremony binding後の再options、期限切れ、scope不一致は拒否する。Recovery由来のpre-auth登録では、既存credentialを除外せず新しいPasskeyを追加できる。

`POST /api/v1/auth/passkey/web/reset`

- Header: `X-Web-Passkey-Token`と`X-Passkey-Ceremony-Token`
- ブラウザ側のWebAuthn失敗時だけ、現在のceremonyを一回消費してbootstrapとのbindingを解除する。
- 成功後は同じbootstrapで新しいoptionsを一度だけ取得できる。verify競合、使用済みbootstrap、期限切れは`409`または`401`で拒否する。

`POST /api/v1/auth/passkey/web/verify`

- Header: `X-Web-Passkey-Token`と`X-Passkey-Ceremony-Token`
- Body: WebAuthn credential/assertion JSON
- ceremony、bootstrap、元session/pre-authの有効性を確認し、bootstrapを一回消費する。
- 成功時のレスポンスは`handoff_code`と`app_redirect_uri`だけで、Access/Refresh/Pre-auth tokenを返さない。
- レスポンスには`Cache-Control: no-store`、`Referrer-Policy: no-referrer`を付ける。続くsession-handoffのstart/exchangeも同じ機密応答ヘッダーを付ける。

続いてExpo Goが`POST /api/v1/auth/session-handoff/exchange`へ`handoff_code`、Secure Storageの`handoff_verifier`、必須の`request_id`を送ります。使用済みhandoffの再送は、同じrequest IDかつ30秒以内だけ同じ暗号化応答を返します。異なるrequest ID、期限切れ、verifier不一致は拒否します。

## 4. Passkey / WebAuthn

DBのchallengeは5分で期限切れになり、登録・認証の完了を問わず一回だけ消費します。WebAuthnのcredential JSON、公開鍵、sign counterをPostgreSQLへ保存します。

### 4.1 登録 options（実装済み）

`POST /api/v1/auth/passkey/register/options`

- Authorization必須。Google直後は`pre_auth_token`、既存sessionからのPasskey追加はAccess Tokenを送ります。
- WebAuthnの`user.name`と`user.displayName`には`users.display_name`を使い、内部のopaque user IDを表示名として返しません。Googleの表示名が空の場合はメール、最後に`Samurai Meet`へfallbackします。
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
- Access Token経由の追加登録は`200 { "status": "registered" }`、Google直後の初回登録は通常SessionTokensを`data`で返します。

### 4.3 ログイン options（実装済み）

`POST /api/v1/auth/passkey/login/options`

Bodyを空にするとdiscoverable loginです。既知ユーザーで行う場合だけ次を送れます。

```json
{ "user_id": "opaque-user-id" }
```

Responseの`data.ceremony_token`と`data.options`は登録optionsと同じ形式です。Google直後の既知ユーザー認証では`Authorization: Bearer <pre_auth_token>`を送ります。それ以外のdiscoverable loginではAuthorization不要です。

### 4.4 ログイン verify（実装済み）

`POST /api/v1/auth/passkey/login/verify`

- Header: `X-Passkey-Ceremony-Token: <ceremony_token>`
- Google直後の認証では`Authorization: Bearer <pre_auth_token>`も送ります。
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

署名鍵はAPIだけが保持します。headerには固定の`alg=HS256`、`typ=JWT`と鍵識別子`kid`を含めます。検証側は設定済み`kid` allow-listだけを受け付け、鍵ローテーション中は旧鍵で発行済みtokenと暗号化retry/handoffを猶予期間だけ検証・復号できます。JWS claimsの`sid`は`sessions.id`、`sub`は`users.id`です。APIは署名と期限だけでなく、`sid`のセッション状態、期限、アイドル期限、ユーザー状態をDBで確認します。

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

## 6. Client root-key envelope・画像・退会

### 6.1 Client root-key envelope v2（実装済み）

Master Keyそのものではなく、24語Recovery Phraseから端末上で導出した鍵で暗号化したv2 envelopeだけを保存します。`/api/v1`はHTTP URLの互換入口であり、暗号方式のv1を受け付ける意味ではありません。

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/me/key-envelopes` | Access Token + 5分以内のPasskey再認証 | 自分のenvelope一覧 |
| PUT | `/api/v1/me/key-envelopes/{key_version}` | Access Token + 5分以内のPasskey再認証 | envelopeを作成・同一versionを更新 |
| GET | `/api/v1/me/key-envelopes/{key_version}` | Access Token + 5分以内のPasskey再認証 | 指定version取得 |
| DELETE | `/api/v1/me/key-envelopes/{key_version}` | Access Token + 5分以内のPasskey再認証 | 指定version削除 |

PUT body:

```json
{
  "key_version": "v2",
  "encrypted_key_a": "Base64URLの暗号化済みMaster Key",
  "nonce": "Base64URLのAES-GCM nonce",
  "kdf_params": {
    "algorithm": "Argon2id+HKDF-SHA256",
    "salt": "16 byteのBase64URL salt",
    "info": "Base64URL(samurai-meet/recovery-phrase/v2)",
    "data_salt": "16 byteのBase64URL salt",
    "argon2id": {
      "memory_kib": 32768,
      "iterations": 3,
      "parallelism": 1
    }
  },
  "recovery_public_key": "32 byte Ed25519公開鍵のBase64URL"
}
```

`recovery_available`はv2 envelopeにRecovery公開鍵がある場合だけ`true`です。`false`の場合はRecovery Phrase復旧ではなく、Passkey成功後に新しいv2 Recovery Phraseを登録します。未設定アカウントへのRecovery challengeは`409 recovery_not_configured`を返します。旧v1 root envelopeは`410 legacy_key_version_disabled`として扱います。

新しいenvelopeでは上記のKDF値、salt長、data salt長、AES-GCM暗号文長、Ed25519公開鍵長をサーバーも厳密に検証します。ただしサーバーはKDFを実行したりMaster Keyを復号したりせず、Master Key、Recovery Phraseの平文も受け取りません。v1 envelopeは保存・復旧・更新の対象外です。

### 6.1.1 Recovery Phrase proof（実装済み）

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/recovery/challenge` | `passkey_login` / `passkey_register` pre-auth、またはAccess Token + 5分以内のPasskey再認証 | Recovery challengeとenvelopeを取得 |
| POST | `/api/v1/auth/recovery/verify` | challengeを開始した同じpre-authまたはsession | Recovery Phraseで復号したroot由来のEd25519署名を検証 |

challengeは32 byte乱数、TTL 10分、1回限りです。challenge自体はDBへ保存せずSHA-256 hashだけを保存し、署名失敗は最大5回で消費します。最大回数到達後の検証は`429 recovery_rate_limited`（`Retry-After: 3600`）です。pre-auth単位では1時間に10回まで発行します。クライアントはRecovery Phraseを端末内で復号にだけ使い、ローカル復号に失敗した場合もサーバーへ正しい形の無効proofを送って試行回数を同期します。UIでは暗号ライブラリの詳細エラーを表示しません。

`samurai-meet/recovery-proof/v2\n<user_id>\n<key_version>\n<challenge>`（署名鍵は端末内でRecovery Phraseから復号したroot由来）

レスポンスは`Cache-Control: no-store`で、Recovery Phrase・Master Key・Key-Bの平文をレスポンスへ含めません。

### 6.2 端末固有Key-B（実装済み）

Key-Bはアカウント共通のサーバー秘密ではありません。各端末がSecure Storage／Keychain／Keystoreで32 byte乱数を生成し、端末外へ送信せずに保持します。端末Key-BからEd25519公開鍵を導出し、サーバーには公開鍵とランダムな`device_id`だけを登録します。開発・本番とも`KEY_B_WRAP_KEY`は不要です。

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| POST | `/api/v1/me/devices` | Access Token + 5分以内のPasskey再認証 | 端末公開鍵を登録・再確認 |
| GET | `/api/v1/me/devices` | Access Token + 5分以内のPasskey再認証 | 自分の端末登録メタデータ一覧 |

登録bodyは`device_id`、`key_version`、`public_key`（Base64URL）です。同じ`device_id`に別の公開鍵を差し替えることはできません。Key-Bの平文、復号可能な暗号文、秘密鍵はAPIレスポンス・DB・ログに現れません。

画像APIではAccess Tokenに加えて、端末Key-Bで次の署名を毎回検証します。時刻は5分以内、nonceはDBで一回限りにします。

```text
samurai-meet:device-proof/v1
<user_id>
<device_id>
<method>
<request_path>
<timestamp>
<nonce>
<body_sha256_base64url>
```

### 6.3 画像（実装済み）

画像本体はリクエスト前に端末でAES-256-GCM暗号化し、バイナリ暗号文を送ります。SQLite、DBのbytea、平文ファイルは使用しません。

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/keys/profile-image` | 不要 | profile画像用RSA-OAEP-256公開JWK取得 |
| POST | `/api/v1/me/photos` | Access Token + 端末署名 | 暗号文とKey-A/端末Key-Bの画像鍵envelopeを保存 |
| GET | `/api/v1/me/photos/{id}` | 所有者Access Token + 端末署名 | 暗号文と対象端末のenvelopeを配信。bodyはJSONではない |
| PUT | `/api/v1/me/photos/{id}/key-envelope` | 所有者Access Token + 端末署名 | Recovery後の新端末用envelopeを追加 |
| DELETE | `/api/v1/me/photos/{id}` | 所有者Access Token + 端末署名 | DB、ファイル、cacheを削除 |
| GET | `/api/v1/profile-photos/{id}` | 不要 | `profile`だけをサーバー復号して表示 |

POSTは次のヘッダーを使用します。

| Header | 内容 |
| --- | --- |
| `X-Photo-Visibility` | `private` または `profile` |
| `X-Photo-Content-Type` | `application/octet-stream`、`image/jpeg`、`image/png`、`image/webp`のいずれか。未指定はoctet-stream |
| `X-Photo-Nonce` | 12byte AES-GCM nonceのBase64URL |
| `X-Photo-Algorithm` | `AES-256-GCM` |
| `X-Photo-Key-Version` | 端末鍵のversion |
| `X-Photo-Device-ID` | 登録済み端末ID |
| `X-Photo-Wrapped-Key` | 端末Key-Bでラップした画像鍵 |
| `X-Photo-Account-Wrapped-Key` | Key-A由来の鍵でラップした画像鍵。新端末復旧時の再包み用 |
| `X-Photo-Server-Wrapped-Key` | `profile`のみ。API公開RSA鍵でラップした画像鍵 |
| `X-Photo-Wrapping-Algorithm` | 端末側ラップ方式 |

端末署名には`X-Device-Timestamp`、`X-Device-Nonce`、`X-Device-Body-SHA256`、`X-Device-Signature`を使います。本文ハッシュはサーバー側でも検算し、ヘッダーを書き換えただけでは通過できません。

本文は暗号文のみで、既定の最大サイズは20MiBです。Goサーバーのcacheも暗号文だけを保持し、profile配信時に一時生成する平文はcacheしません。
SVG、GIF、HTMLなどブラウザで解釈され得る未許可MIMEは拒否します。profile配信には`X-Content-Type-Options: nosniff`とCSPも付与します。

### 6.4 退会（実装済み）

`DELETE /api/v1/me` に `{"confirm":"DELETE"}` を送り、Access Tokenと5分以内のPasskey再認証を要求します。処理中に全sessionを失効し、refresh/pre-auth/passkey/recovery challenge/auth challenge/key envelope/端末公開鍵/画像envelope/handoff/photo metadataを削除し、暗号文画像フォルダとcacheを削除してからユーザー行を削除します。削除後は旧Access TokenもDBのsession行がないため拒否されます。フロントの削除ボタンはインライン確認後にPasskey再認証を開始しますが、認可の最終判断は常にこのAPIで行います。

### 6.5 プロフィール（実装済み。フロント接続は未実施）

#### 自分のプロフィール取得

`GET /api/v1/me`

Access Tokenを要求し、次の形式を返します。

```json
{
  "data": {
    "user_id": "opaque-user-id",
    "name": "表示名",
    "nationality_code": "JP",
    "bio": "自己紹介",
    "identity_status": "unverified",
    "likes_count": 0,
    "completed": true
  }
}
```

`identity_status`、`likes_count`はサーバー管理値です。プロフィール未作成時の名前は`users.display_name`（Google表示名等の安全なfallback）を返し、国コード・bioは空、`completed`はfalseになります。停止・削除済みユーザーは404 `account_not_found`です。

#### 自分のプロフィール更新

`PATCH /api/v1/me/profile`

Request body:

```json
{
  "name": "表示名",
  "nationality_code": "JP",
  "bio": "あとから変更できる自己紹介"
}
```

指定した項目だけを更新し、指定しない項目は既存値を維持します。`name`は空白を除去した最大64 Unicode code points、`bio`は最大1000 Unicode code points、`nationality_code`は大文字2文字のISO alpha-2コードです。bioの改行・タブ以外の制御文字、不正な国コード、上限超過は400 `invalid_profile`です。成功時は`GET`と同じプロフィールを`data`に入れて返します。プロフィール名は`users.display_name`にも同期し、次回以降のPasskey登録の`user.name` / `user.displayName`に利用します。本人確認状態、いいね数、アイコン参照の更新はこのAPIの対象外です。既存PasskeyのOS側表示名は登録後に変更されません。

`PATCH /api/v1/me` も互換入口として受け付けますが、新しいクライアントは`/me/profile`を使用します。

### 6.6 募集・検索・マッチ（バックエンド実装済み。フロント接続済み・iOS全通しE2E未確認）

#### 募集カード

`POST /api/v1/recruitments/classify`

募集確認前に、認証済みユーザーが入力した`description`を送ります。サーバーだけが`GEMINI_API_KEY`を使用して`gemini-3.1-flash-lite`へ分類を依頼し、`{ "data": { "category": "Food" | "Places" | "Activity" | "Other", "keywords": ["short keyword"] } }`を返します。`keywords`は最大5件の候補で、クライアントはカテゴリ・候補キーワードを公開前に選び直せます。モバイルアプリはGeminiキーを保持しません。分類不能・モデル応答が契約外・Gemini障害時は公開へ進ませず、`502 recruitment_classification_failed`を返します。ユーザーごとは2秒に1回までで、超過時は`429 recruitment_classification_rate_limited`です。APIキー未設定は`503 recruitment_classification_unavailable`です。

`POST /api/v1/recruitments`

Request body:

```json
{
  "category": "Food",
  "available_date": "2026-08-27",
  "start_time": "18:00",
  "end_time": "20:00",
  "timezone": "Asia/Tokyo",
  "keywords": ["食事", "日本語"],
  "description": "駅の近くで交流しましょう",
  "visibility_radius_km": 3,
  "latitude": 35.681236,
  "longitude": 139.767125,
  "location_accuracy_m": 30,
  "status": "open"
}
```

`category`は`Food` / `Places` / `Activity` / `Other`、`status`は`draft` / `open` / `closed`、公開半径は1 / 3 / 5だけを受け付けます。日時は`Asia/Tokyo`固定の壁時計として解釈し、期限は`end_time`から計算します。公開するカードには完成プロフィールが必要です。成功時は201で`{ "data": { ...card } }`を返します。日時入力はISO内部値とJST固定に統一され、自動テストで確認済みです。iOS実機の公開を含む全通しE2Eは未確認です。

`GET /api/v1/recruitments/{id}`は所有者には自身のカードを返し、他ユーザーには期限内の`open` / `matched`だけを返します。`PATCH`は所有者だけが実行でき、`matched`後の内容変更は拒否します。`DELETE`は物理削除ではなく`closed`へ遷移させ、204を返します。

`GET /api/v1/recruitments/mine`は、認証ユーザーが所有する募集カードの一覧を返します。公開検索用の`GET /api/v1/recruitments`とは別の所有者向け一覧です。

#### 検索と現在地

`GET /api/v1/recruitments?keyword=食事&available_date=2026-08-27&start_time=18:00&end_time=20:00&radius_km=3&verified_only=true&latitude=35.681236&longitude=139.767125&limit=20`

`keyword`は複数指定できます。緯度経度を指定しなければ、`POST /api/v1/me/location`で保存した有効な最新位置（保持1時間）を使います。位置がない検索はキーワード・日時検索として扱います。結果は期限内の公開カードだけで、所有者自身とブロック関係にある相手は除外します。正確な座標は返さず、距離は`distance_band`（`within_1_km` / `within_3_km` / `within_5_km`）だけで示します。Authorization付きのプロフィール・マッチング応答には`Cache-Control: no-store`を付けます。

`POST /api/v1/me/location`のbodyは`latitude`、`longitude`、`accuracy_m`、任意の`captured_at`です。緯度経度、精度、取得時刻を検証し、成功時は204です。現行のCI/PostgreSQLイメージにPostGISを追加していないため、距離計算はGoのHaversineです。将来の件数増加時にPostGISへ置き換える際も、レスポンスから正確な座標を出さない契約は維持します。

#### 関心・承認・完了

- `POST /api/v1/recruitments/{id}/interest`: 他ユーザーが関心を1回送る。成功201、重複は409 `interest_already_sent`。
- `GET /api/v1/matches?role=owner&status=pending&limit=50`: 自分の募集カードへ届いた応募一覧を返す。`role`は`all` / `owner` / `requester`、`status`は`pending` / `accepted` / `rejected` / `cancelled` / `blocked` / `expired` / `completed`です。
- `GET /api/v1/matches/{id}`: マッチ参加者だけが、相手の公開プロフィールと募集カードを取得できます。
- `POST /api/v1/matches/{id}/accept`: カード所有者だけが`pending`を`accepted`へ遷移させる。期限切れ・ブロック・不正状態は拒否する。
- `POST /api/v1/matches/{id}/reject`: カード所有者だけが`pending`を`rejected`へ遷移させる。
- `POST /api/v1/matches/{id}/withdraw`: 応募者だけが`pending`を`cancelled`へ遷移させる。取り下げ後も履歴上のmatch行は保持する。
- `POST /api/v1/matches/{id}/complete`: マッチ参加者が`accepted`を`completed`へ遷移させる。

応募一覧・マッチ詳細の成功レスポンスは`{ "data": [ ... ] }` / `{ "data": { ... } }`です。各マッチには`other_user`（認証ユーザーから見た相手の公開プロフィール）と`recruitment`（募集カード）が含まれます。正確な位置情報はどの応答にも含めません。

`accepted`前のチャットAPIはありません。カードは承認後も`matched`として残り、所有者が閉じるか期限切れになるまで追加の関心を受け付けます。

### 6.7 チャット（REST + WebSocket配送 実装済み。フロント接続は未実施）

チャットは`accepted`になったマッチに対して遅延作成されます。`completed`後は履歴の取得と既読更新だけを許可し、新規送信・transport token発行は停止します。ブロック関係がある場合はチャットの存在を推測できないよう404相当で拒否します。

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/chats` | Access Token | 自分のaccepted/completedチャット一覧 |
| GET | `/api/v1/chats/{id}/messages?after=0&limit=50` | Access Token | 暗号化メッセージ履歴。最大100件 |
| POST | `/api/v1/chats/{id}/messages` | Access Token | 暗号化メッセージ送信 |
| POST | `/api/v1/chats/{id}/read` | Access Token | `last_message_sequence`まで既読（クライアントが見た最大`sequence`。最新messageへクランプし前進のみ） |
| POST | `/api/v1/chats/{id}/transport-token` | Access Token | WebSocket用短命Chat Token発行（`transport`は省略時・明示ともに`websocket`のみ。他値は400） |
| GET | `/api/v1/ws/chats/{id}` | Chat Token（接続後の認証フレーム） | リアルタイム配送のWebSocket |
| POST | `/api/v1/chats/{id}/attachments` | Access Token | チャット写真（暗号文BLOB）のアップロード |
| GET | `/api/v1/chats/{id}/attachments/{attachment_id}` | Access Token | チャット写真の暗号文取得 |

送信bodyは次の形式です。

```json
{
  "client_message_id": "端末内で一意な再送用ID",
  "ciphertext": "Base64URL(no padding)",
  "nonce": "12byte AES-GCM nonceのBase64URL",
  "algorithm": "AES-256-GCM",
  "key_version": "v1",
  "attachment_id": "任意。事前にアップロードしたチャット写真のID"
}
```

サーバーは`ciphertext`を復号せず、平文本文・検索用プレビュー・暗号鍵を受け付けません。`client_message_id`は送信者とチャット単位で一意で、同じIDの再送は元のメッセージを返します。暗号文は復号前128KiBまでです。履歴は`sequence`をcursorにして再接続時に補完します。

`POST /read` の `last_message_sequence` は「クライアントが受信した最大`sequence`」を渡すハイウォーターマークで、message行との厳密一致は不要です（`sequence`は全チャット横断の`BIGSERIAL`で1チャット内は歯抜け）。サーバーはその値をそのチャットの最新live messageへクランプし、保存マーカーは前進のみ（`GREATEST`）。`message.read`レシートはクランプ後の実効値を通知します。1未満は`invalid_chat_request`、messageが無いチャットは`chat_not_found`。

メッセージは作成から `CHAT_MESSAGE_RETENTION_DAYS`（既定180日）を過ぎると、6時間ごとのスイープで `deleted_at` を打たれ、暗号文・nonce が消去され、`chat_message_deletions` に監査行が残ります。以後は履歴・未読数・WebSocket 配送のいずれにも現れません。

メッセージ送信はユーザー単位のトークンバケットでレート制限します（`CHAT_SEND_BURST` 既定15、`CHAT_SEND_REFILL_PER_MINUTE` 既定60）。REST/WebSocket で共通の予算を消費し、超過時は REST が `429 {"error":"chat_rate_limited"}` ＋ `Retry-After` ヘッダ、WebSocket が `{"type":"error","code":"rate_limited","retry_after_seconds":N}`（接続は維持、`closing` なし）を返します。クライアントは chat-transport.md §7.2 の自動再送契約に従い `Retry-After` / `retry_after_seconds` を尊重します。

### チャット写真（添付）

`accepted`マッチの参加者は、暗号化した画像をチャットに添付できます。フローは2段階です。

1. `POST /api/v1/chats/{id}/attachments` に**AES-256-GCM暗号文をraw bodyで**送る。メタはヘッダ `X-Chat-Attachment-Content-Type`（`image/jpeg` / `image/png` / `image/webp` / `application/octet-stream`）、`X-Chat-Attachment-Nonce`（12byte b64url）、`X-Chat-Attachment-Algorithm`（`AES-256-GCM`）、`X-Chat-Attachment-Key-Version`。応答は `{ "data": { id, chat_id, content_type, size_bytes, cipher_sha256, nonce, algorithm, key_version, created_at } }`。
2. `POST /api/v1/chats/{id}/messages` の body に `attachment_id` を入れて送信する。参照できるのは**同一チャットで自分がアップロードした未参照の添付**だけ。以後、そのメッセージは `GET /messages` と WebSocket `message.created` / `message.ack` の各要素に `attachment` オブジェクトを持つ。

`GET /api/v1/chats/{id}/attachments/{attachment_id}` は暗号文を `application/octet-stream` で返す（`accepted`/`completed`マッチの参加者のみ、ブロック時は不可）。サーバーは復号せず、EXIF除去はクライアント側の責務。暗号文の上限は `IMAGE_MAX_UPLOAD_BYTES`（既定20MiB）。メッセージから参照されない添付は約24時間後にスイープで削除される。鍵の生成・共有はクライアント契約で、`key_version = "chat-attachment-mvp-v1"` は「添付ごとのランダム鍵を参照元メッセージの暗号化本文で相手へ渡す」前提。

transport tokenはAccess Token・Refresh Tokenと別audience（`samurai-meet-chat`）で、対象chat・session・transportだけに束縛した2分のJWSです。Refresh TokenをWebSocket、WebTransport、URL queryへ送ってはいけません。

`GET /api/v1/ws/chats/{id}` へ接続後、クライアントは5秒以内に `{"type":"auth","chat_token":"<JWS>"}` を送ります（Chat TokenをURL queryに載せない）。サーバーは token・セッション・マッチ・ブロック・チャット状態を検証し `{"type":"auth.ok",…}` を返します。以後のフレームは `message.send` / `message.read` / `typing.start` / `typing.stop` / `ping`（client→server）、`message.created` / `message.ack` / `message.read` / `typing` / `pong` / `error` / `closing`（server→client）。`message.send` は REST の送信と同じ冪等性・バリデーション（暗号文のみ、128KiBまで）で、REST経由の送信・既読も接続中の全ソケットへ配送されます。`message.created` / `message.read` の配送除外はユーザー単位ではなくソケット単位です（送信・既読を発行したソケットだけ除外し、同一ユーザーの他端末には配送する）。`typing` だけは自端末エコー回避のためユーザー単位で除外します。接続中は20秒間隔のheartbeatでセッション・マッチ・ブロックを再確認し、失効時は `closing` を送って切断します。接続維持中の Chat Token ローテーションは `{"type":"token.renew","chat_token":"<新JWS>"}` で行い、成功時 `{"type":"token.renewed","token_seq":N,"token_expires_at":"…"}` を返します。`token_seq` は `(session, chat)` 単位で発行のたびに +1 され、接続は受理済み最大値以下への `token.renew` を `error(stale_token)` で拒否します（接続維持）。期限までに `token.renew` されないと heartbeat が `closing(token_expired)` で切断します。配送はプロセス内ハブで行い、複数APIインスタンス構成は PostgreSQL `LISTEN/NOTIFY` fan-out（`chat_events` チャネル、`cluster.go`）で対応します。他インスタンス発の `message.created` / `message.read` / `typing` は各インスタンスがローカルソケットへ再配送し、NOTIFY 取りこぼしは再接続時の `sequence` cursor 補完で回収します。

### 6.8 会合セッション・Bluetooth／位置推測の補助（バックエンド実装済み。実測はクライアント）

承認済みマッチの参加者は、会合セッションを1件作成できます。

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| POST | `/api/v1/matches/{id}/meeting` | Access Token | 会合セッション作成（任意の予定時刻） |
| GET | `/api/v1/meetings/{id}` | Access Token | 自分の会合セッション取得 |
| POST | `/api/v1/meetings/{id}/start` | Access Token | `planned`から`active`へ開始 |
| POST | `/api/v1/meetings/{id}/end` | Access Token | `active`から`completed`へ終了 |
| GET | `/api/v1/meetings/{id}/proximity` | Access Token | 直近5分の距離補助値取得 |
| POST | `/api/v1/meetings/{id}/proximity` | Access Token | 端末が推定した距離補助値を送信 |

proximityのbodyは次の形式です。

```json
{
  "method": "bluetooth_rssi",
  "distance_m": 2.5,
  "confidence": 0.8,
  "sample_id": "端末内のサンプルID",
  "captured_at": "2026-08-26T12:00:00Z"
}
```

`method`は`bluetooth_rssi`、`bluetooth_uwb`、`location_inference`のいずれかです。サーバーはBluetoothを測定・検証しないため、応答の`verified`は常にfalse、`source`は`client_estimate`です。距離・信頼度は範囲検証するだけで、本人確認、入場許可、マッチ成立、課金、安全判定の根拠には使いません。端末のBLE MAC、RSSI生値、ビーコン識別子、緯度経度はAPIへ送らず保存もしません。

DBには会合中の参加者ごと・方式ごとに最新1件だけを保持し、取得時刻から5分を超えた値は返しません。会合終了時に補助値を削除します。実際のBLE/UWB測定、OS権限、近接UIはネイティブクライアントの責務です。

### 6.9 通知一覧・未読管理（実装済み）

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/notifications?unread_only=false&limit=50` | Access Token | 直近7日間の通知一覧 |
| POST | `/api/v1/notifications/{id}/read` | Access Token | 自分の通知を既読にする（冪等） |

通知は応募、承認・辞退、暗号化チャットメッセージの作成と同じDBトランザクションで保存します。`event_key`で冪等化し、一覧はユーザー本人の通知だけを返します。通知本文はクライアントが言語別に生成し、チャットの平文・暗号文・鍵は通知へ保存しません。現在のクライアントはExpo画面からこの一覧と既読APIを利用します。これはアプリ内通知であり、`expo-notifications`等によるOSプッシュ通知は未実装です。

### 6.10 通報・ブロック（実装済み）

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| POST | `/api/v1/reports` | Access Token | 通報の登録 |
| GET | `/api/v1/me/blocks` | Access Token | 自分がブロックした相手の一覧 |
| POST | `/api/v1/blocks` | Access Token | ユーザーをブロック（冪等、204） |
| DELETE | `/api/v1/blocks/{user_id}` | Access Token | ブロック解除（204、未ブロックは404） |

通報bodyは`{"target_type","target_id","reason","comment"}`。`target_type`は`user` / `recruitment_card` / `message` / `photo`、`reason`は`nuisance` / `harassment` / `impersonation` / `inappropriate_photo` / `dangerous` / `other`、`comment`は任意で最大1000 Unicode（サーバー上限2000）。自分自身・存在しないユーザーへの通報は拒否します。同一通報者×同一対象で未処理（`received` / `reviewing`）の通報がある場合は、新規作成せず既存の通報を`data`に入れて201で返します。通報者情報は対象者へ返しません。ブロックは`0019`の`blocks`テーブルを使い、`matching` / `chat` が既にアクセス制御で参照しています。運営キュー（`GET/PATCH /admin/reports`）と`audit_logs`は次の作業です。

### 6.11 未実装業務API

本人確認（Stripe Identity等）、評価、チャット内写真送信、通報の運営キューは引き続き予定です。Stripe Identityを採用する場合も、Stripe Webhookの署名検証・イベント冪等性・対象ユーザー紐付けが成功するまで`identity_status=verified`へ遷移させません。画像平文、Key-A、Key-B、Recovery Key、Refresh TokenをAPIログへ出さない不変条件は全機能に適用します。

## 7. クライアント更新手順

1. 起動、フォアグラウンド復帰、API呼び出し前にAccess Tokenの残り時間を確認する。
2. 残り30秒以下ならクライアント内single-flightでRefreshを一つだけ実行する。
3. 通信結果が不明なら同じ`request_id`で30秒以内に一度だけ再送する。
4. 409 `refresh_reuse_detected`、Refresh失敗、handoff失敗時はAccess/Refreshと一時verifierを削除してログイン画面へ戻す。
5. Refresh TokenはQUICのURLやメッセージへ送らない。Chat TokenはRESTで別発行する。

## 8. 実装追加時の必須更新

実装を追加したら、同じ変更で次を更新します。

- `backend/API_SPEC.md`
- `backend/STATUS.md`
- `backend/TODO.md`
- `docs/features/auth.md` または該当機能仕様
- `docs/database.md` とmigration README
- Go単体テスト、PostgreSQL統合テスト、Expoクライアントの型検査
