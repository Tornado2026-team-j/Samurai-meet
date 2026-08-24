# テスト

```powershell
cd backend
go test ./...
go vet ./...
go build ./cmd/server
python tests/frontend_smoke_test.py

cd ../frontend
bun run typecheck
bun test
```

`frontend_smoke_test.py` はUIテストではなく、起動済みGo APIのhealth/ready確認です。Passkey/OAuthは正式 `frontend/` とDevelopment Build/実機でE2E確認します。
