# バックエンド残タスク

このファイルは互換入口です。唯一の最新バックログは [docs/ai/plans/backlog.md](../docs/ai/plans/backlog.md) です。

検証専用の `expo-test` と `dev-client` は廃止しました。新しいクライアント検証は `frontend/` のテストと実機E2Eで行います。

## 今回のバックエンド実装範囲（2026-08-26）

- `GET /api/v1/me` と `PATCH /api/v1/me/profile` を追加した。名前・国コード・自己紹介をDBへ保存し、APIから後日変更できる。プロフィール編集画面はまだこのAPIへ接続しない。
- マッチングAPIと`0019_profiles_matching.sql`を追加した。募集カード、検索、現在地、関心、応募一覧、詳細、承認、辞退、完了をGo側で認証・認可・期限・重複・ブロック検証する。
- acceptedマッチ向けのRESTチャット、暗号文メッセージ、既読、短命Chat Token、会合セッション、Bluetooth／位置推測の距離補助APIと`0020_chat_meetings.sql`を追加した。WebSocket配送とネイティブBluetooth測定は未実装。
- フロントの既存モック、言語選択画面、ログアウト後のナビゲーションは変更していない。

## フロント追従時に引き継ぐ課題（今回の変更対象外）

1. **プロフィール編集UI**
   - `ProfileForm`から`PATCH /api/v1/me/profile`を呼び、保存成功後に`GET /api/v1/me`の値を表示する。
   - 自己紹介の入力エラー（400 `invalid_profile`）を画面内に表示し、保存中の二重送信を抑止する。
   - アイコン、本人確認、交流キーワードは別APIが確定するまで既存UIを勝手に接続しない。

2. **ログアウト後の言語選択・戻るジェスチャー**
   - 現状はログアウト処理がSecure Storageとセッション状態を消去した後、`router.replace("/")`で言語選択コンポーネントへ戻る。ルートStack側で履歴・戻るジェスチャーが残ると、左スワイプで直前画面へ戻れる可能性がある。
   - 左スワイプは言語選択画面へ戻る導線として扱うのか、認証完了後の画面履歴を破棄するのかをフロント側で決める。今回のバックエンドPRでは`frontend/`を変更しない。
   - 受け入れ条件: ログアウト後に保護画面へ戻れない、端末の戻る／左スワイプで旧セッション状態を表示しない、再ログイン時に言語選択から始められる。

3. **残りの業務API・フロント接続**
   - 募集公開、募集検索・詳細、関心送信、応募一覧、承認・辞退は`frontend/`から接続済み。プロフィール編集画面は引き続きローカル表示のため、`PATCH /api/v1/me/profile`との完全同期を行う。
   - チャット、会合、距離補助のネイティブ測定を画面へ接続し、送信中・再送・既読・期限切れ状態を扱う。
   - 評価、チャットのWebSocketリアルタイム配送、チャット内写真送信は未実装。通知一覧・未読管理と応募／承認／辞退／チャット送信通知は実装済み。

4. **バックエンドの残課題**
   - API／アプリ双方のレート制限、PostGIS化、ブロック登録API、評価を追加する。
   - チャットのWebSocket配送、チャット内写真送信を追加する。通知連携は応募／承認／辞退／暗号化チャット送信について実装済み。
   - Stripe Identity等の本人確認を追加する。サーバーでVerification Sessionを発行し、Stripe Webhookの署名・イベント重複・対象ユーザーの紐付けを検証した後だけ`profiles.identity_status=verified`へ遷移させる。クライアントからの自己申告や戻りURLだけでは認証済みマークを付けない。
   - 本人確認の再確認期限、否認・再申請、参照IDの保持期限、Webhook監査ログ、Stripe障害時の保留状態を決める。本人確認済みでも安全を保証しない表示を行う。
   - PostgreSQL統合テストでプロフィール・募集・関心・承認・期限・ブロック・位置期限を通しで検証する。

## クライアント所有鍵v2 引き継ぎメモ（2026-08-26）

正本は [docs/ai/security/proton-style-key-management/proposal.md](../docs/ai/security/proton-style-key-management/proposal.md) です。
`/api/v1`はHTTP URLの互換入口であり、root-key protocolはv2だけを受け付けます。

### 今回反映済み

- 24語・256bit entropyのRecovery PhraseをArgon2id + HKDF-SHA256で処理し、v2 envelopeだけを保存する。
- Master Key（実装上は既存Key-Aと同じ32byte）をAPIへ送らず、Ed25519 Key-BとX25519端末合意鍵を分離する。
- 旧端末承認のdevice transfer APIを追加し、対象公開鍵に束縛したopaque envelopeだけをサーバーに保存する。
- Recovery後・プロフィールからのRecovery Phrase再生成、pending materialの再開、端末側暗号データ初期化を実装する。
- `0022_disable_legacy_root_keys.sql`で旧root envelope、Recovery challenge、旧Key-B materialを削除し、`key_envelopes`へv2-only制約を追加する。

### 未完了タスク

1. QR/OOBまたはfingerprint照合を含む旧端末・新端末の画面統合。APIは自動承認しない。
2. 画像DEKのresumable bulk再包み、旧端末一覧・個別失効、失効後の端末proof拒否。
3. Recovery Codes、Passkey再登録のUI・実機E2E。Recovery CodeはMaster Key復号には使わない。
4. native Secure Enclave / Android Keystore / attestationと、Expo Goのdegraded表示。
5. object ID/version/algorithmを含むAEAD AAD、暗号化backup、envelope rollback検知、削除reconciler・監査イベント。
6. PostgreSQL統合テストとiOS/Android実機での旧端末あり・なし復旧検証。

### v1開発アカウントについて

- 旧Base64URL Recovery Keyやv1 root envelopeは互換復旧しない。APIでは`410 legacy_key_version_disabled`、migrationでは旧行削除となる。
- 旧開発アカウントの暗号化データを継続利用するには、旧端末または旧Recovery Keyに依存せず、v2でアカウントと暗号化データを作り直す。
- すべての復旧要素を失った場合はサポートでも復号しない。これはzero-accessの必須条件。

### 再開時の順序

1. `git status --short --branch` と `git diff --name-only` で未コミット差分を確認する。
2. `bun run typecheck`、`bun run lint`、`bun test`、`go test -count=1 ./...`、`go vet ./...`、`go build ./...`、`git diff --check`を実行する。
3. PostgreSQLへmigrationを適用し、`0022`の再実行性とv2-only制約を確認する。
4. wrong phrase、5回超過、wrong target key、wrong code、replay、expiry、別ユーザーID、Access Token単独をAPI/UIで検証する。
5. 意図したファイルだけをstageしてcached path listを確認し、日本語コミット後に`tp-li-dev`の認証でpushする。
