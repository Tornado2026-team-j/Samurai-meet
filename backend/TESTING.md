# バックエンドのテスト方法

この文書は、バックエンドを初めて動かすときの手順です。コマンドは PowerShell 向けです。

## 1. 事前準備

必要なものは次の二つです。

- Go 1.26 以降
- Python 3.13 以降（標準ライブラリだけを使うため、追加インストール不要）

リポジトリ直下から、開発用の環境変数ファイルを作成します。

```powershell
cd backend
Copy-Item .env.example .env
```

メイン DB は PostgreSQL です。運用・ローカル開発・CI のすべてで `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`、`DB_SCHEMA` を設定します。ローカルでは `docker compose -f docker-compose.dev.yml up -d` で PostgreSQL を起動できます。

## 2. バックエンドを起動する

ターミナル 1 で実行します。

```powershell
cd backend
go run ./cmd/server
```

次のように表示されれば起動成功です。

```text
backend server listening on :8080 (environment=development)
```

PowerShell から API を直接確認する場合は、別のターミナルで実行します。

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/v1/healthz
Invoke-RestMethod http://127.0.0.1:8080/api/v1/readyz
```

どちらも `status` が返れば成功です。

## 3. 開発用ブラウザクライアントで確認する

バックエンドを起動したまま、ターミナル 2 で実行します。

```powershell
cd backend/dev-client
python server.py
```

ブラウザで `http://localhost:5173` を開きます。画面のAPI URLは同一オリジンの`/api/v1`へ自動設定され、Python開発プロキシがGo APIへ中継します。直接接続する場合だけ`http://127.0.0.1:8080/api/v1`を入力します。

`APP_ENV=development`ではGoサーバーが`DEV_CLIENT_DIR`（既定値`dev-client`）を`/`から配信するため、Cloudflare Tunnelが`127.0.0.1:8080`向きなら`https://samurai-meet.disnana.com/`を開けばよい。Pythonの`backend/dev-client/server.py`を使う場合は、同じ画面を5173番から配信する。

- **ヘルスチェック**: `{ "status": "ok" }` が返ることを確認
- **Readiness 確認**: `{ "status": "ready" }` が返ることを確認

開発クライアントは `APP_ENV=development` のときだけ、設定済みの開発Originからの通信を許可します。ポートを変更する場合は、`backend/.env` の `DEV_CLIENT_ORIGIN` も同じURLに変更してください。

既存のCloudflare Tunnelが `127.0.0.1:5173` を向いている場合、公開ドメインでは開発クライアントが同一オリジンの `/api/v1/*` とOAuthの`/auth/callback`を `127.0.0.1:8080` へプロキシします。API用の別サブドメインやDBポートの公開は不要です。

Cloudflare Tunnel経由の本番構成では、単一の `samurai-meet.disnana.com` を使う。先に `/api/` を Go API の `127.0.0.1:8080` へ、残りをフロントエンドへルーティングする。`HTTP_ADDR=127.0.0.1:8080`、`APP_ENV=production`、`CLIENT_ORIGIN=https://samurai-meet.disnana.com` を設定し、DBのポートはTunnelで公開しない。

## 4. ブラウザでOAuth・Passkeyを確認する

開発ブラウザで実行する場合は、次の値を`backend/.env`へ設定してGoサーバーを再起動します。

```dotenv
DEV_CLIENT_ORIGIN=http://localhost:5173
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_ORIGIN=http://localhost:5173
```

開発クライアントの**Googleでログイン**からOAuthを開始し、`/auth/complete`を経由して戻ったら、**このブラウザをPasskey登録**を押します。ブラウザまたはセキュリティキーの確認を完了した後、次を順に確認します。

1. **登録済み一覧**にcredentialが表示される。
2. **ログアウト**後、**Passkeyでログイン**でdiscoverable loginできる。
3. 別の認証器で追加登録し、一覧から片方だけ解除できる。
4. **セッションを更新**でRefresh rotationが動き、**状態を更新**でもreadinessと更新を確認できる。

本番ドメインで検証する場合は、`CLIENT_ORIGIN=https://samurai-meet.disnana.com`、`WEBAUTHN_RP_ID=samurai-meet.disnana.com`、`WEBAUTHN_RP_ORIGIN=https://samurai-meet.disnana.com`を設定します。ブラウザはHTTPSで開き、Google Consoleのcallbackは引き続き`https://samurai-meet.disnana.com/auth/callback`、OAuth完了後のWebクライアント戻り先は`/auth/complete`です。RP IDはschemeやportを含めません。

Expo GoはOAuth・session確認には使えますが、native Passkeyの動作確認には使いません。iOS/AndroidアプリでPasskeyを使う段階では、Development BuildとAssociated Domains / Digital Asset Linksを設定します。

## 5. 自動テストを実行する

バックエンドのディレクトリで、次を実行します。

```powershell
cd backend
go test ./...
go build ./cmd/server
python tests/frontend_smoke_test.py
python -m unittest discover -s scripts -p "test_*.py"
```

`frontend_smoke_test.py` は PostgreSQL 接続が必要です。ローカルで実行する前に、別ターミナルで `docker compose -f docker-compose.dev.yml up -d` を実行し、次を設定します。

```powershell
$env:RUN_DATABASE_SMOKE_TEST = "1"
```

| コマンド | 確認内容 |
| --- | --- |
| `go test ./...` | セッション判定、`.env` 読込、CORS、HTTP ルーター |
| `go build ./cmd/server` | サーバーがビルドできること |
| `frontend_smoke_test.py` | サーバーを実際に起動し、ブラウザ相当の HTTP リクエストで `/api/v1/healthz` と `/api/v1/readyz` を検証 |
| `unittest discover ...` | 開発用鍵生成スクリプトが 32 bytes の値を生成すること |

すべて成功すると、Python テストでは `OK` と表示されます。

## 6. 開発用の鍵を生成する

JWS 署名鍵を作り直す場合は、次を実行します。

```powershell
cd backend
python scripts/generate_dev_keys.py --server-only
```

表示された `JWS_SIGNING_KEY=...` の値を `backend/.env` の同名項目に貼り付けます。サーバーを再起動すると反映されます。

引数なしの実行では、Key-A と Recovery Key のテスト値も生成します。これらは端末側の鍵フローを確認する用途だけに使い、`.env`、DB、ログには保存しないでください。

## 7. GitHub Actions で CI を手動実行する

GitHub のリポジトリで **Actions** → **Backend CI** を開き、右上の **Run workflow** を選びます。

CI は以下を順に実行します。

1. Go のフォーマット検査
2. `go vet ./...`
3. `go test ./...`
4. `go build ./cmd/server`
5. Python のフロントエンド接続スモークテスト
6. Python の鍵生成スクリプトテスト

## 8. 現時点で試せること・試せないこと

| 状態 | 内容 |
| --- | --- |
| 試せる | サーバー起動、ヘルスチェック、Readiness、CORS、`.env` 読込、Google OAuth、Refresh、ログアウト、WebAuthnブラウザ検証、開発用鍵生成 |
| 未実装 | native PasskeyのDevelopment Build確認、Key-A復旧UI、プロフィール・募集・検索・チャットなどの業務API |

WebAuthnのchallenge一回性・期限切れ・別ユーザー拒否はAPI/DB統合テストへ追加予定です。開発クライアントの操作で発行されたtokenやcredential JSONは保存・共有しないでください。
