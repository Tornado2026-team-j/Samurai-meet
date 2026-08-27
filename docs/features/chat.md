# 機能仕様：チャット

## 現在の実装状態

現行のバックエンドはRESTのチャット一覧・暗号文メッセージ送信・履歴・既読と、短命transport tokenの部品を持つ。チャット画面の接続、QUIC／WebTransport／WebSocketによるリアルタイム配送、再接続制御は未実装であり、以下のQUIC項目は将来仕様である。

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
| 接続認証・配送・順序確定（予定） | `backend/internal/chat/quic.go`（未実装） | Go（QUIC配送は未実装） |
| 保存・取得・既読 | `backend/internal/chat/service.go` / `backend/internal/httpapi/chat.go` | Go（REST実装済み） |

## 3. 利用条件

- `matches.status = accepted` の参加者だけが利用できる。
- ブロックまたは運営停止された場合は送受信を停止する。
- マッチ成立前の自由チャットは提供しない。
- 将来のリアルタイム配送は QUIC（HTTP/3 WebTransportを含む）を標準候補とし、`aud = samurai-meet-chat` のChat Tokenだけを利用する。現行はRESTである。
- Refresh Tokenを将来のtransportへ送信しない。

## 4. QUIC ストリームイベント（予定）

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

RESTのメッセージ送信は`accepted`マッチの参加者だけが利用でき、本文ではなくBase64URLのAES-256-GCM暗号文を保存します。`client_message_id`で再送を冪等化し、現行は`sequence` cursorで履歴をポーリングします。サーバーは暗号文を復号しません。

## 8. 受け入れ条件

- マッチ成立後だけチャット画面へ入れる。
- QUIC配送を追加した後、接続中の相手へメッセージがリアルタイム配送される（将来の受入条件）。
- QUIC切断後に再接続すると未同期メッセージを取得できる（将来の受入条件）。
- 同じ送信操作を再試行しても二重メッセージにならない。
- 既読状態が相手へ反映される。
- ブロック後は新規メッセージを送受信できない。

## 9. 要確認

- メッセージの保存期間と削除後の監査ログ。
- E2EE の採用範囲と通報時の検査方法。
- 既読を相手へ必ず通知するか。
- タイピング表示、通知、オフライン送信の MVP 対象可否。
- QUICサーバー実装とExpo実機での再接続負荷・失効確認。QUICが技術的に成立しない場合のWebSocket例外採用は、チーム合意と比較記録を前提とする。
- QUICのパケット損失、0-RTTリプレイ、JWSの期限・世代再利用、メッセージ自動再送の上限とバックオフを確認する。
