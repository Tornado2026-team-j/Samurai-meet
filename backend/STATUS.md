# 実装状態

- 実装済み: Google OAuth、pre-auth、Passkey、session/refresh、Key-A envelope、端末固有Key-Bの公開鍵登録・proof、暗号文画像API、退会API、募集カード・マッチング・ブロックの最小実装（`backend/internal/matching`）、チャットのREST部分（一覧・履歴・送信、`backend/internal/chat`。本文は現状平文保存）。
- 未完了: Web Passkeyの実機E2E、端末画像の画面統合、削除reconciler、legacy画像移行、native Passkey実機、募集カードの検索・編集・削除、通報、チャットのWebSocket・Chat Token・既読API・削除API・E2EE、プロフィール、評価。

詳細と完了定義は [docs/ai/plans/backlog.md](../docs/ai/plans/backlog.md) を正とします。
