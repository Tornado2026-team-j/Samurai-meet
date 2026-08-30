# 機能仕様：チャット

## 現在の実装状態

現行のバックエンドはRESTのチャット一覧・暗号文メッセージ送信・履歴・既読、短命transport token、および**WebSocketによるリアルタイム配送**（`backend/internal/chat/websocket.go`）を持つ。複数APIインスタンス構成は PostgreSQL `LISTEN/NOTIFY` fan-out（`backend/internal/chat/cluster.go`）で対応済み。チャット画面の接続と再接続制御はフロント側で未実装。QUIC／WebTransportは将来の標準候補で、以下のQUIC項目は将来仕様である。

## 1. 対象

マッチ成立後の 1 対 1 チャットを提供します。テキストを基本とし、写真は [写真仕様](photos.md) で定義します。通信認証は通常の Access Token と分離した [チャット通信トークン](chat-transport.md) を利用します。

対応要件：FR-010、FR-011、C-002、C-003、C-005

## 2. 画面・実装

| 画面 / 処理 | ファイル案 | 言語 |
| --- | --- | --- |
| チャット一覧 | `frontend/app/(tabs)/chat.tsx` | TypeScript / TSX |
| 個別チャット | `frontend/app/chat/[id].tsx` | TypeScript / TSX |
| 吹き出し | `frontend/components/ChatBubble.tsx` | TypeScript / TSX |
| 接続状態 | `frontend/hooks/useChatTransport.ts` | TypeScript |
| QUIC クライアント（予定） | `frontend/services/quic.ts`（未実装） | TypeScript + native module |
| API・履歴 | `frontend/services/api.ts` | TypeScript |
| 接続認証・配送・順序確定 | `backend/internal/chat/websocket.go` / `backend/internal/chat/hub.go` | Go（WebSocket配送 実装済み） |
| 複数インスタンス配送 | `backend/internal/chat/cluster.go` | Go（PostgreSQL `LISTEN/NOTIFY` fan-out 実装済み） |
| QUIC配送（将来） | `backend/internal/chat/quic.go`（未実装） | Go（標準候補） |
| 保存・取得・既読 | `backend/internal/chat/service.go` / `backend/internal/httpapi/chat.go` | Go（REST実装済み） |

## 3. 利用条件

- 送信・リアルタイム接続は `matches.status = accepted` の参加者だけが利用できる。
- **`matches.status = completed`（マッチ完了後）は REST の履歴閲覧・既読更新のみ**。
  `POST /chats/{id}/messages`、`POST /chats/{id}/transport-token`、WebSocket 接続
  （`GET /ws/chats/{id}`）はいずれも `chat_not_available`（HTTP 409、WS は
  `chat_not_available` エラーフレーム後に切断）で拒否される。`GET /chats`、
  `GET /chats/{id}/messages`、`POST /chats/{id}/read` は引き続き可能。
- ブロックまたは運営停止された場合は送受信を停止する。
- マッチ成立前の自由チャットは提供しない。
- メッセージ送信はユーザー単位のトークンバケットでレート制限する（REST/WebSocket 共通、`chat.Service` 層で実施）。既定は容量15・補充60/分（`CHAT_SEND_BURST` / `CHAT_SEND_REFILL_PER_MINUTE`）。超過時は REST が `429 chat_rate_limited` ＋ `Retry-After`、WebSocket が `{"type":"error","code":"rate_limited","retry_after_seconds":N}`（接続は維持し、`closing` は送らない）。
- 将来のリアルタイム配送は QUIC（HTTP/3 WebTransportを含む）を標準候補とし、`aud = samurai-meet-chat` のChat Tokenだけを利用する。現行はRESTである。
- Refresh Tokenを将来のtransportへ送信しない。

## 4. WebSocket イベント（実装済み）

MVP のリアルタイム配送は WebSocket。QUIC / HTTP/3 WebTransport は将来の標準候補で、同じ Chat Token 認可モデルを適用する。

エンドポイント：`GET wss://…/api/v1/ws/chats/{chat_id}`。接続直後、クライアントは 5 秒以内に認証フレームを 1 通送ります（Chat Token を URL query に載せない。chat-transport.md §3）。

```json
{"type":"auth","chat_token":"<JWS>"}
```

サーバーは Chat Token（`aud=samurai-meet-chat`、`chat_id` 一致、`transport=websocket`）とセッション有効性・マッチ・ブロック・チャット状態を検証し、`{"type":"auth.ok","chat_id":"…","token_seq":N,"token_expires_at":"…"}` を返します。失敗時は `{"type":"error","code":"…"}` の後に接続を閉じます。接続維持中は `token.renew` で Chat Token をローテーションでき（`token_seq` は前進のみ）、期限までに更新しないと heartbeat が `closing(token_expired)` で切断します。

