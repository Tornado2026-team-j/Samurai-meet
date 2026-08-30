# チャット：Expo実機での再接続／トークン失効・負荷試験 手順書

## 1. 位置づけ

本書は **ローンチ前の QA ゲート** の手順書であり、完了報告ではありません。バックエンドの
WebSocket 配送・heartbeat 失効・`token.renew` ローテーション・送信レート制限は実装済みで、
Go の統合テスト（`internal/integration/chat_ws*_test.go`）で契約を固定しています。本試験は
**実ネットワーク・実機・複数端末**での挙動とタイミングを確認するもので、自動テストの代替では
ありません。

対象トランスポートは現行の WebSocket です（QUIC / WebTransport とネイティブクライアントは
未実装のため対象外）。実機側の操作は手動または Maestro / Detox で自動化します。

## 2. 前提

- **クライアント**: Development Build（Expo Go 不可。再接続・Secure Storage・バックグラウンド
  遷移が本番相当にならないため）。`EXPO_PUBLIC_API_BASE_URL` を staging に向ける。
- **バックエンド**: staging に本番相当構成でデプロイ。1 インスタンス構成（複数インスタンスの
  `LISTEN/NOTIFY` fan-out は未実装）。`APP_ENV`、`CHAT_SEND_BURST` / `CHAT_SEND_REFILL_PER_MINUTE`、
  heartbeat 間隔（既定 20s）を本番想定値に固定し記録する。
- **端末**: 最低 iOS 2 台＋Android 2 台。可能なら device farm で 20〜50 セッション。
  同一ユーザーの複数端末（マルチデバイス配送・`maxConnectionsPerUser=4`）を必ず含める。
- **ネットワーク**: Wi-Fi、LTE/5G、機内モードトグル、Network Link Conditioner（iOS）/
  内部 proxy で遅延・パケットロス・帯域制限を再現。
- **観測**: サーバーの goroutine 数・ヒープ・open FD・p50/p95 配送遅延・切断理由の内訳、
  クライアントのログ（**平文本文・token・Recovery Phrase が出ていないこと**）、クラッシュレポート。

## 3. シナリオと合格基準

| # | シナリオ | 手順 | 合格基準 |
| --- | --- | --- | --- |
| 1 | 定常配送 | N セッションが accepted チャットに接続し、30 分間 1〜3 通/分を相互送信 | 配送 p95 < 2s、ack 欠落率 0、サーバーの goroutine/ヒープが線形増加しない |
| 2 | 再接続ストーム | 全端末を同時に機内モード ON→OFF（15 秒周期×20 回） | 各端末が指数バックオフで再接続、`sequence` cursor で未同期を REST 補完、二重表示なし、再接続成功率 > 99% |
| 3 | 接続維持中のトークンローテーション | Chat Token 期限の 30 秒前に `POST /chats/{id}/transport-token` → `token.renew` を送信、10 分継続 | すべて `token.renewed`（`token_seq` 前進）、切断ゼロ |
| 4 | 未更新での期限切れ | `token.renew` を送らず放置 | 期限後 1 heartbeat 以内に `closing(token_expired)`、クライアントは再取得＋再接続 |
| 5 | セッション失効の伝播 | 別端末から `DELETE /me/sessions/{id}` または `logout-all` | 失効側だけ `closing(forbidden)` を 1 heartbeat 以内に受信、相手側接続は維持、失効後の送信・`transport-token` が 401/403 |
| 6 | マッチ完了 | `POST /matches/{id}/complete` | 両参加者が `closing(chat_not_available)`、以後は履歴・既読のみ可、送信・WS・`transport-token` 不可 |
| 7 | ブロック | 一方が相手をブロック | 送信元は `error(blocked)`→`closing(blocked)`、以後チャットは 404 相当 |
| 8 | 送信レート制限 | 1 端末から上限を超えて連投 | REST は `429 chat_rate_limited`＋`Retry-After`、WS は `error(rate_limited, retry_after_seconds)` で**接続維持**、クライアントは同一 `client_message_id` で `Retry-After` 準拠の自動再送、二重登録なし |
| 9 | 接続数上限 | 同一ユーザーで 5 端末目を接続 | 5 本目が `too_many_connections` で拒否、既存 4 本は影響なし |
| 10 | スロークライアント | 受信側をバックグラウンド／CPU 飽和にして送信を継続 | サーバーが `slow_consumer` で該当ソケットのみ切断、復帰後 REST 補完で全メッセージ取得 |
| 11 | バックグラウンド遷移 | アプリを 5/15/30 分バックグラウンド化後に前面復帰 | OS のソケット切断を検知して再接続＋補完、未読カウント整合 |

## 4. 測定と記録

- **配送遅延**: 送信端末の送信時刻と受信端末の受信時刻を突き合わせて p50/p95/p99。
- **失効伝播時間**: 失効操作から `closing` 受信までの実測（目標: heartbeat 間隔 + 2s 以内）。
- **サーバー安定性**: 試験前後で goroutine 数・ヒープ・open FD が定常に戻ること。リークがあれば
  hub の register/unregister、writePump/heartbeat の goroutine 終了を確認。
- **秘匿情報**: クライアント／サーバーのログ、クラッシュレポート、APM トレースに平文本文・
  Chat Token・Refresh Token・Recovery Phrase が出ていないこと（chat-transport.md §9）。
- 結果は日付・ビルド番号・バックエンド commit・端末構成・ネットワーク条件とともに記録し、
  未達項目はローンチブロッカーとして起票する。

## 5. サーバー側負荷の補助

実機を多数用意できない場合、WebSocket クライアントを Go で多重に張る負荷ハーネスで
サーバー側の容量（goroutine/ヒープ/配送遅延）だけ先行確認できます。ただし実機での
再接続・バックグラウンド・実ネットワークのふるまいは代替できないため、シナリオ 2・11 は
必ず実機で行います。ハーネスは `internal/integration/chat_ws_test.go` の
`dialChat` / フレーム送受信ヘルパーを土台にできます。

## 6. 関連

- 契約とバックエンド実装: [chat-transport.md](chat-transport.md)
- WebSocket フレーム仕様: [chat.md](chat.md) §4
- 既存の自動統合テスト: `TestChatWebSocketDelivery` / `TestChatSendRateLimit` /
  `TestChatWebSocketClosesOnSessionRevoke` / `TestChatWebSocketClosesOnMatchCompletion` /
  `TestChatWebSocketTokenRotation` / `TestChatWebSocketClosesOnTokenExpiryWithoutRotation`
