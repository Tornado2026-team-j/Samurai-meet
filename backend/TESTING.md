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

このリポジトリには開発用の `backend/.env` がすでにある場合もあります。SQLite は `DB_DRIVER=sqlite` と `SQLITE_PATH` のまま使えます。PostgreSQL を使う場合は、`DB_DRIVER=postgres` に変更して `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`、`DB_SCHEMA` を設定します。

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
Invoke-RestMethod http://127.0.0.1:8080/healthz
Invoke-RestMethod http://127.0.0.1:8080/readyz
```

どちらも `status` が返れば成功です。

## 3. 開発用ブラウザクライアントで確認する

バックエンドを起動したまま、ターミナル 2 で実行します。

```powershell
cd backend/dev-client
python -m http.server 5173 --bind 127.0.0.1
```

ブラウザで `http://127.0.0.1:5173` を開きます。画面の API URL は既定値の `http://127.0.0.1:8080` のままで構いません。

- **ヘルスチェック**: `{ "status": "ok" }` が返ることを確認
- **Readiness 確認**: `{ "status": "ready" }` が返ることを確認

開発クライアントは `APP_ENV=development` のときだけ、`http://127.0.0.1:5173` からの通信を許可します。ポートを変更する場合は、`backend/.env` の `DEV_CLIENT_ORIGIN` も同じ URL に変更してください。

## 4. 自動テストを実行する

バックエンドのディレクトリで、次を実行します。

```powershell
cd backend
go test ./...
go build ./cmd/server
python tests/frontend_smoke_test.py
python -m unittest discover -s scripts -p "test_*.py"
```

| コマンド | 確認内容 |
| --- | --- |
| `go test ./...` | セッション判定、`.env` 読込、CORS、HTTP ルーター |
| `go build ./cmd/server` | サーバーがビルドできること |
| `frontend_smoke_test.py` | サーバーを実際に起動し、ブラウザ相当の HTTP リクエストで `/healthz` と `/readyz` を検証 |
| `unittest discover ...` | 開発用鍵生成スクリプトが 32 bytes の値を生成すること |

すべて成功すると、Python テストでは `OK` と表示されます。

## 5. 開発用の鍵を生成する

JWS 署名鍵を作り直す場合は、次を実行します。

```powershell
cd backend
python scripts/generate_dev_keys.py --server-only
```

表示された `JWS_SIGNING_KEY=...` の値を `backend/.env` の同名項目に貼り付けます。サーバーを再起動すると反映されます。

引数なしの実行では、Key-A と Recovery Key のテスト値も生成します。これらは端末側の鍵フローを確認する用途だけに使い、`.env`、DB、ログには保存しないでください。

## 6. GitHub Actions で CI を手動実行する

GitHub のリポジトリで **Actions** → **Backend CI** を開き、右上の **Run workflow** を選びます。

CI は以下を順に実行します。

1. Go のフォーマット検査
2. `go vet ./...`
3. `go test ./...`
4. `go build ./cmd/server`
5. Python のフロントエンド接続スモークテスト
6. Python の鍵生成スクリプトテスト

## 7. 現時点で試せること・試せないこと

| 状態 | 内容 |
| --- | --- |
| 試せる | サーバー起動、ヘルスチェック、Readiness、CORS、`.env` 読込、開発用鍵生成 |
| 未実装 | Google OAuth、Passkey、JWS の発行・検証、DB 接続、Refresh、ログアウト、セッション管理、Key envelope API |

後者の API を実装したら、同じ `backend/dev-client/` にログイン後のセッション・鍵フロー確認パネルを追加します。
