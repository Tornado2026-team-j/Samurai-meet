# 機能仕様：チャット

## 現在の実装状態

現行のバックエンドはRESTのチャット一覧・`chat-dek-v1`暗号文メッセージ送信・履歴・既読・本文編集・削除・AI翻訳、短命transport token、および**HTTP/3 WebTransportによるリアルタイム配送**（`backend/internal/chat/quic_server.go`）を持つ。`/api/v1/ws/chats/{id}` は410を返し、WebSocketへfallbackしない。複数APIインスタンス構成は PostgreSQL `LISTEN/NOTIFY` fan-out（`backend/internal/chat/cluster.go`）で対応済み。チャット画面はREST同期、チャットDEK復号、翻訳の`Original`切替、本文編集・削除まで接続済みである。Key-Bは端末proofに限定し、チャットDEKはKey-A由来のアカウントenvelopeまたは端末X25519 envelopeで復旧する。端末移行・Recovery後の再利用はコード接続済みだが、native WebTransportを含む実機2端末E2Eは未確認である。

## 1. 対象

マッチ成立後の 1 対 1 チャットを提供します。テキストを基本とし、写真は [写真仕様](photos.md) で定義します。通信認証は通常の Access Token と分離した [チャット通信トークン](chat-transport.md) を利用します。

対応要件：FR-010、FR-011、C-002、C-003、C-005

## 2. 画面・実装

| 画面 / 処理 | ファイル案 | 言語 |
| --- | --- | --- |
| チャット一覧 | `frontend/app/chat/index.tsx` | TypeScript / TSX |
| 個別チャット | `frontend/app/chat/[id].tsx` | TypeScript / TSX |
| 吹き出し | `frontend/components/ChatBubble.tsx` | TypeScript / TSX |
| 接続状態・同期 | `frontend/app/chat/[id].tsx` / `frontend/services/chat.ts` | TypeScript / TSX |
| WebTransportクライアントbridge | `frontend/services/chat.ts`（native moduleは未同梱） | TypeScript + native module |
| API・履歴 | `frontend/services/chat.ts` / `frontend/services/api-client.ts` | TypeScript |
| 接続認証・配送・順序確定 | `backend/internal/chat/quic.go` / `backend/internal/chat/quic_server.go` | Go（WebTransport配送 実装済み） |
| 複数インスタンス配送 | `backend/internal/chat/cluster.go` | Go（PostgreSQL `LISTEN/NOTIFY` fan-out 実装済み） |
| 旧WebSocket endpoint | `backend/internal/httpapi/chat_ws.go` | Go（410で明示拒否） |
| 保存・取得・既読 | `backend/internal/chat/service.go` / `backend/internal/httpapi/chat.go` | Go（REST実装済み） |
| 写真添付（暗号文BLOB） | `backend/internal/chat/attachment.go` / `backend/internal/httpapi/chat_attachment.go` | Go（REST実装済み。サーバーは鍵を持たない） |

## 3. 利用条件

- 送信・リアルタイム接続は `matches.status = accepted` の参加者だけが利用できる。
- **`matches.status = completed`（マッチ完了後）は REST の履歴閲覧・既読更新のみ**。
  `POST /chats/{id}/messages`、`POST /chats/{id}/transport-token`、WebTransport CONNECT
  （`CONNECT /wt/chats/{id}`）はいずれも `chat_not_available`（HTTP 409）で拒否される。`GET /chats`、
  `GET /chats/{id}/messages`、`POST /chats/{id}/read` は引き続き可能。
- ブロックまたは運営停止された場合は送受信を停止する。
- マッチ成立前の自由チャットは提供しない。
- メッセージ送信はユーザー単位のトークンバケットでレート制限する（REST/WebTransport 共通、`chat.Service` 層で実施）。既定は容量15・補充60/分（`CHAT_SEND_BURST` / `CHAT_SEND_REFILL_PER_MINUTE`）。超過時は REST/WebTransport とも `rate_limited` を返す。
- リアルタイム配送はHTTP/3 WebTransportを使い、`aud = samurai-meet-chat` のChat TokenだけをAuthorization headerで利用する。listenerが無効、またはnative clientがない場合はREST同期へ戻る。
- Refresh Tokenを将来のtransportへ送信しない。

