# 機能仕様：チャット通信（HTTP/3 WebTransport）

## 現在の経路

リアルタイム配送の唯一の経路は HTTP/3 WebTransport です。Go API は
`backend/internal/chat/quic_server.go` で UDP/TLS 1.3 を終端します。旧
WebSocket実装、in-process WebSocket Hub、`coder/websocket`依存は削除済みで、
`/api/v1/ws/chats/{id}` は `410 websocket_transport_removed` を返します。

RESTの履歴取得、暗号文送信、既読更新は削除しません。これはリアルタイム接続が
ない場合の同期・明示的復旧経路であり、WebSocketへの自動fallbackではありません。
クライアントは `sequence` cursor によって欠落イベントを同期します。

## 接続契約

1. `POST /api/v1/chats/{id}/transport-token` は `transport=webtransport` だけを発行する。
2. クライアントは `CONNECT /api/v1/wt/chats/{id}` を TLS 1.3/HTTP/3 で開始する。
3. Chat Token は CONNECT の `Authorization: Bearer <token>` だけで渡す。
4. query parameter と cookie の token は受理しない。queryを含むCONNECT自体を拒否する。
5. browser Origin は設定済みallowlistと完全一致させる。native clientにOriginがない場合は
   token/session/match認可で判定する。
6. Expo Go は WebTransport native API を持たない。Development Buildまたは本番native buildが必要。

`github.com/quic-go/quic-go` と `github.com/quic-go/webtransport-go` がサーバーの実装依存です。
native WebTransport module はこのリポジトリにまだ同梱していないため、実機での接続成功は
未検証です。`frontend/services/chat.ts` の connector interface に、TLS証明書検証とCONNECT header
を扱えるnative moduleを接続する必要があります。

## 認可と失効

Chat Token は別audience JWSで、`sub`、`sid`、`chat_id`、`transport=webtransport`、
`token_seq`、期限に束縛します。

- CONNECT時に token、現在のtoken世代、session、accepted match、blockを検証する。
- `message.send`、`message.read`、`typing.start`、`typing.stop` の各state mutationでも
  sessionとaccepted matchを再検証する。
- 接続中も15秒ごとに token期限、token世代、session、accepted matchを再検証し、失効・
  セッション取消・新token発行・match終了時にはsessionをcloseする。
- 0-RTTからのstate mutationは必ず拒否する。1-RTT完了後のみ処理する。
- Refresh Tokenとメッセージ平文はWebTransportへ送らない。

tokenを再発行すると `(session_id, chat_id)` の `token_seq` が増えるため、旧tokenを使う既存接続は
次の監視周期で閉じます。アプリはRESTで新tokenを取得して再接続します。

## イベント配送

WebTransport sessionはチャット単位で接続レジストリへ登録されます。server→clientは
unidirectional streamごとに一つのJSON frameを送ります。

| 方向 | frame |
| --- | --- |
| client → server | `message.send`, `message.read`, `typing.start`, `typing.stop` |
| server → client | `message.created`, `message.ack`, `message.read`, `typing`, `error` |

`message.created`、`message.read`、`typing` は同一プロセスの接続すべてへfan-outします。
複数APIインスタンスではPostgreSQL `LISTEN/NOTIFY` の `chat_events` を介して、別インスタンスの
WebTransport registryにも再配送します。NOTIFYの取りこぼしはREST cursor同期で回収します。

`message.send` は `(chat_id, sender_user_id, client_message_id)` で冪等です。QUICのpacket再送と
アプリ再送を混同せず、アプリ再送は同じ `client_message_id` を使います。送信レート制限はRESTと
WebTransportで共有します。

## 保護範囲と未確認項目

QUIC/TLS 1.3は通信路を暗号化します。保存されるメッセージ本文はアプリが渡す暗号文のみですが、
この実装はKey-Bを共有チャット鍵にしていないため、厳密な参加者間E2EEの証明ではありません。
平文の全自動サーバーモデレーションや翻訳はE2EEと両立しないため、明示的通報証跡のAI確認とは
別の設計判断が必要です。

本番化前には以下を実機Development Buildで確認します。

- native WebTransport moduleのHTTP/3 CONNECT、Authorization header、TLS証明書検証
- UDP 443/設定ポート到達性、Wi-Fi/モバイル回線切替、再接続とREST cursor同期
- token再発行、session revoke、match終了、0-RTT拒否、複数インスタンスfan-out
- 実際のiPhoneでのチャット、募集・応募・通知遷移の回帰
