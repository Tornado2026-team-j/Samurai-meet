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
    "pre_auth_token": "short-lived-opaque-token",
    "passkey_required": true,
    "passkey_registered": false,
    "recovery_available": false
  }
}
```

`recovery_available`は既存のKey-A envelopeにRecovery公開鍵がある場合だけ`true`です。`false`の場合はRecovery Key復旧ではなく、Passkey成功後に新しいRecovery Keyを登録します。未設定アカウントへのRecovery challengeは`409 recovery_not_configured`を返します。

Google交換時点では通常sessionを発行しない。`pre_auth_token`はExpo Goがbootstrap発行にBearerで使う短命の内部資格情報で、Web URLへ渡してはいけません。アプリURIの許可値は、本番`samuraimeet://auth`、開発用Expo Goの`samuraimeettest://auth`または`exp://<host>/--/auth`です。ブラウザ開発クライアントは、設定済みOriginの`/auth/complete`だけを完全一致で許可します。Expo Goの`exp://`は`ALLOW_EXPO_GO_REDIRECT=true`を設定した開発確認時だけ許可する。

OAuth handoff codeは10分で失効し、一回使用後に消費する。同じverifierで期限内に再送した場合だけ、サーバーが保存した暗号化レスポンスを返す。アプリがOAuth途中で落ちても、Secure Storageのverifierを保持すれば再開できる。Web Passkey後のsession handoffは別APIで、同じverifierに加えて同じ`request_id`を30秒以内に送る場合だけ再送できます。

Web PasskeyからExpo Goへ戻す場合は、Expo Goが`POST /auth/passkey/bootstrap`を呼び、返された短命bootstrap tokenだけをWeb URL fragmentへ渡します。Web画面は`X-Web-Passkey-Token`と`X-Passkey-Ceremony-Token`でoptions/verifyを呼び、成功時はhandoff codeだけを返します。Webレスポンスは`no-store`です。Google直後の`pre_auth_token`やAccess TokenをURLに含めません。

Bootstrap request:

```json
{
  "scope": "passkey_register",
  "app_redirect_uri": "samuraimeet://auth",
  "app_handoff_challenge": "SHA-256 Base64URL"
}
```

`/auth/passkey/web/options`、`/auth/passkey/web/reset`、`/auth/passkey/web/verify`はWebAuthn専用のブラウザAPIです。bootstrapは現在1分、ceremonyは5分、一回限りで、サーバーにはtoken hashだけを保存します。ブラウザ側のWebAuthn失敗時はresetで旧ceremonyを無効化してから、新しいoptionsを取得できます。Recovery検証が成功したpre-auth登録では、旧Passkeyを同一トランザクションで失効させてから、新しいcredentialを登録します。端末側に残る古いcredentialを再登録画面の除外対象にしないため、同じ端末でも再登録できます。verify成功時のJSONは`handoff_code`と`app_redirect_uri`だけです。

Web Passkey後のsession handoff:

| Method | Path | 認証 |
| --- | --- | --- |
| POST | `/api/v1/auth/session-handoff/start` | Access Token + 直近Passkey |
| POST | `/api/v1/auth/session-handoff/exchange` | `handoff_code` + verifier + `request_id` |

`exchange`の`request_id`は空白不可・128文字以内です。使用済みcodeの再送は、正しいverifierと同じ`request_id`を30秒以内に送った場合だけ許可されます。session handoffのstart/exchange応答は`Cache-Control: no-store`と`Referrer-Policy: no-referrer`を付けます。

### Passkey / WebAuthn

| Method | Path | 認証 | 状態 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/passkey/register/options` | Access Token | 実装済み |
| POST | `/api/v1/auth/passkey/register/verify` | Access Token + ceremony header | 実装済み |
| POST | `/api/v1/auth/passkey/login/options` | 不要 | 実装済み |
| POST | `/api/v1/auth/passkey/login/verify` | ceremony header | 実装済み |
| POST | `/api/v1/auth/passkey/reauth/options` | Access Token | 実装済み |
| POST | `/api/v1/auth/passkey/reauth/verify` | Access Token + ceremony header | 実装済み |
| GET | `/api/v1/auth/passkey` | Access Token | 実装済み |
| DELETE | `/api/v1/auth/passkey/{credential_id}` | Access Token | 実装済み |
| POST | `/api/v1/auth/passkey/bootstrap` | Access Tokenまたはpre-auth | 実装済み |
| POST | `/api/v1/auth/passkey/web/options` | `X-Web-Passkey-Token` | 実装済み |
| POST | `/api/v1/auth/passkey/web/reset` | bootstrap + ceremony header | 実装済み |
| POST | `/api/v1/auth/passkey/web/verify` | bootstrap + ceremony header | 実装済み |

optionsの成功レスポンスは`data.ceremony_token`と`data.options`。verifyでは`X-Passkey-Ceremony-Token`ヘッダーへtokenを入れ、bodyはOSのcredential/assertion JSONをそのまま送る。challengeは5分・一回限り。ブラウザ検証はHTTPSまたはlocalhost、native実機検証はExpo GoではなくDevelopment Buildを使う。

reauthは既存sessionのユーザーに対するPasskey assertionを検証し、成功時に`sessions.last_passkey_at`だけを更新する。新しいsessionやtokenは発行しない。Key-B、退会、Recoveryなどの高権限APIはこの直近認証境界を要求する。

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

## 3. 未実装API

### プロフィール・本人確認（未実装）

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/me` | 自分のユーザー・プロフィール取得 |
| PATCH | `/api/v1/me/profile` | 名前、国籍、自己紹介、アイコン参照の更新 |
| POST | `/api/v1/me/verification` | 本人確認開始 |

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