## 4. WebTransport イベント（実装済み）

HTTP/3 WebTransportのリアルタイム配送に、RESTと同じChat Token認可モデルを適用する。

エンドポイント：`CONNECT https://…/api/v1/wt/chats/{chat_id}`。Chat TokenはCONNECTの
`Authorization: Bearer <JWS>` headerだけで渡し、認証フレームやquery/cookie tokenは使いません。

サーバーはChat Token（`aud=samurai-meet-chat`、`chat_id`一致、`transport=webtransport`）とセッション有効性・accepted match・ブロックをCONNECT時に検証します。各state mutationでも再検証し、15秒ごとのwatchdogで期限・session・match・token世代を再検証します。失敗時はerror frameを返してsessionを閉じます。0-RTTのstate mutationは拒否します。

### クライアント → サーバー

| type | フィールド |
| --- | --- |
| `message.send` | `client_message_id`, `ciphertext`, `nonce`, `algorithm`, `key_version`, `content_type` |
| `message.read` | `last_message_sequence` |
| `typing.start` / `typing.stop` | なし |

### サーバー → クライアント

| type | 用途 |
| --- | --- |
| `message.created` | 新規メッセージ。`message` に REST と同じ形の暗号文メッセージ。送信操作を発行したソケット**以外**の、そのチャットの全ソケットへ配送する（相手の端末に加え、送信者自身の他端末も含む） |
| `message.ack` | 自分の送信の確定。送信を発行したソケットにだけ返す。`message`, `duplicate`（再送で既存を返した場合 true） |
| `message.updated` | 送信者が本文を編集した後の暗号文メッセージ。`message`に`edited_at`を含む |
| `message.deleted` | 送信者が削除したメッセージ。`message_id`と`sequence`だけを含み、暗号文は含めない |
| `message.read` | 既読の前進。`user_id`, `last_message_sequence`。既読操作を発行したソケット以外の全ソケットへ配送する（相手の端末＋既読した本人の他端末） |
| `typing` | `user_id`, `state`（`start` / `stop`） |
| `token.renewed` | `token_seq`, `token_expires_at`。`token.renew` 成功時。接続の期限がここまで前進する |
| `error` | `code`, `message`。回復不能な `code`（`blocked` / `chat_not_available` / `forbidden`）の後は `closing` が続く。`rate_limited`（`retry_after_seconds` を伴う）/ `stale_token` / `invalid_token` は一時的で `closing` は続かない |
| `closing` | `reason`。サーバーが接続を閉じる直前に一度だけ送る。`token_expired` は期限までに `token.renew` されなかった場合 |

送信メッセージには `client_message_id` を付け、再送されても二重登録しません（`message.send` は既存の REST `SendMessage` と同じ冪等性）。`message.created` / `message.read` は REST 経由の送信・既読でも接続中の全ソケットへ配送されます。配送の除外はユーザー単位ではなくソケット単位のため、同一ユーザーが複数端末で接続していても、送信・既読を行っていない他端末は更新を受け取れます（`typing` だけは自端末のエコーを避けるためユーザー単位で除外）。

本文編集は送信者だけが `PATCH /chats/{id}/messages/{message_id}` で暗号化payloadを置き換えます。`id`、`sequence`、`client_message_id`、`created_at`は維持し、`edited_at`だけを更新します。削除も送信者だけが行え、`DELETE /chats/{id}/messages/{message_id}` は暗号文・nonceを直ちに消去して履歴から除外し、`chat_message_deletions`へ `user_request` の監査行を追加します。接続中の端末へはそれぞれ `message.updated` / `message.deleted` を配送します。

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

