# 機能仕様：チャット

## 1. 対象

マッチ成立後の 1 対 1 チャットを提供します。テキストを基本とし、写真は [写真仕様](photos.md) で定義します。通信認証は通常の Access Token と分離した [チャット通信トークン](chat-transport.md) を利用します。

対応要件：FR-010、FR-011、C-002、C-003、C-005

## 2. 画面・実装

| 画面 / 処理 | ファイル案 | 言語 |
| --- | --- | --- |
| チャット一覧 | `frontend/app/(tabs)/chat.tsx` | TypeScript / TSX |
| 個別チャット | `frontend/app/chat/[id].tsx` | TypeScript / TSX |
| 吹き出し | `frontend/components/ChatBubble.tsx` | TypeScript / TSX |
| 接続状態 | `frontend/hooks/useWebSocket.ts` | TypeScript |
| WebSocket クライアント | `frontend/services/websocket.ts` | TypeScript |
| QUIC / WebTransport クライアント | `frontend/services/quic.ts`（追加推奨） | TypeScript + native module |
| API・履歴 | `frontend/services/api.ts` | TypeScript |
| 接続認証・配送・順序確定 | `backend/internal/chat/websocket.go` | Go |
| 保存・取得・既読 | `backend/internal/chat/handler.go` | Go |

## 3. 利用条件

- `matches.status = accepted` の参加者だけが利用できる。
- ブロックまたは運営停止された場合は送受信を停止する。
- マッチ成立前の自由チャットは提供しない。
- QUIC / WebTransport を使う場合は、`aud = samurai-meet-chat` の Chat Token だけを利用する。
- Refresh Token を WebSocket / QUIC 上へ送信しない。

## 4. WebSocket イベント

### クライアント → サーバー

- `message.send`
- `message.read`
- `typing.start`
- `typing.stop`

### サーバー → クライアント

- `message.created`
- `message.ack`
- `message.read`
- `typing.start`
- `typing.stop`
- `error`

送信メッセージには `client_message_id` を付け、再送されても二重登録しないようにします。

## 5. 切断・再接続

1. 接続切断を UI に表示する。
2. 指数バックオフで再接続する。
3. 再接続成功後、最後に受信したメッセージ ID 以降を REST で取得する。
4. 送信中メッセージは `sending / sent / failed` で表示する。
5. 同じ `client_message_id` はサーバーで冪等に処理する。

## 6. 暗号化

- E2EE を採用する範囲は要確認だが、採用する場合は TypeScript / native crypto でクライアント暗号化する。
- API へは平文本文ではなく暗号化 payload、nonce、key version を送る。
- Go API は配送・権限・保存を担当し、暗号鍵を持たない設計を優先する。
- 暗号化方式、鍵共有、検索・通報時の扱いはセキュリティレビューで確定する。

## 7. API / DB

- `GET /chats`
- `GET /chats/{id}/messages`
- `POST /chats/{id}/messages`
- `POST /chats/{id}/transport-token`
- WebSocket：`wss://samurai-meet.disnana.com/api/v1/ws/chats/{chat_id}`
- QUIC / WebTransport：採用方式決定後に endpoint を確定
- テーブル：`matches`、`messages`、`photos`

## 8. 受け入れ条件

- マッチ成立後だけチャット画面へ入れる。
- 接続中の相手へメッセージがリアルタイム配送される。
- WebSocket 切断後に再接続すると未同期メッセージを取得できる。
- 同じ送信操作を再試行しても二重メッセージにならない。
- 既読状態が相手へ反映される。
- ブロック後は新規メッセージを送受信できない。

## 9. 要確認

- メッセージの保存期間と削除後の監査ログ。
- E2EE の採用範囲と通報時の検査方法。
- 既読を相手へ必ず通知するか。
- タイピング表示、通知、オフライン送信の MVP 対象可否。
