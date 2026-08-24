# API 仕様書

## 1. 共通仕様

### 1.1 基本

- Base URL：`https://samurai-meet.disnana.com/api/v1`
- データ形式：JSON / UTF-8
- 日時：ISO 8601、保存は UTC、表示はユーザーのタイムゾーン
- ID：UUID
- 認証：`Authorization: Bearer <access_token>`
- すべての業務 API は Go API を経由する。この文書のパスは上記 Base URL からの相対パスである。

### 1.2 共通レスポンス

成功時の例：

```json
{
  "data": {},
  "request_id": "req_01J..."
}
```

エラー時の例：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力内容を確認してください",
    "fields": {
      "visibility_radius_km": "1、3、5のいずれかを指定してください"
    }
  },
  "request_id": "req_01J..."
}
```

### 1.3 ステータスコード

| Status | 用途 |
| --- | --- |
| `200` | 取得・更新成功 |
| `201` | 作成成功 |
| `204` | 削除・ログアウト成功 |
| `400` | 入力不正 |
| `401` | 未認証・トークン無効 |
| `403` | 権限不足、ブロック、本人確認条件不成立 |
| `404` | 対象なし、または存在を秘匿 |
| `409` | 重複、状態競合、冪等性競合 |
| `413` | ファイルサイズ超過 |
| `429` | レート制限 |
| `500` | サーバー内部エラー |

### 1.4 セッション・トークン方式

リフレッシュトークンは技術上の必須要件ではありません。しかし、モバイルアプリでログイン状態を維持しながらアクセストークンを短命にするため、本サービスでは採用します。

| トークン | 方式 | 有効期間（暫定） | 保存場所 | 役割 |
| --- | --- | --- | --- | --- |
| Access Token | JWS 署名付き JWT | 1 分（案） | 端末のメモリを優先 | API の短期認証。更新時は旧 token の `exp` まで自然に重複 |
| Refresh Token | 暗号学的乱数の不透明トークン | 30 日のアイドル期限、90 日の絶対期限 | 端末の Secure Storage。DB はハッシュのみ | Access Token の更新 |

ここでいう JWS は署名形式であり、JWT は claims を持つトークン形式です。Access Token は JWS で署名した JWT として扱います。

Access Token の claims（案）：

```json
{
  "iss": "samurai-meet-api",
  "aud": "samurai-meet-mobile",
  "sub": "user-uuid",
  "sid": "session-uuid",
  "jti": "access-token-uuid",
  "iat": 1724414400,
  "exp": 1724415000,
  "scope": ["user"]
}
```

- `sid` は DB の `sessions.id` と一致させる。
- Access Token は 1 分を基本とし、残り約 30 秒で次の token を発行する。
- 新 Access Token を受け取った後も、旧 Access Token は自身の `exp` までは受け付ける。旧 token を更新のたびに DB で個別失効させない。
- API は JWS 署名、`iss`、`aud`、`iat`、`exp` を検証した後、`sid` の DB セッションが失効していないか確認する。
- Refresh Token は JWT にせず、256 bit 以上の乱数を使った不透明トークンとする。
- DB には Refresh Token の平文を保存せず、ハッシュ値だけを保存する。
- Refresh Token は使用ごとにローテーションする。古い token の再利用を検知したら、同じセッションの token family を失効させる。
- JWS の署名鍵はアプリへ埋め込まず、KMS / Secret Manager で管理する。

## 2. 認証 API

### `GET /auth/google/start`

Google OAuth2 / OIDC の認証を開始します。モバイルでは PKCE を利用します。

認証後、単一のWebコールバック `https://samurai-meet.disnana.com/auth/callback` へ戻し、アプリは `POST /auth/google/exchange` を呼び出します。

### `POST /auth/google/exchange`

Request：

```json
{
  "code": "authorization_code",
  "code_verifier": "pkce_verifier",
  "redirect_uri": "https://samurai-meet.disnana.com/auth/callback"
}
```

Response：

```json
{
  "data": {
    "user_id": "uuid",
    "is_new_user": true,
    "requires_passkey": true,
    "pre_auth_token": "short-lived-pre-auth-token",
    "pre_auth_token_expires_at": "2026-08-23T12:05:00Z"
  }
}
```

`pre_auth_token` は Passkey 登録・認証用の短命トークンであり、通常のプロフィール・チャット・Key-B API には利用できません。通常の Access / Refresh Token と `session_id` は、Passkey の登録・認証成功後に発行します。

