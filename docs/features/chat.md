# 機能仕様：チャット

## 現在の実装状態

現行のバックエンドはRESTのチャット一覧・暗号文メッセージ送信・履歴・既読、短命transport token、および**WebSocketによるリアルタイム配送**（`backend/internal/chat/websocket.go`、単一APIインスタンス前提）を持つ。チャット画面の接続と再接続制御はフロント側で未実装。QUIC／WebTransportは将来の標準候補で、以下のQUIC項目は将来仕様である。

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
| 接続認証・配送・順序確定 | `backend/internal/chat/websocket.go` / `backend/internal/chat/hub.go` | Go（WebSocket配送 実装済み。単一インスタンス前提） |
| QUIC配送（将来） | `backend/internal/chat/quic.go`（未実装） | Go（標準候補） |
| 保存・取得・既読 | `backend/internal/chat/service.go` / `backend/internal/httpapi/chat.go` | Go（REST実装済み） |

## 3. 利用条件

- `matches.status = accepted` の参加者だけが利用できる。
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

サーバーは Chat Token（`aud=samurai-meet-chat`、`chat_id` 一致、`transport=websocket`）とセッション有効性・マッチ・ブロック・チャット状態を検証し、`{"type":"auth.ok","chat_id":"…","token_expires_at":"…"}` を返します。失敗時は `{"type":"error","code":"…"}` の後に接続を閉じます。

### クライアント → サーバー

| type | フィールド |
| --- | --- |
| `message.send` | `client_message_id`, `ciphertext`, `nonce`, `algorithm`, `key_version` |
| `message.read` | `last_message_sequence` |
| `typing.start` / `typing.stop` | なし |
| `ping` | なし（`pong` が返る） |

### サーバー → クライアント

| type | 用途 |
| --- | --- |
| `message.created` | 新規メッセージ。`message` に REST と同じ形の暗号文メッセージ。送信操作を発行したソケット**以外**の、そのチャットの全ソケットへ配送する（相手の端末に加え、送信者自身の他端末も含む） |
| `message.ack` | 自分の送信の確定。送信を発行したソケットにだけ返す。`message`, `duplicate`（再送で既存を返した場合 true） |
| `message.read` | 既読の前進。`user_id`, `last_message_sequence`。既読操作を発行したソケット以外の全ソケットへ配送する（相手の端末＋既読した本人の他端末） |
| `typing` | `user_id`, `state`（`start` / `stop`） |
| `error` | `code`, `message`。回復不能な `code`（`blocked` / `chat_not_available` / `chat_closed` / `forbidden`）の後は `closing` が続く。`rate_limited` は一時的で `closing` は続かず、`retry_after_seconds` を伴う |
| `closing` | `reason`。サーバーが接続を閉じる直前に一度だけ送る |

送信メッセージには `client_message_id` を付け、再送されても二重登録しません（`message.send` は既存の REST `SendMessage` と同じ冪等性）。`message.created` / `message.read` は REST 経由の送信・既読でも接続中の全ソケットへ配送されます。配送の除外はユーザー単位ではなくソケット単位のため、同一ユーザーが複数端末で接続していても、送信・既読を行っていない他端末は更新を受け取れます（`typing` だけは自端末のエコーを避けるためユーザー単位で除外）。

## 5. 切断・再接続

1. 接続切断を UI に表示する。
2. 指数バックオフで再接続する。
3. 再接続成功後、最後に受信したメッセージ ID 以降を REST で取得する。
4. 送信中メッセージは `sending / sent / failed` で表示する。
5. 通信断、タイムアウト、一時的なサーバーエラーでは、同じ `client_message_id` を使って期限・回数を制限した自動再送を行う。
6. 入力不正、認証失効、認可拒否などの永続的な失敗では自動再送せず、ユーザーへ再ログイン・再入力などの対応を促す。
7. 同じ `client_message_id` はサーバーで冪等に処理する。

## 6. 暗号化

