# 機能仕様：チャット通信トークン（QUIC / WebTransport）

## 1. 位置づけ

QUIC は通信路のプロトコルであり、アプリケーションの認証・認可そのものではありません。QUIC / HTTP/3 の暗号化通信上で、チャット専用の短命トークンを別途検証します。

QUIC は TLS 1.3 を使って通信を保護しますが、チャット参加者かどうか、対象チャットにアクセスできるか、セッションが失効していないかは Go API 側で判定します。詳細は [RFC 9001](https://www.rfc-editor.org/rfc/rfc9001) と [RFC 9114](https://www.rfc-editor.org/rfc/rfc9114) を参照します。

## 2. 推奨するトークン分離

| トークン | 対象 | 暫定有効期間 | 発行経路 |
| --- | --- | --- | --- |
| Access Token | REST API、通常のセッション | 1 分（案）。残り 30 秒で切替 | Google + Passkey 成功後、または Refresh |
| Chat Token | WebSocket / WebTransport のチャット接続 | Access Token の切替とは独立した2分の短命 token | 有効な Access Token で REST API を呼び出す |
| Refresh Token | Access Token の更新 | 30 日アイドル / 90 日絶対 | QUIC 上では使用しない |

Access Token の 1 分期限と、Refresh 時に旧 Access Token を `exp` まで許可する切替処理は、[認証機能仕様](auth.md) と [API 仕様書](../api.md) に定義します。Chat Token の期限・切替はこの Access Token 更新とは別に決定します。

## 3. Chat Token claims（案）

Chat Token は JWS 署名付き JWT とします。

```json
{
  "iss": "samurai-meet-api",
  "aud": "samurai-meet-chat",
  "sub": "user-uuid",
  "sid": "session-uuid",
  "chat_id": "match-uuid",
  "jti": "chat-token-uuid",
  "transport": "websocket",
  "iat": 1724414400,
  "exp": 1724414460
}
```

- `aud` は `samurai-meet-chat` に限定する。
- `chat_id` は一つのマッチに限定する。
- Chat TokenはRESTのAccess Tokenとして扱わず、対象chat transportの接続開始だけに使う。
- `sid` で `sessions` と紐付け、セッション失効を反映する。
- `token_seq` による更新順序管理はWebSocket配送実装時に追加する。
- Token を URL の query string に含めない。HTTP/3 なら認証ヘッダー、独自 QUIC なら認証 handshake frame を使う。

## 4. 発行 API（REST実装済み）

### `POST /chats/{chat_id}/transport-token`

通常の Access Token で呼び出します。Go API は次を確認してから Chat Token を発行します。

- Access Token の署名・期限・DB セッションが有効
- `matches.status = accepted`
- 呼び出しユーザーがマッチ参加者
- ブロック・停止・通報による遮断状態がない
- 対象チャットが削除・終了されていない

Response（現行）：

```json
{
  "data": {
    "chat_token": "short-lived-chat-jwt",
    "expires_at": "2026-08-23T12:01:00Z",
    "transport": "websocket"
  }
}
```

Chat Token は Refresh Token で更新しません。期限前に、通常の REST API で次の Chat Token を取得します。現行APIは`websocket`または`webtransport`を受け付け、tokenに対象chat、session、transportを束縛します。

## 5. Chat Token の切り替え（WebSocket配送実装時に追加）

Chat Token を更新する場合も短い重複期間と `token_seq` を利用できますが、これは Access Token の Refresh Token ローテーションとは別の処理です。

- Chat Token の期限前に次の token を取得する。
- 切り替え中は旧 token と新 token に 10〜15 秒程度の重複期間を持たせる。
- `token_seq`や接続単位の巻き戻し防止はWebSocket/WebTransport実装時に追加する。
- Refresh Token は Chat Token の切り替えには使わない。
- 期限切れを待ってから更新せず、通信中の token が有効な間に切り替える。

## 6. QUIC 接続の失効確認

- 接続開始時に Chat Token、`sid`、`chat_id`、`matches`、`blocks`、ユーザー状態を確認する。
- 接続中は 15〜30 秒ごとの heartbeat で `sessions.revoked_at` とチャット状態を確認する。
- ログアウト、端末失効、ブロック、アカウント停止を検知したら、接続を閉じる。
- PostgreSQL の複数 API インスタンスでは `LISTEN / NOTIFY` を追加できる。
- Chat Token だけでは新しいチャット接続を無制限に作れないよう、ユーザー・チャット単位の接続数制限を設ける。

## 7. 0-RTT の扱い

QUIC の 0-RTT アプリケーションデータは攻撃者に再送される可能性があります。そのため、1-RTT handshake が完了するまで次の操作を受け付けません。

- メッセージ送信
- 既読更新
- 写真送信
- 評価、ブロック、通報などの状態変更

0-RTT を利用する場合も、再送されても影響がない接続開始・能力確認だけに限定します。通常のチャット操作は 1-RTT 後に行います。

## 8. 実装分担

| 処理 | 実装 |
| --- | --- |
| Chat Token 取得、切り替え、期限管理 | TypeScript / React Native（未接続） |
| QUIC / WebTransport クライアント | TypeScript + native module。Expo の対応状況を PoC で確認 |
| Chat Token 発行・検証 | Go（REST発行と署名検証を実装済み） |
| QUIC / HTTP/3 サーバー | Go。採用ライブラリを PoC で決定 |
| 参加者・セッション・ブロック判定 | Go + PostgreSQL |
| 失効通知 | PostgreSQL `LISTEN / NOTIFY` または heartbeat / polling |

Expo の標準機能だけで QUIC / WebTransport クライアントが利用できない場合は、MVP では既存の WebSocket を使い、同じ Chat Token の認可モデルを適用します。

## 9. 受け入れ条件

- 通常の Access Token で Chat Token を取得できる。
- Chat Token をプロフィール、Recovery、Key-B、他のチャットへ利用できない。
- 期限前に次の Chat Token をRESTで取得できる。
- WebSocket配送追加時に古いtokenの接続巻き戻しを拒否する。
- セッション失効、ブロック、マッチ終了後にチャット接続が閉じる。
- 0-RTT でメッセージ送信などの状態変更ができない。
- Chat Token、Refresh Token が URL、ログ、クラッシュレポートに出ない。

## 10. 未決事項

- QUIC を直接使うか、HTTP/3 上の WebTransport / WebSocket を使うか。
- Expo Managed Workflow で利用できる native module とビルド方式。
- Chat Token の期限、切り替え間隔、重複期間の負荷試験。Access Token の 1 分 Refresh とは別に決定する。
- `token_seq` を接続単位で管理するか、ユーザー・チャット単位で管理するか。
- QUIC 経路が利用できない場合の WebSocket フォールバック。