`pre_auth_token` は 5 分以内の有効期限、Passkey 用 scope、OAuth 認証イベントとの紐付け、一回使用後の DB 失効を必須とします。

サーバーは Google の issuer、audience、署名、expiry、subject (`sub`) を検証します。

### `POST /auth/passkey/register/options`

Google 認証済みユーザーへ Passkey 登録用 challenge を返します。

### `POST /auth/passkey/register/verify`

アプリが OS / Passkey API から得た credential を検証し、`passkey_credentials` へ公開鍵を登録します。初回登録の場合は、成功後に通常の Access / Refresh Token と `session_id` を発行します。

### `POST /auth/passkey/login/options`

Passkey 認証用 challenge を返します。ユーザー存在の推測を防ぐため、応答内容を統一します。

### `POST /auth/passkey/login/verify`

assertion を検証し、成功時に `sessions` を作成して通常の Access / Refresh Token を発行します。Key-B の取得権限は、Google 認証と Passkey 認証が完了したセッションに限定します。

### `POST /auth/refresh`

Refresh Token を使って Access Token を更新します。

Request：

```json
{
  "refresh_token": "refresh-token",
  "refresh_request_id": "refresh-request-uuid"
}
```

処理は DB トランザクションで行います。

1. Refresh Token のハッシュを検索する。
2. セッションが存在し、未失効で、アイドル期限・絶対期限内であることを確認する。
3. 同じ `refresh_request_id` の成功済み結果が 30 秒以内にあれば、同じ結果を返す。
4. 別の `refresh_request_id` で使用済み token が送られた場合は token reuse とみなし、セッション全体を失効させる。
5. 現在の Refresh Token を使用済みにする。
6. 新しい Refresh Token のハッシュを保存する。
7. 新しい Access Token と Refresh Token を返す。

同じ Refresh 操作の再送に対応するため、サーバーは `refresh_request_id`、旧 token hash、新しいレスポンスの暗号化データ、30 秒の有効期限を冪等性記録として保持します。Refresh Token の平文は DB に保存しません。冪等性記録を実装しない場合は、通信結果が不明な Refresh を再送せず再ログインへ戻します。

### `POST /auth/logout`

現在のセッションの `sessions.revoked_at` を更新し、Refresh Token を失効させます。端末側の Access Token と Refresh Token も削除します。

### `POST /auth/logout-all`

対象ユーザーの全セッションを失効させます。端末紛失、アカウント保護、本人確認情報の変更時に利用します。

### `GET /me/sessions`

自分のログイン端末・最終利用時刻・作成日時を返します。Token の値は返しません。

### `DELETE /me/sessions/{session_id}`

指定した端末セッションだけを失効させます。対象セッションの Access Token は DB 確認時点から利用できなくなります。

### `POST /chats/{chat_id}/transport-token`

有効な Access Token から、対象チャットだけで使える短命の Chat Token を発行します。Chat Token の期限・切り替えは Access Token の Refresh 処理とは独立させます。Chat Token は `aud = samurai-meet-chat`、`chat_id`、`sid`、`scope = chat:connect` 等を持ち、プロフィール、Recovery、Key-B、他のチャットには利用できません。

QUIC / WebTransport で使う場合も、Refresh Token はこの通信路へ送信しません。Chat Token の更新は通常の REST API 経由で行います。

## 3. ユーザー・プロフィール API

### `GET /me`

自分のアカウント、プロフィール、本人確認状態、端末復旧状態を取得します。

### `PATCH /me/profile`

Request（例）：

```json
{
  "name": "Taro",
  "nationality_code": "JP",
  "bio": "日本語と英語で交流したいです",
  "monster": null
}
```

サーバー側で文字数、禁止語、国籍コード、本人以外の編集を検証します。`likes_count` と `identity_status` はクライアントから更新できません。

### `POST /me/verification`

本人確認を開始します。実際の証明書類を API が保持するか、外部プロバイダーへ直接送るかは要確認です。

### `DELETE /me`

アカウント削除を開始します。即時物理削除、論理削除、バックアップからの削除時期を運用方針に従って処理します。

## 4. 位置情報・検索 API

### `POST /me/location`

Request：

```json
{
  "latitude": 35.681236,
  "longitude": 139.767125,
  "accuracy_m": 25,
  "captured_at": "2026-08-23T12:00:00Z"
}
```