- E2EE を採用する範囲は要確認だが、採用する場合は TypeScript / native crypto でクライアント暗号化する。
- API へは平文本文ではなく暗号化 payload、nonce、key version を送る。
- Go API は配送・権限・保存を担当し、暗号鍵を持たない設計を優先する。
- QUIC / TLS 1.3が通信路の暗号化・完全性を担い、Chat Token（JWS）がチャット単位の認証・認可・接続管理を担う、という構成は将来仕様である。JWSの署名を通信路暗号化の代わりにしない。
- 0-RTTでは状態変更を受け付けず、JWSの期限・対象chat・セッション・token世代と`client_message_id`の冪等性でリプレイと重複登録を抑止する。
- 暗号化方式、鍵共有、検索・通報時の扱いはセキュリティレビューで確定する。

QUICの理由、JWS claimの検証、heartbeat、失敗時の自動再送、WebSocketを例外採用する条件は [チャット通信トークン仕様](chat-transport.md) に従います。

## 7. API / DB

- `GET /chats`
- `GET /chats/{id}/messages`
- `POST /chats/{id}/messages`
- `POST /chats/{id}/read`
- `POST /chats/{id}/transport-token`
- `POST /matches/{id}/meeting`
- `GET|POST /meetings/{id}/proximity`
- QUIC endpoint：将来、環境ごとに設定する（`chat_id`単位。HTTP/3 WebTransportの場合はHTTPS URLとして提供）
- テーブル：`matches`、`chat_threads`、`messages`、`chat_read_states`、`photos`

RESTのメッセージ送信は`accepted`マッチの参加者だけが利用でき、本文ではなくBase64URLのAES-256-GCM暗号文を保存します。`client_message_id`で再送を冪等化し、WebSocket未接続・再接続直後は`sequence` cursorで`GET /chats/{id}/messages?after=`を使って補完します。サーバーは暗号文を復号しません。

WebSocket配送は現状**単一APIインスタンス前提のin-memoryハブ**（`hub.go`）です。複数インスタンスで動かす場合は、A で送ったメッセージが B の接続へ届きません。PostgreSQL `LISTEN/NOTIFY` によるfan-out（chat-transport.md §6）が次の作業で、それまではチャット配送を1インスタンスに寄せるか、クライアントのRESTポーリングで許容します。

## 8. 受け入れ条件

- マッチ成立後だけチャット画面へ入れる。
- WebSocket接続中の相手へメッセージがリアルタイム配送される（バックエンド実装済み・統合テスト済み。フロント接続は未）。
- WebSocket切断後に再接続すると未同期メッセージを `sequence` cursor で取得できる（フロント側の受入条件）。
- 同じ送信操作を再試行しても二重メッセージにならない。
- 既読状態が相手へ反映される。
- ブロック後は新規メッセージを送受信できない。
- 送信レート上限を超えると REST は 429、WebSocket は `rate_limited` エラーフレームで拒否し、接続は維持される（統合テスト `TestChatSendRateLimit`）。
- セッション失効・マッチ終了（`completed`/`cancelled`）を heartbeat で検知し `closing` を送って切断する（統合テスト `TestChatWebSocketClosesOnSessionRevoke` / `TestChatWebSocketClosesOnMatchCompletion`）。失効していない相手側の接続は維持される。

## 9. 要確認

- メッセージの保存期間と削除後の監査ログ。
- E2EE の採用範囲と通報時の検査方法。
- 既読を相手へ必ず通知するか。
- タイピング表示、通知、オフライン送信の MVP 対象可否。
- Expo実機での再接続負荷・失効確認（バックエンドのWebSocket配送は実装済み・統合テスト済み）。
- 複数APIインスタンス構成にするタイミングと、その際の `LISTEN/NOTIFY` fan-out 実装。
- Chat Token（2分TTL）の接続中ローテーション（`token_seq`）。現状は接続確立時のみ検証し、接続維持はセッション有効性のheartbeatに委ねている。
- 将来QUICを採用する場合の、パケット損失、0-RTTリプレイ、JWSの期限・世代再利用、メッセージ自動再送の上限とバックオフ。
