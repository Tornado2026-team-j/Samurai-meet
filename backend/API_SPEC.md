# バックエンド API 仕様

最終更新: 2026-08-24

この文書は Expo / React Native クライアントとの契約です。**実装済み**と**実装予定**を必ず区別します。実装予定の API をクライアントから本番利用してはいけません。

## 1. 共通

- Base URL（ローカル）: `http://127.0.0.1:8080/api/v1`
- Base URL（本番）: `https://samurai-meet.disnana.com/api/v1`
- Content-Type: `application/json; charset=utf-8`
- 認証済み API: `Authorization: Bearer <access_token>`
- Access Token: JWS / JWT、寿命 1 分
- Refresh Token: 256 bit 不透明 token。Secure Storage のみへ保存し、ログ/URL/LocalStorage へ出さない
- 以下の認証・業務APIにある `/auth/...` は Base URL からの相対パスであり、公開URLは `/api/v1/auth/...` となる。

### 共通エラー形式（実装予定）

```json
{
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "アクセストークンの有効期限が切れています。"
  }
}
```

| HTTP | code | クライアント動作 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 入力を修正して再送 |
| 401 | `TOKEN_EXPIRED` | Refresh を一度だけ行い、元リクエストを一度だけ再送 |
| 401 | `SESSION_REVOKED` | 保存済み token を消去し、ログイン画面へ |
| 403 | `FORBIDDEN` | 操作を中止し理由を表示 |
| 409 | `REFRESH_REUSE_DETECTED` | token を消去し、再ログインへ |

## 2. 現在実装済み API

### `GET /api/v1/healthz`

認証不要。サーバープロセスの生存確認です。

```json
{ "status": "ok" }
```

### `GET /api/v1/readyz`

認証不要。起動済み API の ready 状態です。

```json
{ "status": "ready" }
```

## 3. 認証 API（実装予定）

### `GET /api/v1/auth/google/start`

Google OAuth2 / OIDC を開始します。クライアントは `state` と PKCE verifier を端末メモリに保持します。

| query | 必須 | 説明 |
| --- | --- | --- |
| `state` | はい | CSRF 対策のランダム値 |
| `app_redirect_uri` | はい | 登録済みアプリ固有のdeep link URI |
| `handoff_challenge` | はい | アプリが保持するhandoff verifierのSHA-256 challenge |

### `POST /api/v1/auth/google/exchange`

Google authorization code をバックエンドで交換・検証します。

```json
{
  "handoff_code": "callbackから受け取った一回限りコード",
  "handoff_verifier": "Secure Storageに保存した検証値"
}
```

```json
{
  "data": {
    "user_id": "uuid",
    "is_new_user": true,
    "requires_passkey": true,
    "pre_auth_token": "短命token",
    "pre_auth_token_expires_at": "2026-08-24T00:05:00Z"
  }
}
```

`pre_auth_token` は 5 分・一回限りで、Passkey API にしか使えません。通常 API、画像 API、Key-B API には使えません。

### Passkey API

| API | 用途 | 状態 |
| --- | --- | --- |
| `POST /auth/passkey/register/options` | registration challenge を取得 | 実装予定 |
| `POST /auth/passkey/register/verify` | credential を検証・保存し通常 session を作成 | 実装予定 |
| `POST /auth/passkey/login/options` | login challenge を取得 | 実装予定 |
| `POST /auth/passkey/login/verify` | assertion を検証し通常 session を作成 | 実装予定 |

Passkey 成功後の token 応答:

```json
{
  "data": {
    "access_token": "jws.jwt",
    "access_token_expires_at": "2026-08-24T00:01:00Z",
    "refresh_token": "opaque-token",
    "session_id": "uuid"
  }
}
```

### `POST /auth/refresh`

```json
{
  "refresh_token": "opaque-token",
  "refresh_request_id": "uuid"
}
```

- Access Token の残りが 30 秒以下のときだけ実行する。
- 同じ `refresh_request_id` は 30 秒だけ同じ結果を再取得できる。
- 別の request ID で使用済み Refresh Token を送った場合、同じ token family を失効する。
- 新しい token を Secure Storage へ保存してから旧 token を置換する。

### ログアウト・セッション（実装予定）

| API | 動作 |
| --- | --- |
| `POST /auth/logout` | 現在 session と Refresh Token を失効 |
| `POST /auth/logout-all` | 全端末の session と Refresh Token を失効 |
| `GET /me/sessions` | 自端末の session 一覧を取得 |
| `DELETE /me/sessions/{session_id}` | 指定端末を失効 |

## 4. 画像 API（実装予定）

### 端末側暗号化の原則

1. 端末で画像ごとのランダムな 256 bit 画像鍵を生成する。
2. 端末で AES-256-GCM 暗号化する。
3. 暗号文、nonce、暗号文 SHA-256、鍵ラップ情報だけを送信する。
4. 画像平文、Key-A、Key-B、Recovery Key を送信・ログ保存しない。

### `GET /crypto/profile-wrapping-key`

プロフィール画像用のサーバー公開鍵（RSA-OAEP-256 JWK）を返します。端末は画像鍵をこの公開鍵でラップします。

```json
{
  "data": {
    "kty": "RSA",
    "alg": "RSA-OAEP-256",
    "use": "enc",
    "n": "base64url-modulus",
    "e": "AQAB",
    "key_version": "v1"
  }
}
```

### `POST /photos`

`multipart/form-data` またはバイナリ upload の詳細は実装と同時に確定します。必須メタデータは以下です。

| フィールド | 説明 |
| --- | --- |
| `visibility` | `private` または `profile` |
| `ciphertext` | AES-GCM 暗号文 |
| `nonce` | Base64URL nonce |
| `cipher_sha256` | 暗号文の SHA-256 hex |
| `key_version` | 鍵バージョン |
| `wrapped_image_key` | private は端末鍵、profile は RSA-OAEP-256 でラップした画像鍵 |

暗号文は private フォルダに保存し、PostgreSQL の `photos` テーブルにはメタデータだけを保存します。

### 削除と退会

`DELETE /photos/{photo_id}` と退会処理では、DB の公開状態を失効し、暗号文ファイルを削除し、メモリの暗号文キャッシュも即時無効化します。

## 5. フロントエンドの token 更新規約

1. アプリ起動・フォアグラウンド復帰・API 呼び出し前に Access Token の残り時間を確認する。
2. 残り 30 秒以下なら single-flight で一つだけ Refresh を実行する。
3. `401 TOKEN_EXPIRED` の場合だけ Refresh して元リクエストを一度だけ再送する。
4. Refresh の結果が不明なら、**同じ** `refresh_request_id` だけを再送する。
5. 失敗したら Access / Refresh Token を両方消し、Google + Passkey ログインへ戻る。
6. バックグラウンド中に定期 Refresh をしない。

## 6. 実装を追加する人へ

API を実装したら、同じコミットでこの文書、[STATUS.md](STATUS.md)、[TODO.md](TODO.md)、`docs/api.md` を更新する。仕様と実装が食い違う場合、実装前に仕様を明確化する。
