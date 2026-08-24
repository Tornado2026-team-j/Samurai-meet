# バックエンド TODO

最終更新: 2026-08-24

## 0. 作業停止時点（2026-08-24）

このファイルは、今回の作業をここで止めて次の担当へ渡すための状態表です。現在のブランチは`codex/backend-auth-session`、最後にpush済みのcommitは`36b0bb7 認証鍵仕様とセキュリティ監査を実装へ同期`です。今回追加したpre-auth、session handoff、JWS `kid`、Passkey再認証の変更はまだcommit・pushしていません。詳細な再開手順は [HANDOFF.md](HANDOFF.md) を参照してください。

### 今回の作業で実装済みだが、まだremoteへ反映していないもの

- [x] Google交換後に通常sessionを発行せず、5分期限・scope付き`pre_auth_token`だけを返す。
- [x] Google直後のPasskey登録/ログイン成功transactionでpre-authを消費し、通常sessionを発行する。
- [x] Web PasskeyからExpo Goへ戻す10分期限の暗号化session handoff、PKCE verifier、アプリ中断後の再交換。
- [x] Expo Go検証画面のGoogle→Passkey→session→Key-A/Recovery→session管理→退会の操作導線。
- [x] Web検証画面のアプリ復帰処理、URL許可リスト、CodeQL High指摘の対象だった未検証URLの直接遷移を検証済みURL経由へ変更。
- [x] JWS headerの`alg=HS256`/`typ=JWT`/`kid`検証、active keyと旧検証鍵allow-listによるローテーション対応とテスト。
- [x] 既存sessionのPasskey再認証options/verifyと`sessions.last_passkey_at`更新。
- [x] migration `0009`〜`0011`、API/DB/認証仕様書の同期。

### 最後に通過したローカル検査

- [x] `backend`: `go test ./... -count=1`
- [x] `backend`: `go vet ./...`
- [x] `backend`: `go build ./...`
- [x] `backend/expo-test`: `bun run typecheck`
- [x] `backend/expo-test`: `bun test`（2件）
- [x] `node --check backend/dev-client/app.js`
- [x] `git diff --check`（CRLF変換警告のみ）

Passkey再認証の直近変更後にも`go test`、Expo typecheck/test、Node構文検査は再実行済みです。PostgreSQL統合テストは、それ以前のpre-auth/session handoff追加時点で成功していますが、`0011`を含む実DBでの再実行とGitHub Actionsの再実行は残っています。

## 完了済み（再確認用）

- [x] Google OIDC、PKCE、DB state、単一Web callback、アプリhandoff
- [x] アプリ中断後のhandoff再交換とSecure Storage保存
- [x] JWS Access Token、PostgreSQL session、Refresh rotation、reuse失効
- [x] logout / logout-all / session一覧 / session個別失効
- [x] Passkeyの登録・認証・追加・一覧・解除API
- [x] Expo Go用OAuth/sessionテストクライアントと「状態を更新」ボタン
- [x] Expo Go用Passkey Webテスト、pre-auth保持、PKCE session handoffでアプリへ復帰
- [x] PostgreSQL migration、Go/Python/Bun CI、失敗時PRコメント集約
- [x] Key-A envelopeの作成・一覧・version取得・削除API
- [x] 端末暗号文画像のprivate保存、所有者download/delete、暗号文cache
- [x] profile画像のRSA公開JWK配信とサーバー復号配信
- [x] 退会時の認証行・画像metadata・暗号文フォルダ・cache削除
- [x] PostgreSQL分離schemaによる認証・鍵・画像・退会ライフサイクル統合テスト

## 1. 次の実装: 端末鍵とRecovery Key（クライアント側）

- [x] Key-A/Recovery KeyのHKDF・AES-GCM primitiveをTypeScript crypto serviceへ追加する。
- [x] Key-Aを端末Secure Storageで生成・保存する処理と再開UIへ接続する。
- [ ] Recovery Keyを表示前に一度だけ生成し、再表示不可のUIにする。
- [x] Recovery KeyからHKDF用の鍵を導出し、Key-AをAES-256-GCMで端末上暗号化する。
- [x] `key_envelopes`の作成・取得・ローテーションAPIを追加する。
- [ ] Recovery Keyの試行回数、レート制限、監査イベント、失敗時のロックを追加する。
- [x] 既存sessionのPasskey再認証APIと`last_passkey_at`更新を追加する。
- [ ] Key-B / key envelope / Recovery / 新端末登録 / 退会の高権限APIへ直近Passkey必須を接続する。
- [x] Google OAuth交換後を`pre_auth_token`に限定し、Passkey成功後に通常sessionを発行する。
- [x] Google/Passkey/session handoff途中のverifierとpre-authをSecure Storageへ保持し、アプリ再起動後に再開する。

