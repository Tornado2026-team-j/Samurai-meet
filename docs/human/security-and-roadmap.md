# 安全性と今後の実装順

このプロジェクトでは「ネットワーク・端末・内部サービスのどれも最初から信用しない」ゼロトラストを採用します。毎回、利用者・端末・操作目的・期限を確認します。

```mermaid
flowchart LR
  R[要求] --> I[Access tokenを検証]
  I --> S[session失効状態を確認]
  S --> P{高権限操作?}
  P -->|いいえ| A[最小権限で実行]
  P -->|はい| K[5分以内のPasskey再認証]
  K --> A
  A --> L[秘密を含めない監査証跡]
```

## 現在の残作業

優先順位は、(1) 募集・応募・通知遷移のiOS実機E2E、(2) native Passkey・端末Key-Bの実機/監査確認、(3) 端末画像暗号化と端末移行の画面統合、(4) 退会reconcilerと削除監査、(5) プロフィール編集UIの完全同期、(6) native WebTransportの実機接続・再接続・負荷試験です。募集・マッチングAPI、募集管理・応募履歴、チャット画面のREST機能、通知のアプリ内REST接続、WebTransportバックエンドは残作業ではありません。

通知は現在アプリ内通知だけで、OSプッシュ配送は未実装です。通常のiPhone接続先は `https://samurai-meet.disnana.com/api/v1`、ローカルAPIは環境変数で明示した場合だけ使います。完了条件と依存関係は [AI向けバックログ](../ai/plans/backlog.md) を参照してください。

### Moderationの一時例外

`CHAT_MODERATION_DEV_FREE_MODE=true`は、OpenAIキーがない状態で実機・共有テストを進めるための明示的な一時例外です。`APP_ENV=production`でも設定自体は拒否せず、起動時に「OpenAIではないローカル判定であること」「実データを使わないこと」「通常運用前に無効化すること」を警告します。通常の本番運用では`false`と`OPENAI_API_KEY`を使用し、キー未設定・OpenAI障害時のfail-closedを維持します。