### クライアント → サーバー

| type | フィールド |
| --- | --- |
| `message.send` | `client_message_id`, `ciphertext`, `nonce`, `algorithm`, `key_version` |
| `message.read` | `last_message_sequence` |
| `typing.start` / `typing.stop` | なし |
| `ping` | なし（`pong` が返る） |
| `token.renew` | `chat_token`（期限前に取得した新しい Chat Token。`token.renewed` または `error` が返る） |

### サーバー → クライアント

| type | 用途 |
| --- | --- |
| `message.created` | 新規メッセージ。`message` に REST と同じ形の暗号文メッセージ。送信操作を発行したソケット**以外**の、そのチャットの全ソケットへ配送する（相手の端末に加え、送信者自身の他端末も含む） |
| `message.ack` | 自分の送信の確定。送信を発行したソケットにだけ返す。`message`, `duplicate`（再送で既存を返した場合 true） |
| `message.read` | 既読の前進。`user_id`, `last_message_sequence`。既読操作を発行したソケット以外の全ソケットへ配送する（相手の端末＋既読した本人の他端末） |
| `typing` | `user_id`, `state`（`start` / `stop`） |
| `token.renewed` | `token_seq`, `token_expires_at`。`token.renew` 成功時。接続の期限がここまで前進する |
| `error` | `code`, `message`。回復不能な `code`（`blocked` / `chat_not_available` / `forbidden`）の後は `closing` が続く。`rate_limited`（`retry_after_seconds` を伴う）/ `stale_token` / `invalid_token` は一時的で `closing` は続かない |
| `closing` | `reason`。サーバーが接続を閉じる直前に一度だけ送る。`token_expired` は期限までに `token.renew` されなかった場合 |

送信メッセージには `client_message_id` を付け、再送されても二重登録しません（`message.send` は既存の REST `SendMessage` と同じ冪等性）。`message.created` / `message.read` は REST 経由の送信・既読でも接続中の全ソケットへ配送されます。配送の除外はユーザー単位ではなくソケット単位のため、同一ユーザーが複数端末で接続していても、送信・既読を行っていない他端末は更新を受け取れます（`typing` だけは自端末のエコーを避けるためユーザー単位で除外）。

`last_message_sequence` は**「クライアントが見た最大 `sequence`」を渡すハイウォーターマーク**で、そのチャットに実在する message の `sequence` と厳密一致する必要はありません。`sequence` は全チャット横断の `BIGSERIAL` で1チャット内では歯抜けになるため、サーバーはその値を**そのチャットの最新 live message の `sequence` にクランプ**し、保存済みマーカーは前進のみ（`GREATEST`）です。1以上なら受理し、`message.read` レシート（および REST の応答経路）では**クランプ後の実効値**を相手へ通知します。0以下は `invalid_chat_request`、messageが1件も無いチャットは `chat_not_found`（`ErrMessageNotFound`）を返します。

## 5. 切断・再接続

1. 接続切断を UI に表示する。
2. 指数バックオフで再接続する。
3. 再接続成功後、最後に受信したメッセージ ID 以降を REST で取得する。
4. 送信中メッセージは `sending / sent / failed` で表示する。
5. 通信断、タイムアウト、5xx では、同じ `client_message_id` で自動再送する。再送は計4回、バックオフ 1/2/4 秒（±50% ジッター）、全体期限 30 秒（[チャット通信トークン仕様](chat-transport.md) §7.2 の確定契約）。
6. 4xx・入力不正・認証失効・認可拒否では自動再送せず、ユーザーへ再ログイン・再入力などの対応を促す。
7. 同じ `client_message_id` はサーバーで冪等に処理する（`(chat_id, sender_user_id, client_message_id)` 一意制約。再送は最初のメッセージ／ack を返す）。`client_message_id` は1論理送信につき1回だけ生成し（UUIDv4 推奨）、最大128文字・制御/空白文字なし。

## 6. 暗号化

- E2EE を採用する範囲は要確認だが、採用する場合は TypeScript / native crypto でクライアント暗号化する。
- API へは平文本文ではなく暗号化 payload、nonce、key version を送る。
- Go API は配送・権限・保存を担当し、暗号鍵を持たない設計を優先する。
- QUIC / TLS 1.3が通信路の暗号化・完全性を担い、Chat Token（JWS）がチャット単位の認証・認可・接続管理を担う、という構成は将来仕様である。JWSの署名を通信路暗号化の代わりにしない。
- 0-RTTでは状態変更を受け付けず、JWSの期限・対象chat・セッション・token世代と`client_message_id`の冪等性でリプレイと重複登録を抑止する。
- 暗号化方式、鍵共有、検索・通報時の扱いはセキュリティレビューで確定する。

