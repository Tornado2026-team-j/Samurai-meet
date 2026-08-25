# 認証プロトコルの実装不変条件

| 段階 | API | 成功時 | 禁止事項 |
| --- | --- | --- | --- |
| Google開始 | `GET /auth/google/start` | OAuth state | 任意redirect許可 |
| Google交換 | `POST /auth/google/exchange` | pre-auth又はsession | Google成功だけで権限昇格 |
| Bootstrap | `POST /auth/passkey/bootstrap` | 1分・一回限りbootstrap hash | Access/pre-auth tokenをURLへ渡す |
| Web Passkey | `/auth/passkey/web/options|verify` | bootstrap + ceremony + handoff code | browserへAccess/Refresh/pre-authを返す |
| Passkey | `POST /auth/passkey/*` | ceremony結果 | challenge再利用 |
| session handoff | `POST /auth/session-handoff/*` | 一回限りcode/session | request IDなし・別ID再利用 |
| refresh | `POST /auth/refresh` | rotation後session | token reuse許可 |

Google成功は**ログイン完了ではない**。Passkey成功後だけ通常sessionを発行する。Access Tokenは短命かつメモリ専用、Refresh TokenはhashだけをDBへ保存する。

Web PasskeyのURL fragmentは`bootstrap_token`だけにする。bootstrapはhash、scope、元session/pre-auth、ceremony binding、期限、used_atで管理し、Web verifyの成功応答はhandoff codeだけにする。session handoffの再送は正しいverifierに加えて同じ`request_id`かつ30秒以内であることを必須とする。別request ID、request IDなし、期限切れ、verifier不一致は失敗し、sessionを追加発行してはならない。
