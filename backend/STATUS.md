# バックエンド実装状況と引き継ぎ

最終更新: 2026-08-24

## 現在の構成

```text
Expo Go / Development Build
  ├─ Google OAuth2 / OIDC + PKCE + handoff
  ├─ JWS Access Token / Refresh Token rotation
  └─ Passkey/WebAuthn（Development Buildで実端末検証）
        │ HTTPS / Cloudflare Tunnel
Go API :8080
  ├─ PostgreSQL（users / OAuth / Passkey / sessions / photos metadata）
  └─ private file storage（暗号文画像のみ）
```

SQLiteは廃止し、DBはPostgreSQLだけです。画像本体はDBへ入れず、`IMAGE_STORAGE_DIR`配下に暗号文として保存します。

## 実装済み

- PostgreSQL接続、ordered migration、CI PostgreSQL integration
- Google OIDCのissuer / audience / signature / expiry / `sub`検証
- OAuth state、Google PKCE verifier、アプリhandoff challengeのDB一回性
- Expo Goの`exp://.../--/auth`と本番`samuraimeet://auth`への復帰
- アプリ中断後のhandoff再交換（サーバー側暗号化レスポンスの再取得）
- HS256 JWS Access Token（TTL 1分）とDB session失効確認
- 256bit opaque Refresh Token、SHA-256 hash保存、30日アイドル / 90日絶対期限
- Refresh Token rotation、同一`request_id`の30秒再送、別request IDのreuse時session family失効
- ログアウト、全端末ログアウト、セッション一覧、個別セッション失効
- WebAuthnの登録options / verify、discoverable login options / verify、credential一覧 / 削除
- credential JSON、公開鍵、sign counter、challengeのPostgreSQL保存
- 暗号文専用画像保存、SHA-256、容量/TTL付き暗号文キャッシュ
- RSA-OAEP-256によるプロフィール画像鍵ラップ、公開JWK配信、profile画像の一時復号配信
- Key-A envelopeの作成・取得・更新・削除API（暗号化済みKey-Aのみ保存）
- 写真の暗号文upload/download/delete、所有者認可、private保存、cache無効化
- 退会時の全session失効、認証関連行・画像metadata・暗号文フォルダ・cacheの削除
- PostgreSQL分離schemaを使った認証・鍵・画像・退会ライフサイクル統合テスト
- Expo Go開発クライアント、`状態を更新`、Secure Storageでのtoken保持
- Go test / build、PostgreSQL integration、Python smoke、Expo typecheck / Bun auditのCI

## 現在の実接続確認

- 本番API: `https://samurai-meet.disnana.com/api/v1`
- Cloudflare Tunnel: `127.0.0.1:8080`
- Google Console callback: `https://samurai-meet.disnana.com/auth/callback`
- ローカル`.env`ではExpo Go試験のため`ALLOW_EXPO_GO_REDIRECT=true`を設定済み。運用環境ではfalseにする。
- Expo GoはSDK54を使用する。Passkeyの実端末確認はExpo GoではなくDevelopment Buildで行う。

## 未実装・次に行うこと

詳細は [TODO.md](TODO.md) と [API_SPEC.md](API_SPEC.md) を参照します。

1. TypeScript側のKey-A生成、Recovery Key表示、HKDF/AES-GCM、復旧途中の再開UI
2. 画像client encryption、サイズ/MIME検査の実クライアント接続、孤児ファイルreconciler
3. 退会の監査ログと、バックアップ保持期間・物理削除期限の運用確定
4. 本番Development BuildのPasskey実端末テストとiOS/Android association設定
5. チャット用QUIC/WebTransport短命token（Access/Refreshと別audience）
6. レート制限、監査ログ、本人確認、プロフィール・募集・検索API

## セキュリティ不変条件

- Access Token、Refresh Token、Key-A、Key-B、Recovery Key、handoff code、画像平文をログへ出さない。
- DBへRefresh Token、Recovery Key、Key-Aの平文を保存しない。
- DB失効確認なしにJWSの署名だけで保護APIを通さない。
- Refresh TokenをWebSocket/QUICのURLやメッセージへ送らない。
- private画像領域とメモリcacheには暗号文だけを置く。
- 退会時はDB行・暗号文ファイル・cacheを削除し、削除失敗を黙って成功扱いにしない。
- `ALLOW_EXPO_GO_REDIRECT=true`は開発確認専用で、本番公開設定へ持ち込まない。

## 引き継ぎ時の確認順

1. `go test ./...` と `go build ./cmd/server`を実行する。
2. `backend/API_SPEC.md`、`docs/features/auth.md`、`docs/database.md`と実装を突き合わせる。
3. `backend/expo-test`で`bun install --frozen-lockfile`、`bun run typecheck`、`bun run security:audit`を実行する。
4. PostgreSQLを起動し、`TEST_POSTGRES=1`と`RUN_DATABASE_SMOKE_TEST=1`で統合テストを実行する。
5. OAuth / Passkey / 鍵復旧を実端末で確認した後、`docs/security-audit.md`を更新する。
