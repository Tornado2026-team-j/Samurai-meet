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
を扱えるnative moduleを接続する必要があります。WebSocket fallbackはこの契約に追加しません。

## iOS Development Build の調査結果（2026-08-31）

### 判定

今回の変更は、ビルド不能なスタブを追加せず、native module の導入条件と制約をこの文書に固定する
docs-onlyとします。現在のExpoプロジェクトはCNG（`ios/`ディレクトリを同梱しない構成）です。
Expoの[公式ドキュメント](https://docs.expo.dev/workflow/customizing/)では、この構成で単一アプリ用の
native codeを追加する場合はlocal Expo moduleを作成し、prebuildでnativeプロジェクトへリンクする
流れになっています。

しかし、Appleの標準APIだけでは現在のbridge契約を満たす最小実装になりません。

- [`URLSession`](https://developer.apple.com/documentation/foundation/urlsession) はHTTP/3を
  扱えますが、WebTransportのsession、unidirectional/bidirectional stream、datagramを公開する
  APIではありません。
- [`NWProtocolQUIC`](https://developer.apple.com/documentation/network/nwprotocolquic) はQUIC上の
  custom protocolを実装するためのAPIです。HTTP/3とWebTransportのセッション層を別途実装する
  必要があり、今回のnative module候補を数ファイルで成立させる代替にはなりません。
- WebKitはSafari 26.4でJavaScriptのWebTransport APIを提供しています（[`WebKitの変更点`](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/)）。
  これはWKWebView／ブラウザのJavaScript APIであり、HermesのReact Native runtimeに
  `NativeModules.SamuraiMeetWebTransport`として提供されるAPIではありません。WKWebViewを
  経由する場合は、別のWebView transport、認証引き渡し、イベント寿命管理を設計する必要が
  あるため、現在のnative bridgeの実装にはなりません。

`frontend/services/chat.ts` が要求する `connect({url, headers:{Authorization}})` を満たすには、
CONNECT requestにBearer tokenをheaderとして設定できる、TLS証明書検証付きのHTTP/3 WebTransport
実装が必要です。tokenをqueryやcookieへ移す方法は、上記の接続契約により禁止されています。

### 調査した外部native候補

候補としてmoq-devの[`web-transport-ffi`](https://github.com/moq-dev/web-transport) v0.1.2
（[`公開リリース`](https://github.com/moq-dev/web-transport/releases/tag/web-transport-ffi-v0.1.2)）を
確認しました。UniFFI経由でSwiftへWebTransportのsession／stream／datagramを公開し、iOS向けの
XCFrameworkも配布されています。

ただし、公開されているFFIの`Client.connect`はURLだけを受け取るAPIで、CONNECT requestの
任意headerを受け取る引数がありません。`ClientConfig`にもrequest headerの設定はありません。
そのため現行サーバーの`Authorization: Bearer <token>`契約を満たせず、この依存をそのまま
Expo moduleへ組み込むことはできません。必要な外部変更は次のいずれかです。

1. upstreamがCONNECT headersを公開したリリースを採用する。
2. forkでheaders対応を追加し、UniFFI生成物とSwift APIを固定したうえで利用する。

さらに、Swift wrapperはGitHub Releaseのpackage artifactを介してXCFrameworkを取得する形で、
アプリへそのまま追加できる小さなSwift Packageではありません。採用時はバイナリを社内／CIで
検証可能なartifactとして固定し、依存元・ライセンス・checksumをレビューします。現時点で確認
したXCFrameworkのchecksumは以下です。

```text
asset: WebTransportFFI.xcframework.zip
release: web-transport-ffi-v0.1.2
sha256: 65e33f05ec645c1e50c1322e77ffe8869139bc67c9684cdec189f299e85f4c9d
```

### 最小の代替と次の実装条件

native moduleが利用できないiOSでは、既存のHTTPS RESTによる履歴取得・暗号文送信・既読更新と
`sequence` cursor同期を使います。RESTはHTTP/3で接続可能な経路を維持する同期・復旧手段であり、
WebSocket fallbackではありません。WebTransportが使えないことを理由にtokenをquery／cookieへ
移したり、WebSocketを再導入したりしません。

実際のnative実装へ進む条件は以下です。

1. CONNECT headersを設定できる外部WebTransport実装を、上記のようにversion／checksum固定する。
2. local Expo module（`SamuraiMeetWebTransport`）を追加し、既存bridgeの`connect`、`close`、
   `samuraiMeetWebTransportFrame`、`samuraiMeetWebTransportClose`契約を変更せず接続する。
3. 本番証明書を通常検証し、`no_cert_verification`相当の設定をDevelopment Buildにも持ち込まない。
4. 実機Development BuildでHTTP/3 CONNECT、Authorization header、stream frame、切断、再接続、
   REST cursor回収を確認する。Windows上のTypeScript／Goテストだけではこのゲートを通過した
   ことにしない。

今回の作業環境にはXcodeとiOS Development Build実行環境がないため、native build／iPhone実機
E2Eは未実施です。したがって、native WebTransportが実機で利用可能になったとは判定しません。

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

QUIC/TLS 1.3は通信路を暗号化します。保存されるメッセージ本文はアプリが渡す暗号文のみで、
現行のチャット本文はランダムなchat DEKをKey-A由来のaccount envelopeと端末X25519のdevice
envelopeで参加端末へ渡します。平文の全自動サーバーモデレーションや翻訳はE2EEと両立しないため、
厳密な参加者間E2EEとして扱うには、これらの平文例外と端末失効・鍵ローテーションを別途確定する
必要があります。

本番化前には以下を実機Development Buildで確認します。

- native WebTransport moduleのHTTP/3 CONNECT、Authorization header、TLS証明書検証
- UDP 443/設定ポート到達性、Wi-Fi/モバイル回線切替、再接続とREST cursor同期
- token再発行、session revoke、match終了、0-RTT拒否、複数インスタンスfan-out
- 実際のiPhoneでのチャット、募集・応募・通知遷移の回帰
