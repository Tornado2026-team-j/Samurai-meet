# Samurai Meet Backend

ユーザー登録・ログイン保持のバックエンド基盤です。

起動・ブラウザ確認・自動テストの詳しい手順は [テスト方法](TESTING.md) を参照してください。
実装状況・次の作業・引き継ぎは [実装状況](STATUS.md) と [TODO](TODO.md) を参照してください。
フロントエンド連携の API 契約は [API 仕様](API_SPEC.md) を参照してください。

## 現在の内容

- 標準ライブラリによる HTTP サーバー
- `GET /healthz` と `GET /readyz`
- PostgreSQL を使う認証・セッション migration
- Access Token 1 分、Refresh 再送の冪等性 30 秒を表すドメイン型

Google OAuth、Passkey、JWS の発行・検証、DB 接続は後続コミットで実装します。

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

`migrations/0001_auth_sessions.sql` は、ユーザー、Passkey、仮認証、セッション、Refresh Token、Refresh 再送の冪等性記録を作成します。

- 運用環境：PostgreSQL（メイン DB）
- ローカル開発・CI テスト：PostgreSQL
- UUID と UTC 時刻はアプリケーション側で生成・保存する方針です。

詳細は [認証仕様](../docs/features/auth.md)、[DB 仕様](../docs/database.md)、[API 仕様](../docs/api.md) を参照してください。

## フロントエンド接続スモークテスト

```powershell
cd backend
python tests/frontend_smoke_test.py
```

実際にバックエンドを起動し、フロントエンドが利用する `/healthz` と `/readyz` の JSON 応答を確認します。追加パッケージは不要です。
