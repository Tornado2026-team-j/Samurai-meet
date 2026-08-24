# ログインの流れ

Googleで本人の入口を確認した後、Passkeyで端末利用を確認します。Googleだけで通常セッションを発行しないため、アカウント乗っ取り時の影響を小さくします。

```mermaid
sequenceDiagram
  participant A as Expoアプリ
  participant G as Google
  participant B as Go API
  participant W as Passkey対応Web画面
  A->>B: OAuth開始（端末用challenge）
  B->>G: Googleへリダイレクト
  G-->>B: 認可結果
  B-->>A: 一回限りhandoff code
  A->>B: verifier付きで交換
  B-->>A: 短命 pre-auth
  A->>W: Passkey実行（戻り先とchallenge）
  W->>B: Passkeyを検証
  W-->>A: 一回限りsession handoff
  A->>B: verifier付きで交換
  B-->>A: Access + Refresh session
```

```mermaid
stateDiagram-v2
  [*] --> signed_out
  signed_out --> pre_auth: Google交換
  pre_auth --> signed_in: Passkey成功
  signed_in --> signed_out: logout / refresh失敗
  signed_in --> reauth_required: 鍵・退会など高権限操作
  reauth_required --> signed_in: Passkey再認証
```

Expo Go は開発中のOAuth/deep link確認には使えます。ただしネイティブPasskey、iOS/Androidのアプリリンク確認はDevelopment Buildと実機が必要です。