- 新規の本文・位置情報・画像マーカーは `frontend/services/chat.ts` の `chat-dek-v1` で、クライアント生成のランダムなチャットDEKを使って暗号化する。textの新規送信・編集だけはチャットDEK由来のクライアント保持鍵によるHMAC-SHA-256本文commitmentと16byte random saltを付け、location/imageはcommitmentフィールドを送らない。commitment鍵は送信・編集APIへ送らず、翻訳provider経路だけrequest-scopedで送る。チャットIDは公開コンテキストとしてAADに含め、Key-B・Key-A・チャットDEKはAPIへ送信しない。Key-Bは端末proofと端末登録に使うだけで、本文鍵の秘密入力ではない。
- チャットDEKは、利用者ごとにKey-A／`data_salt`から導出したアカウントデータ鍵で包む`chat-account-v1` envelopeと、参加端末のX25519公開鍵で包む`x25519-v1` device envelopeを使う。各envelopeには同じDEKのクライアント検証用`key_commitment`を付け、サーバーはenvelopeの公開メタデータと暗号文だけを保存し、復号や鍵導出はしない。device envelopeの追加登録はmatch ownerが両参加者向けに行え、owner以外は自分のアカウントに属する端末だけを認証済み端末proof付きで登録できる。参加者が相手端末のimmutable rowを先取りできない制約は維持する。旧`chat-mvp-v1` / `chat-keyb-v1`メッセージを含むチャットを開くと、クライアントが履歴表示を止めずにDEK移行をバックグラウンドで試みる。0046だけが適用済みで現端末が既存envelopeを復号できる場合は、ownerが同じenvelopeをcommitment付きで再送してmanifestを作成し、不足端末のenvelopeも追加する。owner以外で自端末向けenvelopeがない場合は移行を保留し、ownerの操作を待つ。旧メッセージの暗号文はサーバーで再暗号化しない。新端末はRecoveryまたは端末移行でKey-Aを復旧した後、自分のアカウントenvelopeを復号でき、別参加者の端末は自端末向けdevice envelopeを復号する。
- 既存の `chat-mvp-v1` と旧 `chat-keyb-v1` はデータを失わないため読み取り互換だけを残す。新規送信・編集は `chat-dek-v1` のみを使い、旧本文をサーバーで再暗号化したり、Key-Bを共有したりしない。旧方式の本文は旧鍵が利用できる端末でのみ表示される。
- チャット初期表示では履歴取得と鍵復旧を分離する。現行`chat-dek-v1`の鍵を復旧できない場合でも、履歴は暗号化フォールバックで表示し、送信だけを停止して再確認ボタンを表示する。保存済みKey-Bがない初期表示では新しい端末proofやDEKを作らず、明示的な端末移行・鍵復旧が必要な状態として表示する。旧形式だけのチャットは既存DEK envelopeを先に読み取り、未作成ならownerによる移行をバックグラウンドで開始する。移行中・再試行待ち・owner待ちを画面に表示し、アプリ終了や通信断の後は、サーバーに残る不変なmanifest/envelopeの状態を次回起動時に再評価する。移行完了を端末のローカルフラグだけで判定せず、既存envelopeがある場合は再作成しない。
- 端末移行・Recoveryはアカウントroot／Key-Aを新端末へ復旧する経路であり、チャットDEK自体を平文で移行しない。新端末でチャットを開いた際に、保存済みアカウントenvelopeをKey-A由来鍵で復号する。新しい参加端末向けには、登録済みX25519公開鍵へ個別envelopeを追加する。厳密E2EEとして扱うには、実機2端末の送受信・Recovery・端末失効時のQA確認が必要である。
- 通常のmessage APIへは平文本文ではなく暗号化 payload、nonce、key version を送る。Go API は配送・権限・保存を担当し、暗号鍵を持たない境界を維持する。Moderationと翻訳providerへのrequest-scoped平文転送は、下記に明記した別の例外である。
- 本文送信前のOpenAI Moderationは例外である。クライアントは暗号化前に本文を`POST /chats/{id}/moderation`へ送り、サーバーは認可済みaccepted参加者の本文だけをOpenAIへ同期転送する。本文とOpenAI生応答はこの処理中だけ参照し、DB、キュー、ログ、監査イベントには保存しない。返すのは`allowed` / `blocked` / `unavailable`だけで、カテゴリやスコアは表示しない。`blocked`、`unavailable`（未設定・timeout・上流障害）、ネットワーク障害、HTTP 4xx/5xxのすべてでfail-closedとし、暗号化・配送を開始せずローカライズ済みの再試行案内を表示する。`CHAT_MODERATION_DEV_FREE_MODE=true`を明示した一時確認では、APP_ENVにかかわらずAPIキーの有無に関係なく外部送信をしないローカル保守的判定を優先する。この判定は高信頼の外部連絡先・個人情報等を拒否するがOpenAIの代替ではない。起動時に警告を出し、実データを使わず、通常の本番運用前に無効化する。
- 自動翻訳は認証済み参加者だけが `POST /chats/{id}/translate` を呼び出し、対象本文をリクエスト処理中だけGeminiへ転送する明示的な平文例外である。新しい`chat-dek-v1` messageでは、クライアントがチャットDEKから導出したrequest-scoped `plaintext_commitment_key`を送り、サーバーはmessageに保存したHMAC-SHA-256本文commitment・salt・現行revisionと`text`を確認する。一致しない申告本文、鍵のないcache miss、bindingのない旧メッセージはGeminiへ渡さない。旧メッセージは既存の暗号化cache hitだけを返し、cache missはbinding unavailableとする。commitment鍵はDB・ログ・レスポンスへ保存しない。Geminiが本文の原言語を判定し、利用者の表示言語へ翻訳する。provider呼び出しはIPではなく認証済みアカウント単位の共有token bucket（既定30回burst／毎分30回）と同時実行数2で制限し、cache hitはprovider枠を消費しない。予約後はmessage行をprovider完了までロックしてrevision・bindingと編集を直列化する。429には`Retry-After`を付け、provider呼び出し中のin-flight markerは短いTTLを更新し続けるため、正常終了・キャンセルでは即時解放され、プロセス異常終了時だけ期限切れで解放される。クライアントは429を自動再試行せず、408/502/503/504だけを限定回数で再試行する。初回結果はクライアントがチャットDEKで暗号化し、メッセージrevision・対象言語とともに`chat_message_translations`へ保存するため、同じrevisionの再表示ではAIを呼び直さない。クライアントは同意済みの場合だけ初期表示の新しい8件を最大2並列で遅延翻訳し、古い本文はタップで翻訳する。サーバーが保持するのは暗号化envelopeだけで、編集・削除・保持期限で関連行も消去する。翻訳結果がある場合は本文下の `Original` タップで原文と切り替え、翻訳失敗時は原文を維持する。
- この送信前平文判定とAI翻訳が有効なため、現行チャットは**完全E2EEではない**。保存・配送がチャットDEK保護の暗号文であることと、送信前に外部AIへ平文を提示することは別の境界である。Key-B、Key-A、チャットDEK、翻訳平文はログ・DBへ保存しない。
- HTTP/3 WebTransport / TLS 1.3が通信路の暗号化・完全性を担い、Chat Token（JWS）がチャット単位の認証・認可・接続管理を担う。JWSの署名を通信路暗号化の代わりにしない。
- 0-RTTでは状態変更を受け付けず、JWSの期限・対象chat・セッション・token世代と`client_message_id`の冪等性でリプレイと重複登録を抑止する。
- 暗号化方式、端末間鍵共有、検索・通報時の扱いはセキュリティレビューで確定する。厳密 E2EE を採用するまでは、現在のチャット暗号を E2EE の証拠として表示・文書化してはならない。

