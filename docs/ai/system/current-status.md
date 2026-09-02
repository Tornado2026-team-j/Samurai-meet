# 実装状態の境界

最終確認: 2026-08-30

この文書は現行コードを正とする。仕様書に「予定」と書かれたものは、コードとテストで確認できるまで実装済みとして扱わない。詳細なHTTP契約は [backend/API_SPEC.md](../../../backend/API_SPEC.md) を参照する。

## 現在実装されている範囲

- Google OAuth、pre-auth、Passkey、session/refresh、Web Passkey handoff、v2 client-owned root-key envelope、端末Key-B proof、暗号文画像API、退会API。
- Go APIのプロフィール取得・更新、募集カードの作成・検索・更新・終了、関心・承認・辞退・完了、位置保存、acceptedマッチ向けRESTチャット部品、会合・距離補助API。
- 募集・マッチングの外国人／日本人画面からAPIを呼ぶ実装、募集管理・応募履歴・応募取り下げ、表示言語に依存しない通知遷移が存在する。日時入力はISO内部値と `Asia/Tokyo` 固定へ更新し、自動テストで確認済み。表示言語と利用モードは別の保存設定で、2026-08-29にiPhone上の表示言語即時切替を確認した。募集作成から通知遷移・応募取消・ログアウト後の戻る操作までを同一手順で確認するiOS実機全通しE2Eは未確認である。
- 通知のDB永続化、一覧・既読API、応募／承認／辞退／暗号化チャット送信に伴う通知生成、外国人／日本人の通知画面・未読バッジ。
- 通知は現時点でアプリ内REST通知であり、`expo-notifications`等によるOSプッシュ通知は未実装。
- チャットは暗号文のREST送信・履歴取得・既読更新・短命transport token発行に加え、HTTP/3 WebTransportによるリアルタイム配送（マルチデバイス整合、送信レート制限、heartbeat失効、複数インスタンス向け`LISTEN/NOTIFY` fan-out）と、保持期間スイープ（既定180日・`deleted_at`実配線・暗号文消去・`chat_message_deletions`監査）、チャット写真の暗号文BLOB添付をバックエンド実装済み。メッセージ編集・削除（`PATCH/DELETE /api/v1/chats/{id}/messages/{message_id}`）と、AIによる原言語判定を含む表示言語翻訳（`POST /api/v1/chats/{id}/translate`）も実装済み。新規本文はランダムなチャットDEKの`chat-dek-v1`で暗号化し、DEKはKey-A由来のaccount envelopeまたは端末X25519 device envelopeから復旧する。翻訳結果はクライアントがチャットDEKで暗号化してメッセージrevisionごとに保存し、同じ条件では再利用し、編集・削除・保持期限で消去する。Key-Bは端末proofに限定し、既存`chat-mvp-v1`／旧`chat-keyb-v1`は読み取り互換だけを残す。Recovery／端末移行後のaccount envelope復旧は実装済みだが、実機2端末E2E・端末失効・鍵ローテーションは未確認である。Moderationと翻訳は暗号化前に外部AIへ平文を同期転送する明示的な例外で、平文・生応答は永続化しない。既読の `last_message_sequence` はハイウォーターマーク方式（最新liveへクランプ・前進のみ）。transport tokenが発行する`transport`は`webtransport`のみで、WebTransport listenerが無効な環境ではREST同期を使う。チャット画面のREST同期、チャットDEK復号、翻訳の`Original`切替、本文編集・削除UIは接続済みだが、native WebTransport実機E2Eは未確認。保持日数の最終確定は運用・法務判断。
- 募集の利用日・壁時計は現在 `Asia/Tokyo` 固定で正規化する方針。DB/APIの絶対時刻はUTCとして扱う。

## 未完了・本番承認不可

- iOS募集画面の初期日時パース問題はISO内部値／JST固定化で修正し、自動テストを完了した。日時picker、過去時刻、日跨ぎ、公開・応募・通知遷移の実機E2Eは完了していない。
- native Passkey、Secure Enclave／Android Keystore、画像画面統合、削除reconciler、legacy画像移行、プロフィール編集UIとの完全同期、会合画面を完了していない。チャットのaccount／device envelope、Recovery／端末移行経路は接続済みだが、実機2端末E2E、端末失効・鍵ローテーションは未完了である。
- WebTransport配送・heartbeat失効・0-RTT mutation拒否はバックエンド実装済み・単体テスト済み。native WebTransportクライアントの実機接続、UDP公開、実機での再接続・負荷試験は手順書（`docs/features/chat-load-test.md`）に沿った確認が未実施である。
- OSプッシュ通知、本人確認、評価、監査ログ、PostGIS化は未実装または未確定である。通報登録・ブロックAPIは実装済みで、通報対象のオブジェクト認可も対象種別ごとに検証する（運営キューは未）。レート制限はIPベースHTTPとチャット送信のユーザー単位を実装済み。

## 既知の実装不整合

現時点で未解消の重大な実装不整合はない。`POST /api/v1/chats/{id}/transport-token` のHTTP handler既定値とサービス受理値は `webtransport` で一致し、WebTransport listenerが有効な環境だけがHTTP/3 realtime接続を提供する。`/api/v1/ws/chats/{id}` は410を返し、WebSocketへfallbackしない。nativeクライアントと本番UDP経路は実機E2Eの承認待ちである。

## 接続先・Expo実行環境

- ネイティブアプリの通常のAPI Base URLは `https://samurai-meet.disnana.com/api/v1`。LANの `127.0.0.1:8080` や開発ホストへ自動切替はしない。別環境を使う場合だけ `EXPO_PUBLIC_API_BASE_URL` 等を明示する。
- Expo Goではnative Passkey、hardware-backed storage、その他native moduleを含む本番相当の確認はできない。Expo Goで動くJSフォールバックと、Development Build／ストアビルドでのみ動くnative経路を分けて検証する。

## Migration

起動時runnerは `backend/migrations/*.sql` を順に正規化してSHA-256 checksumを `schema_migrations` に記録し、PostgreSQL advisory lockで直列化する。適用済みSQLを編集してchecksum mismatchを回避してはいけない。変更は新しい番号のmigrationとして追加する。

0040と0044は監査済みの旧checksumと現行checksumの組み合わせだけを限定許容し、0042または0045で前方移行する。0044先行版の平文翻訳キャッシュは0045で削除し、チャットDEK暗号化キャッシュへ切り替える。

## 認証・URL境界

- Web PasskeyのURL fragmentへ渡すのは短命の `bootstrap_token` だけで、Access Token、Refresh Token、pre-auth tokenは渡さない。
- CORS、OAuth callback、WebAuthn Origin／RP IDは環境設定された完全一致のOriginを使う。秘密値・token・Recovery Phraseをログやドキュメント例へ記載しない。
