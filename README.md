# Samurai Meet

日本国内で、短い空き時間に近くの日本人・外国人が交流相手を募集し、条件が合えばマッチングするアプリです。正式な実装契約は [docs/README.md](docs/README.md)、Go APIの厳密な契約は [backend/API_SPEC.md](backend/API_SPEC.md) を参照してください。

## 現在の実装状態

| 領域 | 現在の状態 |
| --- | --- |
| 認証 | Google OAuth、Passkey、session/refresh、Web Passkey handoffをGo APIと正式`frontend/`で実装。native Passkeyの実機E2Eは未完了 |
| 鍵・復旧 | v2 client-owned root key、24語Recovery Phrase、端末proof、端末移行APIを実装。native hardware保護、完全な実機復旧、画像bulk再包みは未完了 |
| 募集・マッチング | Go API、外国人/日本人の検索・募集・応募・承認/辞退導線を接続。募集管理・応募履歴・応募取り下げも実装。日時入力の初期パース問題はISO/JST化で解消済みだが、iOS実機の全通しE2Eは未完了 |
| 通知 | 通知の永続化、一覧、未読管理、応募/承認/辞退/暗号化チャット送信イベント、アプリ内通知画面を実装。OSのプッシュ通知は未実装 |
| チャット | acceptedマッチ向けの暗号化REST送信・履歴・既読・短命Chat Token、端末暗号化キャッシュ、最大500件のチャンク表示、本文編集・削除、暗号化添付、AI翻訳を実装。バックエンドはHTTP/3 WebTransportを提供するが、Expo GoはREST同期、native WebTransport moduleと実機E2Eは未完了 |
| プロフィール | 取得・オンボーディング同期・Go更新APIを実装。プロフィール編集画面の完全同期は未完了 |

未完了項目の正本は [実装状態とバックログ](docs/ai/plans/backlog.md) です。仕様上の目標と現在の実装を混同しないでください。

## 接続先

- iPhoneを含むネイティブクライアントの既定値: `https://samurai-meet.disnana.com/api/v1`
- ローカルGo API: `EXPO_PUBLIC_API_BASE_URL` に端末から到達できるURLを明示した場合だけ使用
- ローカル開発の標準例: `http://127.0.0.1:8080/api/v1`（同じPCのWeb確認用）。iPhoneからはLAN URLを明示しない限り本番ドメインを使用

API接続先を切り替えるとセッションとDB環境も切り替わるため、その環境で再ログインします。設定の詳細は [フロントエンド開発](frontend/README.md) と [フロントエンド接続](docs/human/frontend-connection.md) を参照してください。

## チャットModerationの一時確認モード

チャット本文の送信前Moderationは、通常はサーバーの`OPENAI_API_KEY`でOpenAIへ同期判定し、未設定・障害時はfail-closedで送信を止めます。実機確認を止めないため、`CHAT_MODERATION_DEV_FREE_MODE=true`を明示した場合だけ、APIキーの有無にかかわらず外部送信をしない保守的なローカル判定へ切り替わります。

このフラグは`APP_ENV=production`でも明示設定すれば起動できますが、OpenAI Moderationの代替ではありません。起動時に警告を出し、実データを使わない一時確認に限定します。通常の本番運用へ戻す前にフラグを`false`へ戻し、`OPENAI_API_KEY`をSecret Manager等から注入してください。

## チャット履歴の読み込みと端末キャッシュ

チャット詳細画面は、ネイティブ端末に保存した直近の暗号化キャッシュを先に表示し、バックグラウンドでサーバーの最新状態を確認します。キャッシュは端末固有のSecureStore鍵でAES-256-GCM暗号化し、`Paths.cache`へ保存する破棄可能な表示用データです。サーバーや別端末との正本同期には使いません。Webではこのキャッシュ経路を使わず、RESTから取得します。

キャッシュは7日で失効し、保存は最大200件・約2MB、画面表示は最大500件です。メッセージ本文や復号済み位置情報は暗号化キャッシュに含まれますが、画像本体や復号済み画像データは保存しません。チャットの安全メニューから、そのチャットの端末キャッシュと鍵を削除できます。サーバーの更新時刻が変わった場合は編集・削除の取りこぼしを避けるため、`before`カーソルで最新窓を再取得します。過去分は「過去のメッセージを読み込む」操作で上限まで追加します。

## 日時の契約

募集の利用日は日本国内向けに `Asia/Tokyo` 固定です。`available_date` は `YYYY-MM-DD`、`start_time` / `end_time` は24時間制の`HH:mm`で入力し、`timezone` は`Asia/Tokyo`（空の場合もサーバーが同値へ正規化）だけを受け付けます。端末やサーバーのローカルタイムゾーンに依存しません。

DBの期限や監査用の絶対時刻はUTCのRFC3339で保存・返却しますが、募集の日付・時刻として扱う壁時計は常にJSTです。募集は開始時刻まで公開でき、開始まで6時間未満の場合だけ参加者が集まりにくい可能性を注意表示します。この契約は現行コードと自動テストで実装・検証済みです。iOS実機の日時pickerから公開・応募・承認／辞退・通知遷移までの全通しE2Eは未完了です。

## Expo Go / Development Build

Expo SDK 57系で、通常の画面・API接続・Web Passkeyの開発確認はExpo Go 57系を使えます。Expo GoではRecovery Phrase処理がJavaScript互換実装へフォールバックするため、ネイティブ実機ビルドより遅くなることがあります。

同一LAN内でExpoアカウントなしにローカル確認する場合は、`frontend`で `bun run start:offline`（`expo start --offline --lan`）を使います。これは公開配布ではなく、PCと端末が同じネットワークにいる間だけ使える開発用接続です。Expo Goの公開URL／EAS Updateをテスターへ配布する場合はExpoログインが必要になったため、ログインなしの配布にはAndroid APKまたはiOSのTestFlight／Ad Hocビルドを使います。

native Passkey、Secure Enclave/Android Keystore、hardware-backedな鍵保護、ネイティブQUIC transportはExpo Goの対象外です。これらはDevelopment Buildまたはストア相当ビルドと実機で確認します。詳細は [frontend/README.md](frontend/README.md) を参照してください。

## 開発・検証

```powershell
cd backend
go test ./...
go vet ./...
go build ./cmd/server
go run ./cmd/server

cd ../frontend
bun install --frozen-lockfile
bun run start:offline
bun run typecheck
bun run lint
bun test
```

`backend/migrations/*.sql` は適用済みファイルを編集しません。migration runnerは`schema_migrations`へ正規化SQLのSHA-256を記録し、checksum mismatch時は起動を停止します。変更は新しいmigrationとして追加してください。
※コンフリクト注意

## ドキュメントの入口

- [ドキュメント一覧](docs/README.md)
- [人間向けガイド](docs/human/README.md)
- [AI/実装契約](docs/ai/README.md)
- [API仕様](backend/API_SPEC.md)
- [DB仕様](docs/database.md)
- [バックエンドの引き継ぎ](backend/HANDOFF.md)
