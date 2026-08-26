# ゼロトラスト実装規約

```mermaid
stateDiagram-v2
  [*] --> untrusted_request
  untrusted_request --> authenticated: JWT + DB session
  authenticated --> step_up: sensitive operation
  step_up --> authorized: recent Passkey
  authenticated --> denied: revoked / expired / wrong owner
  step_up --> denied: ceremony expired / invalid
```

- 認可はhandlerで終わらせず、service/repository境界でも所有者・session・用途を確認する。
- tokenは短命、Refreshはrotation、reuse検知時はsession familyを失効する。
- 鍵は最小目的・最小寿命で渡し、DBとログには暗号文またはhashだけを保存する。
- Key-Bは端末Secure Storage／Keychain／Keystoreに限定し、サーバーには端末公開鍵だけを登録する。画像APIは端末proof、timestamp、body hash、ワンタイムnonceを検証し、Key-B平文をサーバーへ返さない。
- 監査イベントにはactor、対象、操作、結果、相関ID、時刻だけを記録する。token、平文、Recovery Key、暗号文本文を記録しない。
- 所有権が不明な画像・metadataは公開せずquarantineし、reconcilerが再試行可能な削除ジョブを作る。