### 画像・鍵（実装済み）

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/keys/profile-image` | RSA-OAEP-256公開JWK配信 |
| POST | `/api/v1/me/photos` | 端末でAES-256-GCM暗号化した暗号文を保存 |
| GET | `/api/v1/me/photos/{id}` | 所有者向け暗号文を配信 |
| DELETE | `/api/v1/me/photos/{id}` | DB、privateファイル、cacheを削除 |
| GET | `/api/v1/profile-photos/{id}` | profile画像だけをサーバー復号して配信 |
| GET | `/api/v1/me/key-envelopes` | Access Tokenと5分以内のPasskey再認証が必要な暗号化Key-A envelope一覧 |
| PUT | `/api/v1/me/key-envelopes/{key_version}` | Access Tokenと5分以内のPasskey再認証が必要な暗号化Key-A envelope保存・version更新 |
| GET | `/api/v1/me/key-envelopes/{key_version}` | Access Tokenと5分以内のPasskey再認証が必要な指定version取得 |
| DELETE | `/api/v1/me/key-envelopes/{key_version}` | Access Tokenと5分以内のPasskey再認証が必要な指定version削除 |
| POST | `/api/v1/me/devices` | Access Tokenと5分以内のPasskey再認証が必要な端末公開鍵登録 |
| GET | `/api/v1/me/devices` | Access Tokenと5分以内のPasskey再認証が必要な端末メタデータ一覧 |
| POST | `/api/v1/auth/recovery/challenge` | pre-authまたはAccess Token + 5分以内のPasskey再認証でRecovery challenge取得 |
| POST | `/api/v1/auth/recovery/verify` | 同じ認証主体のchallengeにKey-A由来の署名を提示 |
| DELETE | `/api/v1/me` | Access Tokenと5分以内のPasskey再認証、およびconfirm付きの退会・完全削除 |

画像平文、画像鍵、Key-A、Key-B、Recovery KeyはAPIログへ出さない。Key-Bは端末ごとにSecure Storageへ生成・保存し、サーバーへは公開鍵と`device_id`だけを登録する。private画像の各リクエストは端末Key-B由来の署名、時刻、ワンタイムnonce、body hashを要求し、サーバー単独で画像を復号できない。`KEY_B_WRAP_KEY`やサーバーからのKey-B取得APIは使用しない。Key-A/Key-BのHKDF結合、Recovery proof、Secure Storage保存、既存Key-A/data saltを維持したRecovery Key再生成は実装済み。Recovery challengeはhashのみをDBに保存し、TTL・最大5回の検証試行・1時間あたり10回の発行制限を設ける。profile画像はサーバー公開鍵で画像鍵をwrapして互換配信し、private画像は端末側鍵を使う。画像uploadの正確な`X-Photo-*`ヘッダーは [backend/API_SPEC.md](../backend/API_SPEC.md) を参照する。

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

端末登録、Key-A envelope、Recoveryのsession経路、退会はRefreshだけでは許可せず、直近Passkey再認証を要求する。Recoveryの新端末経路はGoogle後の短命pre-authに限定し、challenge開始とverifyで同じpre-auth hash・scope・userを再検証する。端末画像APIはAccess Tokenだけで完結させず、端末Key-Bのproofも要求する。

## 5. 実装変更時の同期対象

APIを実装・変更したら、次を同じ変更で更新する。

- `backend/API_SPEC.md`
- `docs/features/<feature>.md`
- `docs/database.md`とmigration
- `backend/STATUS.md` / `backend/TODO.md`
- Go単体・PostgreSQL統合・Python smoke・Expo typecheck