WebTransport/QUICの理由、JWS claimの検証、heartbeat、失敗時の自動再送は [チャット通信トークン仕様](chat-transport.md) に従います。旧WebSocket endpointは再導入せず、`410 websocket_transport_removed`を返します。

## 7. API / DB

- `GET /chats`（`accepted` / `completed`）
- `GET /chats/{id}/messages`（`accepted` / `completed`）
- `POST /chats/{id}/messages`（`accepted` のみ。任意で `attachment_id` を含む）
- `PATCH /chats/{id}/messages/{message_id}`（`accepted` のみ。送信者自身のtext本文を暗号文ごと置換）
- `DELETE /chats/{id}/messages/{message_id}`（`accepted` のみ。送信者自身のメッセージを暗号文消去・監査付きで削除）
- `POST /chats/{id}/moderation`（`accepted` のみ。暗号化前本文の送信前安全判定。本文・生応答は永続化しない）
- `POST /chats/{id}/translate`（`accepted` / `completed`。AIによる言語判定と表示言語への翻訳。cache hit時は暗号化envelopeを返す）
- `PUT /chats/{id}/messages/{message_id}/translations/{target_language}`（`accepted` / `completed`。チャットDEK暗号化済み翻訳envelopeを現行revisionへ保存）
- `GET /chats/{id}/key-recipients`（`accepted` / `completed`。端末proof付きで参加端末のX25519公開鍵を取得）
- `GET /chats/{id}/key-envelope`（`accepted` / `completed`。端末proof付きで自分のアカウント／端末envelopeだけを取得）
- `PUT /chats/{id}/key-envelopes`（`accepted` / `completed`。端末proof付きでクライアント生成のopaque envelopeを追加。既存行は置換しない）
- `POST /chats/{id}/read`（`accepted` / `completed`）
- `POST /chats/{id}/transport-token`（`accepted` のみ）
- `CONNECT /wt/chats/{id}`（`accepted` のみ。HTTP/3 WebTransport、Chat TokenをAuthorization headerで送る）
- `POST /chats/{id}/attachments`（チャット写真の暗号文アップロード。`accepted` のみ）
- `GET /chats/{id}/attachments/{attachment_id}`（チャット写真の暗号文取得。`accepted` / `completed`）
- `POST /matches/{id}/meeting`
- `GET|POST /meetings/{id}/proximity`
- WebTransport endpoint：環境ごとにHTTPS URLとして提供する（`chat_id`単位。UDP/TLS 1.3 listenerが必要）
- テーブル：`matches`、`chat_threads`、`messages`、`chat_message_translations`、`chat_key_envelopes`、`chat_key_manifests`、`chat_read_states`、`chat_token_sequences`、`chat_message_deletions`、`chat_attachments`、`chat_translation_rate_limits`、`chat_translation_inflight`、`photos`

