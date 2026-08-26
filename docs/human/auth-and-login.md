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
  A->>B: bootstrap発行（pre-auth Bearer）
  B-->>A: 短命bootstrap token
  A->>W: bootstrapだけをURL fragmentへ渡す
  W->>B: options（bootstrap header）
  B-->>W: WebAuthn options + ceremony token
  W->>B: verify（bootstrap + ceremony headers）
  B-->>W: handoff codeだけ
  W-->>A: 許可済みdeep link
  A->>B: handoff exchange（verifier + request_id）
  B-->>A: Access + Refresh session
```

```mermaid
stateDiagram-v2
  [*] --> signed_out
  signed_out --> pre_auth: Google交換
  pre_auth --> passkey_bootstrap: bootstrap発行
  passkey_bootstrap --> signed_in: Web Passkey成功・handoff交換
  signed_in --> signed_out: logout / refresh失敗
  signed_in --> reauth_required: 鍵・退会など高権限操作
  reauth_required --> signed_in: Passkey再認証
```

Expo Go は開発中のOAuth/deep link確認には使えます。ただしネイティブPasskey、iOS/Androidのアプリリンク確認はDevelopment Buildと実機が必要です。
