# 機能仕様：認証・アカウント復旧

## 1. 対象

- Google OAuth2 / OIDC による登録・ログイン
- Passkey の登録・認証
- セッション管理、ログアウト、アカウント削除
- Key-A、Key-B、Recovery Key による暗号化データ復旧

対応要件：FR-001、FR-002、FR-003、FR-015、C-002、C-005

## 2. 画面・クライアント実装

| 画面 / 処理 | ファイル案 | 言語 |
| --- | --- | --- |
| ログイン | `frontend/app/(auth)/login.tsx` | TypeScript / TSX |
| 初回登録 | `frontend/app/(auth)/register.tsx` | TypeScript / TSX |
| 認証状態 | `frontend/hooks/useAuth.ts` | TypeScript |
| Google OAuth 開始 | `frontend/services/api.ts` | TypeScript |
| Passkey 呼び出し | `frontend/services/auth.ts`（追加推奨） | TypeScript + OS API |
| Key-A / Recovery Key | `frontend/services/crypto.ts`（追加推奨） | TypeScript + Secure Storage |

## 3. 初回登録フロー

1. ユーザーが「Google で登録」を選択する。
2. Google OAuth2 / OIDC を PKCE 付きで実行する。
3. Go API が ID Token の issuer、audience、署名、expiry、`sub` を検証する。
4. `google_subject_id` に紐づくサービス用 `user_id` を作成する。
5. ユーザーが Passkey を登録する。
6. 端末上で 256 bit の Key-A を生成し、Secure Storage に保存する。
7. 高エントロピーの Recovery Key を生成し、ユーザーへ一度だけ表示する。
8. Recovery Key から導出した鍵で Key-A を暗号化し、envelope を API へ保存する。
9. プロフィール作成画面へ遷移する。

## 4. 通常ログインフロー

1. Google OAuth2 / OIDC でユーザーを識別する。
2. 端末の Passkey を要求する。
3. Go API が challenge と assertion を検証する。
4. 成功時にアクセストークン、リフレッシュトークンを発行する。
5. 認証済みセッションに限り Key-B の取得を許可する。
6. 端末の Key-A と Key-B から HKDF で暗号化データ用の鍵を導出する。

## 5. セッション方式と更新タイミング

リフレッシュトークンは技術上の必須要件ではありませんが、モバイルで長時間ログインを維持しつつ Access Token を短命にするため採用します。

| 項目 | 仕様（暫定） |
| --- | --- |
| Access Token | JWS 署名付き JWT。寿命 1 分（案）。`sid` で `sessions.id` と紐付ける |
| Refresh Token | 256 bit 以上の不透明乱数。寿命 30 日アイドル / 90 日絶対 |
| 保存 | 端末は Secure Storage、DB は Refresh Token のハッシュのみ |
| ローテーション | Refresh のたびに新 token を発行し、旧 Refresh Token は原則即時使用済みにする |
| 再利用検知 | 使用済み token の再利用時は同じ token family を失効 |

更新タイミング：

- ログイン成功時に Access / Refresh の両方を発行する。
- アプリ起動・フォアグラウンド復帰時、Access Token の残りが 30 秒以下なら更新する。
- API 呼び出し前、残り 30 秒以下なら更新する。
- `401 TOKEN_EXPIRED` のときだけ一度更新して、元の API を一度だけ再試行する。
- 新 Access Token 発行後も、旧 Access Token は自身の `exp` まで受け付ける。
- 通信結果が不明な Refresh は、同じ `refresh_request_id` の再送だけを 30 秒許可する。
- WebSocket 接続前・期限直前に更新し、失効は heartbeat で検知して接続を閉じる。
- アプリがバックグラウンドにいる間は定期更新しない。
- Key-B 取得、Recovery、端末登録、アカウント削除などは Refresh だけでなく直近の Passkey 再認証を要求する。

## 6. 新端末・端末紛失フロー

1. Google 認証を行う。
2. Recovery Key を端末上で入力する。
3. API から暗号化済み Key-A の envelope を取得する。
4. Recovery Key から導出した鍵で端末上のみ Key-A を復号する。
5. 新端末の Secure Storage に Key-A を保存する。
6. 新端末の Passkey を登録する。
7. 新端末を有効化し、必要に応じて旧端末を失効させる。

Recovery Key を紛失した場合に、運営者が復号できる設計にするかは要確認です。復号不能設計の場合、そのリスクを登録時に明示します。

## 7. API / DB

詳細は [API 仕様書](../api.md) と [DB 仕様書](../database.md) を参照します。

| 用途 | API | テーブル |
| --- | --- | --- |
| Google 認証 | `GET /auth/google/start`、`POST /auth/google/exchange` | `users` |
| Passkey 登録・認証 | `/auth/passkey/*` | `passkey_credentials` |
| セッション更新 | `POST /auth/refresh` | `sessions`、`refresh_tokens`、`refresh_attempts` |
| ログアウト | `POST /auth/logout` | `sessions`、`refresh_tokens` |
| 全端末ログアウト | `POST /auth/logout-all` | `sessions`、`refresh_tokens` |
| 端末セッション管理 | `GET /me/sessions`、`DELETE /me/sessions/{id}` | `sessions` |
| Key envelope 取得 | `POST /recovery/restore` | `key_envelopes` |
| 新端末登録 | `POST /recovery/devices` | `passkey_credentials`、監査ログ |

## 8. セキュリティ要件

- Google のメールアドレスを主キーにしない。安定した OIDC `sub` を利用する。
- OAuth の `state`、PKCE、redirect URI を検証する。
- Access Token、Refresh Token、Key-A、Key-B、Recovery Key をログへ出力しない。
- Recovery Key の試行回数、レート制限、失敗時のアカウント保護を実装する。
- Key-A は API へ平文で送らない。
- Access Token の署名検証後、必ず `sessions.revoked_at` とユーザー状態を確認する。
- Refresh Token の平文を DB やログへ保存しない。
- 旧 Access Token と旧 Refresh Token を区別する。旧 Access Token は `exp` まで、旧 Refresh Token は同一冪等リクエスト以外を拒否する。
- 暗号方式、鍵長、nonce の再利用防止、鍵ローテーションはセキュリティレビューで確定する。

## 9. 受け入れ条件

- Google の初回ログインで新規ユーザーが一度だけ作成される。
- 同じ Google `sub` で再ログインすると同じ `user_id` になる。
- Passkey 登録後、認証に成功しないと通常セッションを作成できない。
- Recovery Key で新端末へ Key-A を復旧できる。
- 間違った Recovery Key を一定回数以上試すと制限される。
- Access Token の期限が切れる前に、Refresh Token で自動更新できる。
- ログアウト後、DB のセッション失効によって Access Token と Refresh Token の両方が利用できない。
- 使用済み Refresh Token の再利用でセッション family が失効する。
- ログアウト後のアクセストークンが API で利用できない。

## 10. 要確認

- Google 認証だけでログインを完了させず、常に Passkey を必須にするか。
- Key-B の生成・保管場所、発行条件、ローテーション。
- Passkey が利用できない端末の代替認証。
- アカウント削除後の認証資格情報と暗号化 envelope の扱い。
