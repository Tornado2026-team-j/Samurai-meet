# API仕様書

最終更新: 2026-08-24

現在のGo実装との厳密な契約は [backend/API_SPEC.md](../backend/API_SPEC.md) を正とする。この文書では、フロントエンドが使う公開APIを、実装済みと予定に分けて一覧化する。

## 1. 共通

- 本番Base URL: `https://samurai-meet.disnana.com/api/v1`
- ローカルBase URL: `http://127.0.0.1:8080/api/v1`
- JSON / UTF-8、時刻はUTC RFC3339
- 現行サービスIDはopaque `TEXT`。UUID文字列であると仮定しない。
- 保護APIは`Authorization: Bearer <access_token>`。
- エラーは現行実装では`{ "error": "code" }`。将来、messageやfieldを含む共通形式へ移行する。

## 2. 実装済みAPI

### ヘルス

| Method | Path | 認証 |
| --- | --- | --- |
| GET | `/healthz` / `/api/v1/healthz` | 不要 |
| GET | `/readyz` / `/api/v1/readyz` | 不要 |

### Google OAuth / OIDC

| Method | Path | 認証 |
| --- | --- | --- |
| GET | `/api/v1/auth/google/start?app_redirect_uri=...&handoff_challenge=...` | 不要 |
| GET | `/auth/callback` | Googleからのcallback |
| POST | `/api/v1/auth/google/exchange` | 不要 |

`start`はアプリhandoff verifierのchallengeを受け取り、API内部でstateとGoogle PKCEを保存する。Google Consoleのredirect URIは次だけである。

```text
https://samurai-meet.disnana.com/auth/callback
```

`exchange`のrequest:

```json
{
  "handoff_code": "callbackからの一回限りcode",
  "handoff_verifier": "端末Secure Storageのverifier"
}
```

成功時:

```json
{
  "data": {
    "user_id": "opaque-user-id",
    "session_id": "opaque-session-id",
    "access_token": "JWS-JWT",
    "refresh_token": "opaque-token"
  }
}
```

アプリURIの許可値は、本番`samuraimeet://auth`、開発用Expo Goの`samuraimeettest://auth`または`exp://<host>/--/auth`。Expo Goの`exp://`は`ALLOW_EXPO_GO_REDIRECT=true`を設定した開発確認時だけ許可する。

handoff codeは10分で失効し、一回使用後に消費する。同じverifierで期限内に再送した場合だけ、サーバーが保存した暗号化レスポンスを返す。アプリがOAuth途中で落ちても、Secure Storageのverifierを消さなければ再開できる。

### Passkey / WebAuthn

| Method | Path | 認証 | 状態 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/passkey/register/options` | Access Token | 実装済み |
| POST | `/api/v1/auth/passkey/register/verify` | Access Token + ceremony header | 実装済み |
| POST | `/api/v1/auth/passkey/login/options` | 不要 | 実装済み |
| POST | `/api/v1/auth/passkey/login/verify` | ceremony header | 実装済み |
| GET | `/api/v1/auth/passkey` | Access Token | 実装済み |
| DELETE | `/api/v1/auth/passkey/{credential_id}` | Access Token | 実装済み |

optionsの成功レスポンスは`data.ceremony_token`と`data.options`。verifyでは`X-Passkey-Ceremony-Token`ヘッダーへtokenを入れ、bodyはOSのcredential/assertion JSONをそのまま送る。challengeは5分・一回限り。実機検証はExpo GoではなくDevelopment Buildを使う。

### セッション

| Method | Path | 認証 | 状態 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/refresh` | Refresh body | 実装済み |
| POST | `/api/v1/auth/logout` | Access Token | 実装済み |
| POST | `/api/v1/auth/logout-all` | Access Token | 実装済み |
| GET | `/api/v1/me/sessions` | Access Token | 実装済み |
| DELETE | `/api/v1/me/sessions/{session_id}` | Access Token | 実装済み |

Refresh request:

