# 引き継ぎ

実装を再開する前に [docs/ai/README.md](../docs/ai/README.md)、[バックログ](../docs/ai/plans/backlog.md)、[ゼロトラスト規約](../docs/ai/security/zero-trust.md) を読むこと。

必須検証は `go test ./...`、`go vet ./...`、`go build ./cmd/server`、`frontend` の `bun run typecheck` と `bun test`、最後に `git diff --check` です。秘密値・`.env`・tokenを表示、commit、ログ出力してはいけません。
