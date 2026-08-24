# DB仕様書（PostgreSQL）

最終更新: 2026-08-24

## 1. 採用方針

- DBはPostgreSQLのみ。本番、開発、CIで同じSQL migrationを使う。
- SQLiteは採用しない。暗号化画像本体もDBへ保存しない。
- クライアントからDBへ直接接続させず、Go APIの認証・認可を通す。
- 現在のmigrationはサービスIDをopaque `TEXT`で保存する。将来UUIDへ変更する場合は全API、ファイルパス、migrationを同時に更新する。
- migrationは`backend/migrations/*.sql`をファイル名順に適用する。アプリ起動時に同じDDLを再実行できる形にしている。

## 2. 現在のmigration

| ファイル | 内容 |
| --- | --- |
| `0001_init.sql` | 初期プレースホルダー（既存環境互換） |
| `0001_auth_sessions.sql` | users、Passkey credential、challenge、session、Refresh Token、retry、key envelope |
| `0002_images.sql` | photosの暗号文メタデータ |
| `0003_oauth_states.sql` | Google OAuth state |
| `0004_mobile_oauth_handoffs.sql` | アプリhandoffとchallenge |
| `0005_oauth_handoff_retry.sql` | crash-safe handoff応答 |
| `0006_refresh_attempt_nonce.sql` | Refresh応答nonce |
| `0007_passkey_storage.sql` | discoverable challengeのnullable user、credential JSON |
| `0008_photo_metadata.sql` | profile画像用wrapped key、MIME、暗号文サイズ |

注意: 現行の簡易migration runnerはSQLファイルを順番に実行する。migration履歴テーブルによる本番適用管理を導入する場合は、既存環境の適用済み状態を確認してから切り替える。

## 3. 認証テーブル

### `users`

| カラム | 型 | 用途 |
| --- | --- | --- |
| `id` | text | サービス用個人識別ID、PK |
| `google_subject_id` | text | Google OIDC `sub`、UNIQUE |
| `status` | text | `active / suspended / deleted` |
| `created_at` / `updated_at` | text | UTC RFC3339 |
| `deleted_at` | text | 論理削除時 |

### `passkey_credentials`

| カラム | 型 | 用途 |
| --- | --- | --- |
| `id` | text | credential recordのPK |
| `user_id` | text | `users.id`へのFK |
| `credential_id` | text | WebAuthn credential IDのBase64URL、UNIQUE |
| `public_key` | text | COSE公開鍵のBase64URL（legacy fallback） |
| `credential_json` | text | WebAuthn libraryのcredential JSON |
| `sign_count` | bigint | clone検知用カウンタ |
| `created_at` | text | 登録日時 |
| `last_used_at` | text | 最終認証日時 |

credential JSONは検証に必要な情報を保持する。DBアクセス権限を持つ運用者でも、秘密鍵を得られない設計にする。

### `auth_challenges`

| カラム | 型 | 用途 |
| --- | --- | --- |
| `id` | text | challenge recordのPK |
| `user_id` | text nullable | 登録・既知ユーザーloginは設定。discoverable loginはNULL |
| `type` | text | `pre_auth / passkey_register / passkey_login` |
| `token_hash` | text | ceremony tokenのSHA-256 hash、UNIQUE |
| `scope` | text | WebAuthn `SessionData` JSON |
| `expires_at` | text | 現在5分 |
| `used_at` | text | 一回使用後 |
| `created_at` | text | 作成日時 |

`used_at IS NULL`かつ期限内だけを受け付け、検証処理の前に行ロックして一回使用にする。ceremony token平文はDBへ保存しない。

### `oauth_states`

`state_hash`、Google PKCE `code_verifier`、`app_redirect_uri`、`handoff_challenge`、期限、使用日時を持つ。state平文ではなくhashを検索し、callbackで一回消費する。

### `oauth_handoffs`

`code_hash`、`user_id`、アプリhandoff challenge、期限、使用日時、暗号化済み応答とnonceを持つ。handoff codeは一回限りだが、同じverifierによる期限内の再送だけは同じ応答を返す。

## 4. セッションテーブル

### `sessions`

