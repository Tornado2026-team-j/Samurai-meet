# Backend Dev Client

バックエンド API を手動確認するための開発専用ブラウザクライアントです。プロダクトの Expo アプリには含めません。

```powershell
# terminal 1
cd backend
go run ./cmd/server

# terminal 2
cd backend/dev-client
python server.py
```

`http://127.0.0.1:5173` を開き、API URL に `http://127.0.0.1:8080/api/v1` を指定します。公開ドメインでは同一オリジンの `/api/v1` を開発プロキシがバックエンドへ中継します。プロダクトAPIの契約は常に `/api/v1` です。
