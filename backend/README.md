# バックエンド

Go + PostgreSQL のAPIとWeb Passkey画面を配信します。ネイティブの正式クライアントは [`../frontend`](../frontend/README.md) が担当し、Web Passkeyはバックエンドの `/passkey` を使用します。

```powershell
cd backend
go test ./...
go vet ./...
go build ./cmd/server
go run ./cmd/server
```

APIの厳密な仕様は [API_SPEC.md](API_SPEC.md)、実装時の基準は [docs/ai](../docs/ai/README.md)、初学者向けの説明は [docs/human](../docs/human/README.md) を参照してください。

## チャットModeration

通常は`OPENAI_API_KEY`を使った送信前Moderationを行い、未設定・timeout・上流障害ではfail-closedで本文を送信しません。実機確認用に`CHAT_MODERATION_DEV_FREE_MODE=true`を明示すると、APIキーが残っていても外部送信を行わない保守的なローカル判定へ切り替わります。

この一時モードは`APP_ENV=production`でも起動できますが、通常の本番安全性を満たす代替ではありません。起動時警告を確認し、実データを使わず、正式運用前に無効化してください。詳細は [チャット仕様](../docs/features/chat.md) を参照してください。