サーバーは緯度・経度の範囲、精度、時刻、ユーザーの許可状態を検証します。レスポンスで正確な位置を他ユーザーへ返しません。

### `GET /recruitments`

Query（例）：

```text
?keyword=英会話&available_date=2026-08-23&radius_km=3&verified_only=true&page=1&limit=20
```

サーバーで次を判定して結果を返します。

- カードが `open` であること
- `expires_at` が未来であること
- 検索地点からカード地点までの距離がカードの公開半径以内であること
- ブロック関係がないこと
- 日時、時間帯、キーワード、本人確認条件が一致すること

Response（例）：

```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "owner": {
          "user_id": "uuid",
          "name": "Taro",
          "nationality_code": "JP",
          "icon_url": "https://...",
          "identity_status": "verified",
          "likes_count": 12
        },
        "available_date": "2026-08-23",
        "start_time": "15:00:00",
        "end_time": "16:00:00",
        "timezone": "Asia/Tokyo",
        "keywords": ["英会話", "カフェ"],
        "distance_band": "within_3km",
        "matched_keywords": ["英会話"]
      }
    ],
    "page": 1,
    "limit": 20,
    "has_more": false
  }
}
```

## 5. 募集・マッチング API

### `POST /recruitments`

Request：

```json
{
  "available_date": "2026-08-23",
  "start_time": "15:00:00",
  "end_time": "16:00:00",
  "timezone": "Asia/Tokyo",
  "keywords": ["英会話", "カフェ"],
  "visibility_radius_km": 3
}
```

作成時の現在地は、サーバーが保持している最新の有効位置またはリクエスト時の同意済み位置を使用します。カード作成者本人だけが編集・削除できます。

### `GET /recruitments/{id}`

公開範囲、期限、ブロック、カード状態を検証して詳細を返します。正確な緯度・経度は返しません。

### `PATCH /recruitments/{id}`

カード所有者だけが、公開中カードの日時、時間帯、キーワード、半径、状態を更新できます。マッチ成立後に変更可能な項目は要確認です。

### `DELETE /recruitments/{id}`

物理削除ではなく `closed` へ遷移させる方式を基本とします。

### `POST /recruitments/{id}/interest`

カードへ関心を送ります。自分のカード、期限切れカード、重複関心、ブロック関係は拒否します。

### `POST /matches/{id}/accept`

カード所有者が関心を承認します。成功すると `matches.status = accepted` となり、チャットが利用可能になります。

### `POST /matches/{id}/complete`

交流完了状態へ遷移し、相互評価を有効化します。ユーザー操作と自動期限の扱いは要確認です。

## 6. チャット API

### `GET /chats`

マッチ済みチャットの一覧を、最新メッセージ時刻の降順で返します。未読数、相手プロフィール、マッチ状態を含めます。

### `GET /chats/{id}/messages`

Query：`?before=<message_id>&limit=50`

チャット参加者だけが取得できます。暗号化本文をクライアントが復号する設計では、API は暗号化 payload と nonce を返します。

### `POST /chats/{id}/messages`

WebSocket が利用できない場合のフォールバックです。

Request（例）：

```json
{
  "client_message_id": "client-generated-uuid",
  "message_type": "text",
  "ciphertext": "base64...",
  "nonce": "base64...",
  "key_version": "v1"
}
```

同じ `client_message_id` は再送されても一度だけ登録します。

## 7. WebSocket 仕様

接続先（案）：

```text
wss://api.example.com/v1/ws/chats/{chat_id}
```

WebSocket の接続認証にも、通常の Access Token ではなく `POST /chats/{chat_id}/transport-token` で発行した Chat Token を利用します。WebSocket は QUIC / WebTransport が利用できない場合のフォールバックです。

クライアント送信：

```json
{
  "type": "message.send",
  "client_message_id": "uuid",
  "message_type": "text",
  "ciphertext": "base64...",
  "nonce": "base64...",
  "key_version": "v1"
}
```

サーバー配信：

```json
{
  "type": "message.created",
  "message": {
    "id": "uuid",
    "client_message_id": "uuid",
    "sender_user_id": "uuid",
    "message_type": "text",
    "ciphertext": "base64...",
    "nonce": "base64...",
    "sent_at": "2026-08-23T12:00:00Z"
  }
}
```

その他のイベント：`message.ack`、`message.read`、`typing.start`、`typing.stop`、`error`。

QUIC / WebTransport の Chat Token claims、token の切り替え、0-RTT の制約は [チャット通信トークン仕様](features/chat-transport.md) に定義します。

