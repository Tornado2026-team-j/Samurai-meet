# バックエンド

Go + PostgreSQL のAPIです。UIは配信せず、正式クライアントは [`../frontend`](../frontend/README.md) が担当します。

```powershell
cd backend
go test ./...
go vet ./...
go build ./cmd/server
go run ./cmd/server
```

APIの厳密な仕様は [API_SPEC.md](API_SPEC.md)、実装時の基準は [docs/ai](../docs/ai/README.md)、初学者向けの説明は [docs/human](../docs/human/README.md) を参照してください。
