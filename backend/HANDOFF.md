# Samurai Meet バックエンド引き継ぎ書

最終更新: 2026-08-24

## 1. まず読むもの

1. [TODO.md](TODO.md)：実装済み範囲、残タスク、監査上の未完了事項。
2. [API_SPEC.md](API_SPEC.md)：Go実装を正としたAPI契約。
3. [TESTING.md](TESTING.md)：ローカルDB、Cloudflare Tunnel、ブラウザPasskey、Expo Goの試験手順。
4. [../docs/security-audit.md](../docs/security-audit.md)：現時点の監査判定。未実装のP1を確認してから本番作業を行う。
5. [../docs/database.md](../docs/database.md)：PostgreSQL専用のmigrationと削除順序。

## 2. 作業を止めた時点

- ブランチ: `codex/backend-auth-session`
- 最後にpush済み: `e71d585 Key-B初回取得の競合を解消`
- 作業ツリー: この引き継ぎ時点ではクリーン。実装はPR #3へpush済み。
- SQLite: 廃止。DBはPostgreSQLのみ。画像本体はDBではなく、`IMAGE_STORAGE_DIR`配下へ暗号文として保存する。
- 公開構成: Cloudflare Tunnel → `127.0.0.1:8080`。公開URLは `https://samurai-meet.disnana.com`、APIは同一ドメインの`/api/v1`。
- Google callback: `https://samurai-meet.disnana.com/auth/callback`。Google ConsoleにはこのURIだけを登録する。

### 現在の認証・鍵実装

- Google交換後は通常sessionではなく、DBにhashだけを保存する`pre_auth_token`を返す。scopeはPasskey登録/ログインに限定し、5分で失効する。
- Web Passkey成功後、直近Passkey済みWeb sessionから暗号化されたsession handoffを作り、Expo GoがPKCE verifierで交換する。handoffは10分、アプリ途中終了後の再送を考慮している。
- Expo Go (`backend/expo-test`) はGoogle後のpre-authをSecure Storageへ保存し、Web Passkey登録/ログイン後に通常sessionを受け取る。通常session後はWeb Passkey再認証を開ける。
- JWSは`HS256`固定、`typ=JWT`固定、`kid` allow-list方式。新規発行はactive key、旧keyは移行期間中のverify/decryptにだけ使う。
- `POST /api/v1/auth/passkey/reauth/options` と`/reauth/verify`は成功時に現在sessionの`last_passkey_at`を更新する。共通`requireRecentPasskey`をKey-B、Key-A envelope、退会へ適用済み。
- migration `0009_pre_auth_sessions.sql`、`0010_session_handoffs.sql`、`0011_passkey_reauth.sql`、`0012_key_b_materials.sql`を追加した。Key-BはAES-256-GCM暗号文だけをDB保存し、同時初回取得も一意制約競合後に再読込する。

## 3. いま確認できるテストフロー

### サーバーとTunnel

`backend/.env`はignoredファイルで、実際のDBパスワード・Google secret・JWS keyを含む。内容を表示、commit、ログ貼り付けしない。

Expo GoとWeb検証画面を使うローカル確認では、Goプロセスに次を設定する。`.env`の`APP_ENV=production`をそのまま使うと、Goは`/`でdev-clientを配信しない。

```powershell
cd D:\data-backup\code\コード保存\Samurai-meet\backend
$env:APP_ENV='development'
$env:ALLOW_EXPO_GO_REDIRECT='true'
go run ./cmd/server
```

Cloudflare Tunnelは`127.0.0.1:8080`へ向ける。公開ドメインの`/api/readyz`が200になることを先に確認する。

### Expo Go

別ターミナルで次を実行する。

```powershell
cd D:\data-backup\code\コード保存\Samurai-meet\backend\expo-test
bun install --frozen-lockfile
bun run dev
```

`bun run dev`は`expo start`なのでFast Refreshが有効。依存関係を追加・削除した直後や、`Unable to resolve`が残る時だけ一度実行する。

```powershell
bun run dev -- --clear
```

テスト順は、Googleログイン → `pre_auth`表示 → Web Passkey登録/ログイン → Expo Goへ復帰 → 状態更新/Refresh → Passkey一覧・解除 → Key-A/Recovery → session一覧・失効 → 退会です。Google直後に鍵・写真・session一覧が使えないのは仕様です。