RESTのメッセージ送信・編集・削除・`transport-token`発行・WebTransport接続は`accepted`マッチの参加者だけが利用できます。`completed`マッチは一覧・履歴・既読・翻訳のみで、送信・編集・削除と接続は`chat_not_available`で拒否されます。本文ではなくBase64URLのAES-256-GCM暗号文を保存します。`client_message_id`で再送を冪等化し、WebTransport未接続・再接続直後は`sequence` cursorで`GET /chats/{id}/messages?after=`を使って補完します。サーバーは本文・翻訳・チャットDEKを復号しません。チャットDEKはKey-A由来アカウントenvelopeまたは対象端末向けX25519 envelopeで復旧し、Key-Bは端末proofに限定します。Moderationと翻訳は暗号化前に外部AIへ平文を渡す明示的な例外です。

写真添付は2段階です。まず`POST /chats/{id}/attachments`へAES-256-GCM暗号文をraw bodyでアップロードし（メタは`X-Chat-Attachment-*`ヘッダ）、次に`POST /chats/{id}/messages`の`attachment_id`で1つのメッセージへ結び付けます。参照できるのは同一チャットで自分がアップロードした未参照の添付だけです。`GET /messages`とWebTransportの`message.created` / `message.ack`は、添付付きメッセージに`attachment`オブジェクトを含めます。サーバーは画像鍵を持たず、`nonce` / `algorithm` / `key_version`を不透明メタデータとして保存するだけで、EXIF除去はクライアントの責務です。暗号文上限は`IMAGE_MAX_UPLOAD_BYTES`（既定20MiB）、許可MIMEは`image/jpeg` / `image/png` / `image/webp` / `application/octet-stream`。メッセージから参照されない添付は約24時間後にスイープで削除します。取得は`accepted`/`completed`マッチの参加者のみ、ブロック時は不可です。現行`frontend/app/chat/[id].tsx`は画像選択、端末内暗号化、添付の送受信・復号表示・失敗時再試行まで接続済みです。厳密E2EEとして扱うには、native端末保護、端末失効・鍵ローテーション、実機2端末E2Eを別途確認します。詳細は [写真仕様](photos.md)。

保持期間（既定180日・`CHAT_MESSAGE_RETENTION_DAYS`）を過ぎたメッセージは6時間ごとのスイープで`deleted_at`を打ち、暗号文・nonceと関連する暗号化翻訳envelopeを消去し、`chat_message_deletions`へ監査行を残します。写真添付が結び付いている場合は同じスイープで添付行も`deleted_at`を打ち（取得エンドポイントは即座に404）、次の添付スイープが暗号文BLOBと行を削除します。以後は履歴・未読数・配送のいずれにも現れません。

