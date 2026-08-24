# 全体像

Samurai Meet は、スマホアプリがGo製APIを呼び、PostgreSQLに必要最小限の認証・状態を保存する構成です。バックエンドは画面を配信しません。画面は `frontend/` が責任を持ちます。

```mermaid
flowchart LR
  U[利用者] --> F[Expo / React Native
正式フロントエンド]
  F -->|HTTPS: /api/v1| B[Go バックエンド]
  B --> DB[(PostgreSQL)]
  B --> FS[暗号文画像ストレージ]
  F --> G[Google OAuth]
  F --> W[Web Passkey UI]
  B --> W
  subgraph 信頼境界
    F
    B
    DB
    FS
  end
```

## 用語

- **API**: 画面から送られた要求を処理する窓口です。
- **セッション**: ログイン済みであることを表す、短時間の利用許可です。
- **Access Token**: API呼び出し専用の短命な鍵。端末の永続保存には入れません。
- **Refresh Token**: Access Tokenを更新するための長めの鍵。端末のSecure Storageだけに保存します。
- **Passkey**: 端末の生体認証や画面ロックを使うログイン方式です。

実装済み・未実装の正確な一覧は [実装状態とバックログ](../ai/plans/backlog.md) を参照してください。