## 2. 次の実装: 暗号化画像（クライアント接続・運用）

- [ ] 端末で画像ごとの256bit画像鍵を作り、AES-256-GCMで暗号化する。
- [x] `/api/v1/keys/profile-image`でRSA-OAEP-256公開JWKを配信する。
- [x] `/api/v1/me/photos`のupload、owner download、deleteを認証・所有権確認と接続する。
- [x] private画像は端末鍵ラップ、profile画像はサーバー公開鍵ラップという種別を明示する。
- [x] MIME、暗号文サイズ、nonce長、SHA-256、key versionをサーバーで検証する。
- [x] ダウンロードは認証済み暗号文と暗号文cacheだけを使い、平文画像をcacheしない。
- [x] upload途中・DB失敗・再試行・退会時のファイルcleanupを統合テストする。

## 3. 次の実装: 退会・削除の確実性（監査・運用）

- [x] `DELETE /api/v1/me`を実装し、全sessionを即時失効する。
- [x] photos metadataとprivate暗号文ファイル削除を同じworkflowで扱う。
- [x] cache keyをユーザー単位で全削除する。
- [ ] 孤児ファイル・孤児metadataを定期reconcilerで検出する。
- [ ] 退会・削除時のDBとファイルの部分失敗を再実行できるreconcilerにする。
- [ ] 削除証跡を監査ログへ記録する。ただし画像平文、鍵、tokenを記録しない。
- [ ] バックアップ保持期間と物理削除の運用手順を確定する。

## 4. Passkey本番確認

- [ ] Development BuildへPasskey native moduleを追加する（Expo GoではWeb画面経由で検証する）。
- [x] 開発ブラウザクライアントへWebAuthn登録・discoverable login・一覧・解除を追加する。
- [x] Web domain callback `/auth/complete` と configured Origin/RP ID allow-listを追加する。
- [ ] iOS Associated Domains / Android assetlinksを本番ドメインで設定する。
- [ ] 登録、同一端末ログイン、別端末discoverable login、credential追加・解除を実機で通す。
- [ ] sign counter、clone warning、バックアップ可能credentialの方針を監査する。

## 5. API・業務機能

- [ ] `/me`、プロフィール、本人確認、募集カード、位置情報、キーワード検索を実装する。
- [ ] マッチ・相互評価・ブロック・通報を実装する。
- [ ] WebSocket / QUIC用Chat TokenをAccess/Refreshとは別audienceで実装する。
- [ ] チャットの暗号文、写真添付、冪等client message ID、失効heartbeatを実装する。

## 6. CI・運用

- [ ] PostgreSQL統合テストで`0011`のPasskey再認証、OAuth handoff、session handoff、Refresh同時実行、reuse失効、Passkey challenge一回性を追加する。
- [ ] 実DBでmigration再実行が安全であることを確認する。
- [ ] JWS `kid`ローテーションの実DB/CI設定テストを追加する。
- [ ] CodeQL default checkのHigh alertがpush後に消えたことをGitHub APIで確認する。
- [ ] 依存関係警告（特にExpo testの`uuid`解決結果）をCIのOSV結果で再確認する。
- [ ] OSVのExpo `image-size`期限付き例外を2026-09-07までに再評価する。
- [ ] 本番では`ALLOW_EXPO_GO_REDIRECT=false`にし、Development Buildの固定schemeだけを許可する。
- [ ] Go、Bun、GitHub Actionsの依存更新後に監査と分割コミットを行う。

## 7. 未着手の設計タスク（次のまとまった作業）

- [ ] Key-Bの信頼境界を確定する。サーバーwrap鍵をKMS/Secret Managerから注入し、Key-B平文をDB・ログ・Secure Storageへ保存しない。
- [ ] Key-B取得APIを実装し、直近Passkey、session有効性、再発行・失効・退会、Key-AとのHKDF結合を統合テストする。
- [ ] 高権限APIの共通`requireRecentPasskey`認可を導入し、退会・Key-A envelope・Recovery・本人確認変更へ適用する。
- [ ] 画像client encryptionをExpo側へ接続し、Key-A+Key-Bから導出したデータ鍵を使う。サーバーは暗号文だけを保存する。
- [ ] 画像孤児回収・監査ログ・バックアップの物理削除期限を運用設計する。
- [ ] `docs/security-audit.md`のSEC-011/013と受入条件を、実装後の判定へ更新する。
- [ ] 日本語の分割commitを作成し、監査後にpushする。`.env`と実鍵は絶対にstageしない。