WebTransportの配送はプロセス内registry（`quic_server.go`）で行い、複数インスタンス構成では PostgreSQL `LISTEN/NOTIFY` fan-out（`cluster.go`）が各インスタンスのWebTransport sessionへ再配送します。NOTIFY のペイロードは `sequence` などの最小情報だけで、受信側が暗号文行を DB から再取得します（8000 byte 上限内）。発行元インスタンスのイベントは自分では再配送しません。NOTIFY 取りこぼし時はクライアントが再接続時に `sequence` cursor で REST 補完します。単一インスタンス運用では `StartClusterFanout` を呼ばなければ NOTIFY を出しません。`LISTEN` 用に専用のプールコネクションを1本占有します。旧WebSocket endpointは410で停止しています。

## 8. 受け入れ条件

- マッチ成立後だけチャット画面へ入れる。
- `completed` マッチではチャット画面は履歴閲覧・既読・翻訳のみ（入力欄を無効化し、WebTransport 接続と `transport-token` 取得を行わない）。
- WebTransport接続中の相手へメッセージがリアルタイム配送される（バックエンド実装済み・統合テスト済み。native clientの実機接続は未確認）。
- WebTransport切断後に再接続すると未同期メッセージを `sequence` cursor で取得できる（REST同期経路と画面の再接続処理を含む。native実機受入は未確認）。
- 同じ送信操作を再試行しても二重メッセージにならない。
- 送信者自身のtext本文を編集でき、`edited_at`と`message.updated`で同じメッセージとして反映される。
- 送信者自身のメッセージを削除でき、暗号文・nonceが消去され、`message.deleted`と削除監査が残る。
- 本文ごとにAIが原言語を判定し、利用者言語へ翻訳できる。翻訳結果はチャットDEK暗号文としてメッセージrevision別に再利用でき、同意済み時は初期表示の範囲だけを遅延取得し、翻訳表示中に`Original`をタップすると原文へ戻せる。失敗した試行は状態を解放し、手動タップで再試行できる。
- チャットDEKをアカウントenvelopeと端末envelopeで復旧でき、Recovery／端末移行後も同じチャット本文を再利用できる。サーバーは暗号文envelopeだけを保存し、Key-B・Key-A・チャットDEKを受け取らない。
- 既読状態が相手へ反映される。
- ブロック後は新規メッセージを送受信できない。
- 送信レート上限を超えると REST は 429、WebTransport は `rate_limited` エラーフレームで拒否し、接続は維持される（統合テスト `TestChatSendRateLimit`）。
- セッション失効・マッチ終了（`completed`/`cancelled`）を heartbeat で検知し `closing` を送って切断する（WebTransportの統合テストで確認）。失効していない相手側の接続は維持される。
- 保持期間を過ぎたメッセージは暗号文が消去され、履歴・未読・配送から除外され、削除監査が残る（統合テスト `TestChatMessageRetentionPurge`）。

## 9. 要確認

- メッセージの保存期間の**具体日数**（実装は完了。既定180日・`CHAT_MESSAGE_RETENTION_DAYS`で調整、期限超過で暗号文消去＋`chat_message_deletions`へ監査。最終日数は運用・法務判断）。
- 厳密 E2EE の鍵ローテーション・端末失効・通報時の検査方法と、Recovery／端末移行／参加者端末の実機E2E確認。現行のチャットDEK共有はopaqueなアカウント／X25519 envelopeで行うが、本文ModerationとAI翻訳は暗号化前の送信時にだけ外部AIへ平文を同期転送する明示的な例外である。平文・生応答は永続化せず、翻訳結果はチャットDEK暗号文envelopeだけを保存する。
- 既読を相手へ必ず通知するか。
- タイピング表示、通知、オフライン送信の MVP 対象可否。
- Expo実機での再接続負荷・失効確認は [chat-load-test.md](chat-load-test.md) の手順書で実施する（ローンチ前QAゲート。バックエンドのWebTransport配送・失効・token更新は実装済み・統合テスト済み）。
- 複数APIインスタンス構成の本番導入時期と、`LISTEN/NOTIFY` fan-out の負荷確認。
- native WebTransport導入時のパケット損失、0-RTTリプレイ、JWSの期限・世代再利用、メッセージ自動再送の上限とバックオフの実機確認。