QUICの理由、JWS claimの検証、heartbeat、失敗時の自動再送、WebSocketを例外採用する条件は [チャット通信トークン仕様](chat-transport.md) に従います。

## 7. API / DB

- `GET /chats`（`accepted` / `completed`）
- `GET /chats/{id}/messages`（`accepted` / `completed`）
- `POST /chats/{id}/messages`（`accepted` のみ）
- `POST /chats/{id}/read`（`accepted` / `completed`）
- `POST /chats/{id}/transport-token`（`accepted` のみ）
- `GET /ws/chats/{id}`（`accepted` のみ）
- `POST /matches/{id}/meeting`
- `GET|POST /meetings/{id}/proximity`
- QUIC endpoint：将来、環境ごとに設定する（`chat_id`単位。HTTP/3 WebTransportの場合はHTTPS URLとして提供）
- テーブル：`matches`、`chat_threads`、`messages`、`chat_read_states`、`chat_token_sequences`、`chat_message_deletions`、`photos`

RESTのメッセージ送信・`transport-token`発行・WebSocket接続は`accepted`マッチの参加者だけが利用できます。`completed`マッチは一覧・履歴・既読のみで、送信と接続は`chat_not_available`で拒否されます。本文ではなくBase64URLのAES-256-GCM暗号文を保存します。`client_message_id`で再送を冪等化し、WebSocket未接続・再接続直後は`sequence` cursorで`GET /chats/{id}/messages?after=`を使って補完します。サーバーは暗号文を復号しません。

保持期間（既定180日・`CHAT_MESSAGE_RETENTION_DAYS`）を過ぎたメッセージは6時間ごとのスイープで`deleted_at`を打ち、暗号文・nonceを消去し、`chat_message_deletions`へ監査行を残します。以後は履歴・未読数・配送のいずれにも現れません。

WebSocketの配送はプロセス内ハブ（`hub.go`）で行い、複数インスタンス構成では PostgreSQL `LISTEN/NOTIFY` fan-out（`cluster.go`）が各インスタンスの `message.created` / `message.read` / `typing` を他インスタンスのローカルソケットへ再配送します。NOTIFY のペイロードは `sequence` などの最小情報だけで、受信側が暗号文行を DB から再取得します（8000 byte 上限内）。発行元インスタンスのイベントは自分では再配送しません。NOTIFY 取りこぼし時はクライアントが再接続時に `sequence` cursor で REST 補完します。単一インスタンス運用では `StartClusterFanout` を呼ばなければ NOTIFY を出しません。`LISTEN` 用に専用のプールコネクションを1本占有します。

## 8. 受け入れ条件

- マッチ成立後だけチャット画面へ入れる。
- `completed` マッチではチャット画面は履歴閲覧・既読のみ（入力欄を無効化し、WebSocket 接続と `transport-token` 取得を行わない）。
- WebSocket接続中の相手へメッセージがリアルタイム配送される（バックエンド実装済み・統合テスト済み。フロント接続は未）。
- WebSocket切断後に再接続すると未同期メッセージを `sequence` cursor で取得できる（フロント側の受入条件）。
- 同じ送信操作を再試行しても二重メッセージにならない。
- 既読状態が相手へ反映される。
- ブロック後は新規メッセージを送受信できない。
- 送信レート上限を超えると REST は 429、WebSocket は `rate_limited` エラーフレームで拒否し、接続は維持される（統合テスト `TestChatSendRateLimit`）。
- セッション失効・マッチ終了（`completed`/`cancelled`）を heartbeat で検知し `closing` を送って切断する（統合テスト `TestChatWebSocketClosesOnSessionRevoke` / `TestChatWebSocketClosesOnMatchCompletion`）。失効していない相手側の接続は維持される。
- 保持期間を過ぎたメッセージは暗号文が消去され、履歴・未読・配送から除外され、削除監査が残る（統合テスト `TestChatMessageRetentionPurge`）。

## 9. 要確認

- メッセージの保存期間の**具体日数**（実装は完了。既定180日・`CHAT_MESSAGE_RETENTION_DAYS`で調整、期限超過で暗号文消去＋`chat_message_deletions`へ監査。最終日数は運用・法務判断）。
- E2EE の採用範囲と通報時の検査方法。
- 既読を相手へ必ず通知するか。
- タイピング表示、通知、オフライン送信の MVP 対象可否。
- Expo実機での再接続負荷・失効確認は [chat-load-test.md](chat-load-test.md) の手順書で実施する（ローンチ前QAゲート。バックエンドのWebSocket配送・失効・ローテーションは実装済み・統合テスト済み）。
- 複数APIインスタンス構成にするタイミングと、その際の `LISTEN/NOTIFY` fan-out 実装。
- 将来QUICを採用する場合の、パケット損失、0-RTTリプレイ、JWSの期限・世代再利用、メッセージ自動再送の上限とバックオフ。