## 8. 写真 API

### `POST /photos`

- チャット参加者またはプロフィール所有者だけが利用可能。
- MIME、拡張子、実体、ファイルサイズ、画像解像度をサーバーで検査する。
- EXIF GPS を除去する。
- 非公開ストレージへ保存し、取得用の短期 URL または認証 API を返す。

### `DELETE /photos/{id}`

所有者、チャット参加者に許された削除操作、または運営者だけが実行できます。DB メタデータとストレージ本体の削除状態を一致させます。

## 9. 評価・安全 API

### `POST /matches/{id}/reviews`

Request（案）：

```json
{
  "rating": 5,
  "liked": true,
  "comment": "楽しく話せました"
}
```

同一マッチ・同一レビュアーの二重登録を拒否します。評価方式と自由記述の公開範囲は要確認です。

### `POST /reports`

Request（例）：

```json
{
  "target_type": "user",
  "target_id": "uuid",
  "reason": "harassment",
  "comment": "不適切なメッセージが届いた"
}
```

### `POST /blocks`

ブロック後、対象ユーザーのカード、プロフィール、チャット、関心送信を非表示または拒否します。

## 10. Recovery API

### `POST /recovery/restore`

Google 認証済みの復旧セッションから、Recovery Key を使って暗号化済み Key-A の envelope を取得します。Recovery Key の平文を API のログや DB に保存しません。

### `POST /recovery/devices`

復旧後の新端末を登録し、新しい Passkey と Key-A の保存状態を関連付けます。旧端末の失効処理を選択できるようにします。

## 11. トークン更新タイミング

### 11.1 クライアント

- ログイン・Passkey 認証成功時に Access Token と Refresh Token を受け取る。
- アプリ起動時・フォアグラウンド復帰時に Access Token の残り時間を確認する。
- 残り 30 秒以下、または期限切れの場合だけ `POST /auth/refresh` を実行する。
- API 呼び出し前にも残り時間を確認し、必要なら先に更新する。
- API が `401 TOKEN_EXPIRED` を返した場合は、Refresh を一度だけ行って元のリクエストを一度だけ再試行する。
- 同時に複数の API が更新を要求した場合は、クライアント内で一つの Refresh 処理にまとめる（single-flight）。
- Refresh リクエストの通信結果が不明な場合、同じ `refresh_request_id` の再送だけを許可する。冪等性がない場合は同じ token を盲目的に再送しない。
- Refresh に失敗した場合は、保存済み token を削除して Google / Passkey ログインへ戻す。
- 新しい token の保存に成功してから、クライアント側の旧 token を置き換える。
- バックグラウンド中に定期 Refresh を行わない。次のフォアグラウンド復帰時または API 利用時に更新する。

### 11.2 WebSocket

- WebSocket 接続前に REST で Chat Token を取得する。
- Chat Token の期限と切り替えは、Access Token の Refresh とは別のポリシーで管理する。
- サーバーは接続時と 15〜30 秒ごとの heartbeat で `sid`、`chat_id`、マッチ状態、ブロック状態を DB 確認する。
- DB で失効を検知したら、WebSocket を `4401 SESSION_REVOKED` 等のアプリケーションコードで閉じる。
- Refresh Token を WebSocket メッセージとして送信しない。Chat Token も URL query に含めない。

### 11.3 再認証が必要な操作

Refresh Token でセッションを延長できても、次の操作は直近の Passkey 再認証を要求する。

- Key-B の取得
- Recovery Key による復旧
- 新端末の登録
- 本人確認情報の変更
- 全セッションの失効
- アカウント削除

直近認証の有効時間は 5 分を暫定値とし、`auth_time` またはサーバー側の認証イベントで管理します。

## 12. レート制限（暫定）

| 対象 | 制限の考え方 |
| --- | --- |
| Google / Passkey 認証 | IP、ユーザー、端末単位で短時間の連続試行を制限 |
| Refresh | token hash、IP、端末、セッション単位で試行回数を制限。reuse は即時失効 |
| Recovery Key | 試行回数を厳格に制限し、失敗を監査ログへ記録 |
| 位置更新 | 端末ごとに一定間隔以上の更新を許可 |
| 検索 | ユーザー・IP 単位のページングとレート制限 |
| メッセージ | マッチ単位の送信頻度と本文サイズを制限 |
| 写真 | 1 ファイルサイズ、日次容量、同時アップロード数を制限 |
