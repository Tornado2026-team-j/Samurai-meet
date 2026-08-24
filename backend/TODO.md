# バックエンド TODO

最終更新: 2026-08-24

## 完了済み（再確認用）

- [x] Google OIDC、PKCE、DB state、単一Web callback、アプリhandoff
- [x] アプリ中断後のhandoff再交換とSecure Storage保存
- [x] JWS Access Token、PostgreSQL session、Refresh rotation、reuse失効
- [x] logout / logout-all / session一覧 / session個別失効
- [x] Passkeyの登録・認証・追加・一覧・解除API
- [x] Expo Go用OAuth/sessionテストクライアントと「状態を更新」ボタン
- [x] PostgreSQL migration、Go/Python/Bun CI、失敗時PRコメント集約
- [x] Key-A envelopeの作成・一覧・version取得・削除API
- [x] 端末暗号文画像のprivate保存、所有者download/delete、暗号文cache
- [x] profile画像のRSA公開JWK配信とサーバー復号配信
- [x] 退会時の認証行・画像metadata・暗号文フォルダ・cache削除
- [x] PostgreSQL分離schemaによる認証・鍵・画像・退会ライフサイクル統合テスト

## 1. 次の実装: 端末鍵とRecovery Key（クライアント側）

- [x] Key-A/Recovery KeyのHKDF・AES-GCM primitiveをTypeScript crypto serviceへ追加する。
- [ ] Key-Aを端末Secure Storageで生成・保存する処理と再開UIへ接続する。
- [ ] Recovery Keyを表示前に一度だけ生成し、再表示不可のUIにする。
- [ ] Recovery KeyからHKDF用の鍵を導出し、Key-AをAES-256-GCMで端末上暗号化する。
- [x] `key_envelopes`の作成・取得・ローテーションAPIを追加する。
- [ ] Recovery Keyの試行回数、レート制限、監査イベント、失敗時のロックを追加する。
- [ ] Recovery / Key-B / 新端末登録 / 退会を直近Passkey認証必須にする。
- [ ] Google OAuth交換後を`pre_auth_token`に限定し、Passkey成功後に通常sessionを発行する。
- [ ] 復旧途中にアプリが落ちても、状態を再開できる有限状態機械をクライアントへ追加する。

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
- [ ] 削除証跡を監査ログへ記録する。ただし画像平文、鍵、tokenを記録しない。
- [ ] バックアップ保持期間と物理削除の運用手順を確定する。

## 4. Passkey本番確認

- [ ] Development BuildへPasskey native moduleを追加する（Expo Goでは検証しない）。
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

- [ ] PostgreSQL統合テストでOAuth handoff、Refresh同時実行、reuse失効、Passkey challenge一回性を追加する。
- [ ] 実DBでmigration再実行が安全であることを確認する。
- [ ] OSVのExpo `image-size`期限付き例外を2026-09-07までに再評価する。
- [ ] 本番では`ALLOW_EXPO_GO_REDIRECT=false`にし、Development Buildの固定schemeだけを許可する。
- [ ] Go、Bun、GitHub Actionsの依存更新後に監査と分割コミットを行う。