`react-native-safe-area-context`の解決エラーは、package.jsonとbun.lockには既に存在するため、`backend/expo-test`で`bun install --frozen-lockfile`を実行してからMetroを再起動します。`Unable to resolve "../../App"`はExpoを`backend/expo-test`以外から起動した、または一時的なMetroキャッシュの可能性があるため、同フォルダから起動し、必要時だけ`--clear`します。

## 4. APIの認証フロー

```text
Google OAuth/OIDC
  -> OAuth handoff exchange
  -> pre_auth_token（Passkey options/verifyだけ）
  -> WebAuthn登録または既知ユーザーlogin
  -> 通常 Access/Refresh session
  -> last_passkey_at を持つsession
  -> Web/Expo session handoff または高権限再認証
```

Access Tokenは1分、Refresh Tokenはopaque 32 bytesでDBにはhashだけを保存する。Refreshはrotationし、同じrequest IDだけ30秒再送可能。別request IDで使用済みtokenを送るとsession familyを失効する。

既存sessionのPasskey再認証は、options/verifyともAccess Tokenが必要で、verifyは`X-Passkey-Ceremony-Token`を受ける。成功してもtokenは返さず、DBの`last_passkey_at`だけを更新する。

## 5. 次の担当が最初にやること

1. `git diff`で未push変更を読み、特に`backend/internal/auth/passkey_service.go`、`backend/internal/auth/jws.go`、`backend/expo-test/App.tsx`、`backend/dev-client/app.js`を確認する。
2. PostgreSQLを使い、migration `0009`〜`0011`込みで統合テストを再実行する。
3. GitHubへpushする前に、`go test ./...`、`go vet ./...`、`go build ./...`、Expo typecheck/test、Node構文検査、`git diff --check`を実行する。
4. PR #3のCodeQL default checkのannotationを確認する。以前のHighは`backend/dev-client/app.js`でURL queryを`window.location.assign`へ直接渡していたことが原因。現在はURL解析・scheme/credential/fragment・Expo URI allow-listを通してから遷移する実装へ変更済みだが、GitHub上で消えたことは未確認。
5. JWS変更、Expo検証画面、pre-auth/session handoff、ドキュメントを日本語の分割commitに分けてcommitし、監査後にpushする。.envはstageしない。

## 6. 未実装の重要事項

### 最優先

- Key-BはAES-256-GCM暗号文DB保存と`GET /api/v1/me/key-b`まで実装。KMS/Secret Manager直結、wrap鍵ローテーション、取得監査、Key-A+Key-BのHKDF client統合は未完了。
- 共通の直近Passkey認証をKey-B、Key-A envelope、退会へ適用済み。Recovery、本人確認変更はAPI未実装。
- `docs/security-audit.md`のSEC-011（JWS）とSEC-013（Key-B）を実装・テスト後に更新。
- 0011のPasskey再認証と、Refresh同時実行・handoff再送のPostgreSQL統合テストを追加。

### 画像・削除

- Expo側の画像暗号化、画像鍵の生成・wrap・復号表示をAPIへ接続。
- DBに存在しない暗号文ファイル、ファイルがないphoto metadataを安全に検出する定期reconciler。
- 退会削除の監査ログ、失敗時再実行、バックアップの物理削除期限。

### 本番・業務機能

- Development Buildのnative Passkey、iOS Associated Domains、Android assetlinks、別端末復旧の実機試験。
- Chat Token / WebSocket / QUICまたはWebTransport。Access/Refreshとは別audience、heartbeat失効、0-RTT状態変更禁止。
- プロフィール、本人確認、募集、現在地、キーワード検索、相互マッチ、相互評価、ブロック、通報。

## 7. 完了見込み

現時点の認証の土台と検証UIは概ね完成しており、再開後の「実装・統合テスト・監査・分割commit/push」は、Key-Bを含めてあと数時間規模です。Key-Bの信頼境界、native Passkey、画像reconciler、チャットtransport、業務機能は別フェーズであり、これらを含めた本番リリースまでは数時間では完了しません。

このファイルを読んだ時点で、まず既存の未push変更を破棄せずに検証してください。`.env`やSecure Storageの値を再生成・削除する操作は、ユーザー確認なしに行わないでください。