```json
{
  "refresh_token": "opaque-token",
  "request_id": "client-generated-id"
}
```

互換のため`refresh_request_id`も受理する。Access TokenはHS256 JWS-JWTで1分、sessionは絶対90日・アイドル30日。Refresh Tokenは32byte乱数で、DBにはhashだけを保存する。更新ごとにrotationし、同じrequest IDだけ30秒再送可能。別request IDの使用済みtokenはreuseとしてsession family全体を失効し、409を返す。

## 3. 未実装API（契約案）

次のAPIはルート未接続である。フロントエンドは実装済みになるまで呼び出してはいけない。

### プロフィール・本人確認

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/me` | 自分のユーザー・プロフィール取得 |
| PATCH | `/api/v1/me/profile` | 名前、国籍、自己紹介、アイコン参照の更新 |
| POST | `/api/v1/me/verification` | 本人確認開始 |
| DELETE | `/api/v1/me` | 退会と削除workflow開始 |

### 募集・検索・マッチ

| Method | Path | 用途 |
| --- | --- | --- |
| POST | `/api/v1/recruitments` | 日時、時間帯、keywords、表示半径1/3/5kmで募集作成 |
| GET | `/api/v1/recruitments` | 現在地とkeywordで検索 |
| PATCH/DELETE | `/api/v1/recruitments/{id}` | 募集更新・削除 |
| POST | `/api/v1/recruitments/{id}/interest` | 関心を送る |
| POST | `/api/v1/matches/{id}/accept` | 相互承認 |
| POST | `/api/v1/matches/{id}/reviews` | 相互評価 |

正確な現在地は他ユーザーへ返さず、距離判定だけに利用する。PostGISを使う場合もDBはPostgreSQLのまま。

### 画像・鍵

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/crypto/profile-wrapping-key` | RSA-OAEP-256公開鍵配信 |
| POST | `/api/v1/photos` | 端末でAES-256-GCM暗号化した暗号文を保存 |
| GET | `/api/v1/photos/{id}` | 認可済み暗号文をストリーム配信 |
| DELETE | `/api/v1/photos/{id}` | DB、privateファイル、cacheを削除 |
| POST | `/api/v1/recovery/envelopes` | 暗号化Key-A envelope保存 |
| GET | `/api/v1/recovery/envelopes` | 認証・再認証後にenvelope取得 |

画像平文、画像鍵、Key-A、Key-B、Recovery KeyはAPIログ・DB・cacheへ保存しない。profile画像はサーバー公開鍵で画像鍵をwrapし、private画像は端末側鍵を使う。

### チャット

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/chats` | チャット一覧 |
| GET | `/api/v1/chats/{id}/messages` | 履歴取得 |
| POST | `/api/v1/chats/{id}/transport-token` | 対象chat専用短命token |

QUIC / WebTransport / WebSocketのChat TokenはAccess TokenやRefresh Tokenと別audienceで発行し、Refresh Tokenを通信路へ送らない。

## 4. Token更新タイミング

1. アプリ起動、フォアグラウンド復帰、API呼び出し前にAccess Tokenの残りを確認する。
2. 残り30秒以下ならsingle-flightでRefreshを一つだけ実行する。
3. 通信結果が不明なら同じ`request_id`で30秒以内に再送する。
4. 新tokenのSecure Storage保存後に旧tokenを置き換える。
5. Refresh失敗、409 reuse、session失効時はAccess/Refreshを削除し、GoogleまたはPasskeyへ戻る。
6. バックグラウンド中に定期Refreshしない。

Key-B取得、Recovery、新端末登録、本人確認変更、退会はRefreshだけでは許可せず、直近Passkey再認証を要求する予定である。

## 5. 実装変更時の同期対象

APIを実装・変更したら、次を同じ変更で更新する。

- `backend/API_SPEC.md`
- `docs/features/<feature>.md`
- `docs/database.md`とmigration
- `backend/STATUS.md` / `backend/TODO.md`
- Go単体・PostgreSQL統合・Python smoke・Expo typecheck
