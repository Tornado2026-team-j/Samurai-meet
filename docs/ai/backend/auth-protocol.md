# 認証プロトコルの実装不変条件

| 段階 | API | 成功時 | 禁止事項 |
| --- | --- | --- | --- |
| Google開始 | `GET /auth/google/start` | OAuth state | 任意redirect許可 |
| Google交換 | `POST /auth/google/exchange` | pre-auth又はsession | Google成功だけで権限昇格 |
| Passkey | `POST /auth/passkey/*` | ceremony結果 | challenge再利用 |
| handoff | `POST /auth/session-handoff/*` | 一回限りcode/session | verifierなし交換 |
| refresh | `POST /auth/refresh` | rotation後session | token reuse許可 |

Google成功は**ログイン完了ではない**。Passkey成功後だけ通常sessionを発行する。Access Tokenは短命かつメモリ専用、Refresh TokenはhashだけをDBへ保存する。

現在のsession handoffは正しいverifierで再交換可能なため、P0で `exchange_request_id` による短時間の同一要求だけの冪等化へ置換する。別request ID、並行交換、期限切れ、verifier不一致は失敗し、sessionを追加発行してはならない。