| カラム | 型 | 用途 |
| --- | --- | --- |
| `id` | text | JWS `sid`、PK |
| `user_id` | text | `users.id` |
| `family_id` | text | Refresh rotationの失効単位 |
| `status` | text | `active / revoked / expired` |
| `device_name` | text nullable | 端末表示名 |
| `created_at` / `last_seen_at` | text | 作成・最終利用 |
| `expires_at` | text | 絶対期限（現在90日） |
| `revoked_at` / `revoked_reason` | text | 失効情報 |

Access Token検証時も`sessions.status`、`expires_at`、アイドル期限、`users.status`を確認する。ログアウト後に署名が正しい旧Access Tokenを受け付けない。

### `refresh_tokens`

| カラム | 型 | 用途 |
| --- | --- | --- |
| `id` | text | token世代ID |
| `session_id` | text | session FK |
| `token_hash` | text | Refresh TokenのSHA-256、平文禁止、UNIQUE |
| `issued_at` / `expires_at` | text | 発行・絶対期限 |
| `used_at` / `revoked_at` | text | rotation・失効 |

Refreshは対象行を`FOR UPDATE`し、旧token使用済み化、新token追加、session最終利用更新をtransactionで行う。

### `refresh_attempts`

| カラム | 型 | 用途 |
| --- | --- | --- |
| `id` | text | retry recordのPK |
| `session_id` | text | session FK |
| `request_id` | text | クライアントがRefreshごとに作るID |
| `old_token_hash` | text | 旧token hash |
| `response_ciphertext` | text | tokenを含む応答の暗号文 |
| `response_nonce` | text | AES-GCM nonce |
| `expires_at` / `created_at` | text | 現在retryは30秒 |

同じsession・request ID・旧token hashだけ同じ応答を復号して返す。別request IDの使用済みtokenはreuseとして全Refresh Tokenとsessionを失効する。

## 5. 画像・鍵テーブル

### `photos`

| カラム | 型 | 用途 |
| --- | --- | --- |
| `id` | text | 写真ID、PK |
| `owner_user_id` | text | 所有者FK |
| `visibility` | text | `private / profile` |
| `storage_path` | text | private保存領域の相対キー、UNIQUE |
| `cipher_sha256` | text | 保存暗号文のハッシュ |
| `nonce` | text | AES-256-GCM nonce |
| `algorithm` | text | 現在`AES-256-GCM`のみ |
| `key_version` | text | 鍵ローテーション |
| `wrapped_image_key` | text | 端末鍵またはRSA-OAEPラップ済み画像鍵 |
| `wrapping_algorithm` | text | ラップ方式 |
| `content_type` | text | profile復号配信時のMIME |
| `size_bytes` | bigint | 保存暗号文のサイズ |
| `server_wrapped_image_key` | text nullable | profile画像だけのRSA-OAEP-256 wrapped key |
| `created_at` / `deleted_at` | text | 作成・論理削除 |

画像平文はDBにもprivateフォルダにも保存しない。メモリcacheも暗号文のみとし、profile配信の平文はレスポンス作成中だけに存在させる。削除時はDBの公開状態、ファイル、cacheを一体で無効化する。

### `key_envelopes`

Key-AをRecovery Keyから導出した鍵で暗号化したenvelopeを保存する。`encrypted_key_a`、nonce、KDFパラメータ、key versionだけを保持し、Key-A、Key-B、Recovery Keyの平文を保持しない。HTTP APIは`GET/PUT/DELETE /api/v1/me/key-envelopes`で提供する。

## 6. これから追加するテーブル・制約

- `profiles`: 名前、国籍、icon photo、本人確認状態、likes、monster
- `recruitment_cards`: 日時、時間帯、keywords、表示半径1/3/5km
- `matches`、`messages`、`reviews`、`user_locations`
- `identity_verifications`、`reports`、`blocks`、`audit_logs`

これらはAPI実装時にmigrationを追加し、PostgreSQL integration test、API仕様書、機能仕様書を同じ変更で更新する。

## 7. 削除・保持

退会では次の順序を固定する。

1. 新規認証・新規API利用を拒否する。
2. DB user rowをロックし、全sessionを失効する。
3. private暗号文ファイルとメモリcacheを削除する。
4. refresh/passkey/challenge/key envelope/handoff/photo metadataを削除して、users rowを完全削除する。
5. 削除結果を監査ログへ記録する（秘密情報は記録しない）。監査ログ実装まではアプリログへ秘密値を出さない。

バックアップ上の物理削除期限、チャット保持期間、監査ログ保持期間は運用・法務決定後にmigrationと運用手順へ反映する。
