# Samurai Meet Backend

ユーザー登録・ログイン保持のバックエンド基盤です。

起動・ブラウザ確認・自動テストの詳しい手順は [テスト方法](TESTING.md) を参照してください。
実装状況・次の作業・引き継ぎは [実装状況](STATUS.md) と [TODO](TODO.md) を参照してください。
フロントエンド連携の API 契約は [API 仕様](API_SPEC.md) を参照してください。

## 現在の内容

- 標準ライブラリによる HTTP サーバー
- 公開API: health/readiness、Google OAuth handoff、Passkey、JWS/Refresh、session管理、Key-A envelope、暗号化画像、退会
- PostgreSQLを使う認証・セッション・OAuth・Passkey・画像メタデータ
- Access Token 1分、Refresh rotation、同一Refresh再送の冪等性30秒
- 端末暗号文のprivate保存、暗号文だけのメモリcache、profile画像のRSA-OAEP-256ラップ
- Expo Go用OAuth/session操作クライアント（`backend/expo-test`）

Recovery KeyからKey-Aを作る処理と画像のAES-GCM暗号化はクライアント側の責務です。バックエンドは暗号化済みenvelopeと暗号文だけを受け取ります。PostgreSQL接続とmigrationは起動時に実行します。

## 起動

初回は `.env.example` をコピーして `backend/.env` を作成し、必要な値を設定します。`.env` は Git に含めません。

```powershell
cd backend
Copy-Item .env.example .env
```

開発用の JWS 署名鍵は、次のスクリプトで生成できます。出力された `JWS_SIGNING_KEY` だけを `.env` に設定してください。

```powershell
python scripts/generate_dev_keys.py --server-only
```

引数なしでは、端末側 Key-A / Recovery Key のフローを手動確認するためのテスト値も出力します。これらは `.env`、DB、ログへ保存しません。

```powershell
cd backend
go run ./cmd/server
```

既定では `:8080` で起動します。`HTTP_ADDR` で変更できます。

```powershell
$env:HTTP_ADDR = ':8081'
go run ./cmd/server
```

## DB migration

`migrations/0001_auth_sessions.sql`以降は、ユーザー、Passkey、challenge、OAuth、セッション、Refresh Token、画像メタデータを作成します。

- 運用環境：PostgreSQL（メイン DB）
- ローカル開発・CI テスト：PostgreSQL
- 現在のサービスIDはアプリケーションが生成するopaque TEXT、時刻はUTC RFC3339文字列です。

詳細は [認証仕様](../docs/features/auth.md)、[DB 仕様](../docs/database.md)、[API 仕様](../docs/api.md) を参照してください。

## フロントエンド接続スモークテスト

```powershell
cd backend
python tests/frontend_smoke_test.py
```

実際にバックエンドを起動し、フロントエンドが利用する `/api/v1/healthz` と `/api/v1/readyz` の JSON 応答を確認します。追加パッケージは不要です。

## 画像・鍵・退会APIの手動確認

- `PUT /api/v1/me/key-envelopes` に暗号化済みKey-A envelopeを送る。
- `GET /api/v1/keys/profile-image` でprofile画像用公開JWKを取得する。
- `POST /api/v1/me/photos` は暗号文bodyと`X-Photo-*`ヘッダーを送る。
- `DELETE /api/v1/me` はbodyに`{"confirm":"DELETE"}`を付ける。実データで実行する前に必ずローカルDBを使う。

詳しい契約、ヘッダー、削除方針は [API_SPEC.md](API_SPEC.md) と [DB仕様](../docs/database.md) を参照してください。
