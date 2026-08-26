# 技術選定・実装分担

## 1. 結論

Samurai Meet は、次の分担で実装します。

| 領域 | 主な機能 | 使用言語 | 主な技術・配置先 |
| --- | --- | --- | --- |
| モバイル UI | 画面、フォーム、ナビゲーション | TypeScript / TSX | Expo、React Native、Expo Router、`frontend/app` |
| クライアント状態管理 | 認証状態、検索条件、チャット状態 | TypeScript | React Hooks、`frontend/hooks` |
| クライアント通信 | REST、WebSocket、認証セッション | TypeScript | `frontend/services/api.ts`、`websocket.ts` |
| クライアント暗号化 | Key-A、Recovery Key、HKDF、AES-GCM | TypeScript + OS の暗号 API | Secure Storage、必要に応じて Expo Native Module |
| Google 認証クライアント | OAuth2 / OIDC の開始、コールバック | TypeScript | Expo Auth Session 等 |
| Passkey クライアント | Passkey の登録・認証 UI | TypeScript + OS API | WebAuthn / Passkey 対応ライブラリ |
| REST API | 認証後の業務 API、プロフィール、カード、評価 | Go | `backend/internal/*/handler.go` |
| 業務ロジック | マッチング、公開半径、状態遷移 | Go | `backend/internal/*/service.go` |
| WebSocket | チャットの接続、配送、再接続制御 | Go | `backend/internal/chat/websocket.go` |
| QUIC / HTTP/3 チャット通信 | チャット接続、短命 token、低遅延配送 | Go + TypeScript / native module | Go の QUIC / HTTP/3 server、モバイル native transport。MVP は WebSocket fallback |
| OAuth / Passkey 検証 | Google ID Token、WebAuthn assertion 検証 | Go | `backend/internal/auth` |
| 画像 API | アップロード、認可、メタデータ、削除 | Go | `backend/internal/image` |
| 画像変換・検査 | リサイズ、サムネイル、EXIF 除去、形式検査 | Go | 画像処理ライブラリを採用。運用要件により専用 worker 化 |
| 永続化 | ユーザー、カード、マッチ、チャット、評価 | Go + SQL | PostgreSQL（開発・CI・運用） |
| 距離検索 | 現在地と募集カードの距離判定 | SQL | PostgreSQL / PostGIS |
| セッション失効 | Access Token の検証、Refresh Token ローテーション | Go + SQL | `sessions`, `refresh_tokens` |
| DB migration | テーブル、制約、インデックス、削除方針 | SQL | `backend/migrations/*.sql`、PostgreSQLのみ |
| テスト | UI、API、業務ロジック、E2E、鍵生成 | TypeScript / Go / Python / SQL | Bun test、Go test、Python unittest、API/E2E テスト |
| 設定・デプロイ | 環境変数、CI、コンテナ、監視設定 | YAML / Dockerfile / Bash 等 | リポジトリと実行環境で管理 |

## 2. 機能別の実装担当

| 機能 | フロントエンド | バックエンド | DB / 外部サービス |
| --- | --- | --- | --- |
| Google 登録・ログイン | TypeScript で OAuth 開始・セッション保存 | Go で ID Token 検証、ユーザー作成 | Google OAuth2 / OIDC、`users` |
| Passkey | TypeScript で OS の Passkey API を呼び出す | Go で challenge と credential を検証 | `passkey_credentials` |
| プロフィール | TSX のフォーム、入力検証、表示 | Go の CRUD、公開項目の制御 | `profiles`, `photos` |
| 本人確認 | TypeScript で申請状態を表示 | Go で申請・Webhook・状態遷移 | `identity_verifications`、本人確認プロバイダー |
| 現在地 | TypeScript で OS の位置情報許可・取得 | Go で精度・期限・権限を検証 | PostgreSQL / PostGIS の `user_locations` |
| キーワード検索 | TypeScript で検索条件とカード表示 | Go で条件検証・距離検索・並び替え | `recruitment_cards`、PostgreSQL / PostGIS |
| 募集カード | TypeScript で作成・編集 UI | Go で状態遷移・期限切れ処理 | `recruitment_cards` |
| マッチング | TypeScript で関心・承認状態表示 | Go で重複防止・相互承認・認可 | `matches` |
| チャット | TypeScript で WebSocket、キャッシュ、再接続 | Go で接続認証・配送・順序確定 | `messages` |
| チャット通信認証 | TypeScript で Chat Token 更新・切替 | Go で `aud`、`chat_id`、`sid`、`token_seq` を検証 | `sessions`、`matches` |
| 写真 | TypeScript で選択・暗号化・送信 | Go で MIME/サイズ/権限/ストレージ処理 | `photos`、非公開ストレージ |
| 相互評価 | TypeScript で評価フォーム | Go で一回限り制約・集計 | `reviews`, `profile_likes` |
| 通報・ブロック | TypeScript で入力・非表示制御 | Go で遮断・運営処理・監査 | `reports`, `blocks`, `audit_logs` |
| Recovery Key | TypeScript で生成・Secure Storage・復号 | Go で暗号化 Key-A envelopeとRecovery proofを認証 | `key_envelopes`、`recovery_challenges` |

## 3. 言語・責務の境界

### 3.1 TypeScript で行う処理

- 画面の描画と入力状態の管理
- OS 権限の取得（位置情報、写真、通知）
- API / WebSocket クライアント
- クライアントに保持する認証状態
- Key-A の生成、Secure Storage への保存、暗号化対象データのクライアント処理
- オフライン時の UI 状態と再接続

### 3.2 Go で行う処理

- Google ID Token と Passkey assertion の検証
- セッション、認可、ユーザー状態の管理
- プロフィール、募集カード、マッチ、チャット、評価の業務処理
- 公開半径、期限、ブロック状態などのサーバー側判定
- WebSocket 接続、メッセージ順序、再送・重複排除
- Chat Token の発行、短期期限、順次切り替え、QUIC / HTTP/3 の接続認証
- 画像アップロードの認証、検査、ストレージ連携
- 管理者操作と監査ログ

### 3.3 SQL で行う処理

- テーブル、外部キー、UNIQUE / CHECK 制約
- PostgreSQL / PostGIS による距離検索
- 検索用インデックス
- 集計値の再計算、データ保持・削除用の DB 処理

## 4. 採用しない実装

- クライアントから PostgreSQL や画像ストレージへ直接接続・更新しない。
- 距離判定や「公開半径内か」の判定をクライアントだけで完結させない。
- Google のメールアドレスをサービスの主キーにしない。
- 秘密鍵、Key-A、Recovery Key の平文を Go API のログや DB に保存しない。
- Access Token は JWS 署名付き JWT、Refresh Token は DB ハッシュ + ローテーションで管理する。
- WebSocket の認可を UI の表示制御だけに依存しない。

## 5. 実装時の注意

- Expo の標準機能だけで AES-GCM や Passkey の要件を満たせない場合があるため、暗号・認証の採用ライブラリは PoC とセキュリティレビューを先に行う。
- Go API と TypeScript クライアントの DTO は、API 仕様から生成または一元管理する。
- DB の地理情報型、暗号化バイナリ型、時刻のタイムゾーンは初回 migration から固定する。
- 技術選定は「実装可能か」だけでなく、端末紛失、アカウント復旧、通報対応、削除要求まで含めて評価する。
