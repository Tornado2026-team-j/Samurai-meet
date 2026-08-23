# Backend Dev Client

バックエンド API を手動確認するための開発専用ブラウザクライアントです。プロダクトの Expo アプリには含めません。

```powershell
# terminal 1
cd backend
$env:APP_ENV = "development"
go run ./cmd/server

# terminal 2
cd backend/dev-client
python -m http.server 5173 --bind 127.0.0.1
```

`http://127.0.0.1:5173` を開き、API URL に `http://127.0.0.1:8080` を指定します。API は開発環境かつ `DEV_CLIENT_ORIGIN`（既定値 `http://127.0.0.1:5173`）と一致する Origin だけに CORS を許可します。
