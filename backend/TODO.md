# バックエンド残タスク

このファイルは互換入口です。唯一の最新バックログは [docs/ai/plans/backlog.md](../docs/ai/plans/backlog.md) です。

検証専用の `expo-test` と `dev-client` は廃止しました。新しいクライアント検証は `frontend/` のテストと実機E2Eで行います。

## 現行バックエンド実装範囲（2026-09-03）

- `GET /api/v1/me` と `PATCH /api/v1/me/profile` を追加した。名前・国コード・自己紹介をDBへ保存し、APIから後日変更できる。プロフィール編集画面はまだこのAPIへ接続しない。
- マッチングAPIと`0019_profiles_matching.sql`を追加した。募集カード、検索、現在地、関心、応募一覧、詳細、承認、辞退、完了をGo側で認証・認可・期限・重複・ブロック検証する。
- acceptedマッチ向けのRESTチャット、暗号文メッセージ、既読、短命Chat Token、会合セッション、Bluetooth／位置推測の距離補助APIと`0020_chat_meetings.sql`を追加した。会合支援は双方の明示開始後だけactiveになり、距離帯以外の位置・BLE識別子は保存しない。ネイティブBluetooth測定はDevelopment Buildのfeature flagでのみ接続し、Expo Goでは偽計測しない。

  - フロントの有効化フラグは`EXPO_PUBLIC_MEETING_PROXIMITY_ENABLED=true`。ただしBLE native module未導入の間は、Development Buildでも測定を開始せず要件を画面に表示する。
- フロントの既存モック、言語選択画面、ログアウト後のナビゲーションは、このバックエンド実装メモの対象外である。現行フロントでは募集日時・JST入力・通知画面接続などを別作業で変更中のため、「モックを変更していない」とは扱わない。
- 募集画面はAPI接続済みで、日時入力のISO内部値／`Asia/Tokyo`固定と自動テストは完了している。日時選択から公開・応募・通知遷移までのiOS実機全通しE2Eを確認する。
- 募集日時の壁時計は`Asia/Tokyo`固定、絶対時刻はUTC。通常のネイティブ接続先はproduction domainで、LAN URLは明示設定時だけ使う。通知はアプリ内RESTまでで、OSプッシュは未実装。
- chat transport tokenはhandler既定値・サービス受理値ともに`webtransport`で一致し、HTTP/3 WebTransportだけに発行する。旧WebSocket endpointは410でありfallbackではない。native Development BuildでのWebTransport module実装、UDP/TLS公開、実機E2Eは残タスク。
- チャット送信前Moderationは通常OpenAIへ送信し、未設定・障害時はfail-closedとなる。`CHAT_MODERATION_DEV_FREE_MODE=true`を明示した場合はAPP_ENVにかかわらず外部送信をしない保守的なローカル判定へ切り替える一時確認例外で、起動時警告を出し、実データを使わず、通常の本番運用前に無効化・キー設定する。

## 緊急認証ローテーション（未実装）

侵害疑い時に全セッション・全Refresh Tokenを本人の現在セッションも含めて失効し、Passkey再認証後に新しいPasskeyと新しいセッション／Tokenだけで復帰する緊急ローテーションは、現行契約のままでは安全に実装できないため、UI/APIを追加していない。

受入条件は次のとおりとする。

- 同一ユーザーの現在セッション、user/device ID、ブラウザのCSRF/Origin、ネイティブのdevice proofを検証し、Passkey再認証と一回限りのoperation IDを要求する。
- 状態を `idle -> passkey_reauth_started -> new_passkey_registered -> all_old_sessions_revoked -> new_session_issued -> old_passkey_revoked -> active` とし、各遷移を監査イベントへ記録する。秘密情報、assertion、Token、鍵素材は監査ログへ残さない。
- 新Passkeyの登録・検証・保存が完了するまで旧Passkeyと旧セッションを失効させない。全旧session/refresh familyの失効と、新session・Access/Refresh Tokenの発行はtransactionまたは再試行可能なoperation状態で整合させ、成功時は新Token組だけを有効にする。
- 同じoperation IDの再送は同じ安全な結果を返し、異なるoperationの並行実行、二重発行、旧Tokenによる復帰を拒否する。途中失敗時は旧資格情報で再認証を再開でき、旧Passkeyを先に失効させた後の復旧不能状態を作らない。

未実装理由は、現行のreauthが既存sessionの `last_passkey_at` 更新だけで新しいsession/Tokenを発行せず、現行のPasskey登録も同じsessionへ資格情報を追加するだけで旧Passkey失効・全session失効・新Token発行を一つの契約として提供していないためである。まず専用のrotation operation、Passkey登録ceremony、監査イベント、原子的なsession/token切替契約を設計・テストしてから実装する。

## フロント追従時に引き継ぐ課題（今回の変更対象外）

1. **プロフィール編集UI**
   - `ProfileForm`から`PATCH /api/v1/me/profile`を呼び、保存成功後に`GET /api/v1/me`の値を表示する。
   - 自己紹介の入力エラー（400 `invalid_profile`）を画面内に表示し、保存中の二重送信を抑止する。
   - アイコン、本人確認、交流キーワードは別APIが確定するまで既存UIを勝手に接続しない。

2. **ログアウト後の言語選択・戻るジェスチャー（コード実装済み）**
   - ログアウト時はセッション状態を消去し、ルート履歴を破棄して言語選択画面へ戻す。未認証状態で保護画面を表示しないガードと自動テストを追加済み。
   - 残作業はiOS実機で左スワイプ／端末戻る操作後にも旧保護画面へ戻らないことの確認。

3. **残りの業務API・フロント接続**
   - 募集公開、募集検索・詳細、募集管理、関心送信、応募履歴、応募取り下げ、承認・辞退は`frontend/`から接続済み。プロフィール編集画面は引き続きローカル表示のため、`PATCH /api/v1/me/profile`との完全同期を行う。
	- native WebTransportクライアントと実機UDP経路を追加・検証し、接続断後のREST同期、既読、期限切れ状態を実機で確認する。会合・距離補助のnative測定はmodule導入後に接続する。
	- 評価とnative WebTransport実機E2Eは未完。通知一覧・未読管理、応募／承認／辞退／チャット送信通知、表示言語に依存しない通知遷移は実装済みだが、iOS実機E2Eを残す。

4. **バックエンドの残課題**
   - PostGIS化、評価、Stripe Identity連携、OSプッシュ通知を追加する。チャット送信・翻訳のサーバー側レート制限とブロック登録APIは実装済みで、実機挙動と公開運用設定を確認する。
	- native WebTransportクライアントと実機UDP経路を追加・検証する。チャット内写真送信と通知連携は実装済みだが、画像Moderation、既存添付の鍵ローテーション、2端末実機E2Eは残る。
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
