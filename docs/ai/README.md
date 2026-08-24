# AI実装契約

このフォルダは、AIと実装担当者が変更前に読む一次資料です。人間向けの概念説明は `docs/human/`、コードに密着した既存仕様は `backend/API_SPEC.md` です。矛盾した場合は **コードと migration を先に確認し、このフォルダを更新してから実装** します。

| 文書 | 正とする範囲 |
| --- | --- |
| [backend API契約](backend/http-api.md) | HTTP、認証、エラー、CORS |
| [frontend結合契約](frontend/integration.md) | 保存領域、deep link、状態、Web Passkey境界 |
| [ゼロトラスト規約](security/zero-trust.md) | 不変条件、機密情報、権限昇格 |
| [バックログ](plans/backlog.md) | 未完了項目、依存、完了定義 |

変更手順: 契約確認 → テスト追加/更新 → 実装 → `go test ./...` と `bun run typecheck && bun test` → `git diff --check` → セキュリティ差分監査。秘密値・token・Recovery Keyをドキュメント、fixture、ログに置かないこと。
