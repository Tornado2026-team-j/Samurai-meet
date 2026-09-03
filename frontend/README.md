# フロントエンド開発

Samurai Meet の Expo / React Native クライアントです。パッケージマネージャーは **Bun 1.3.3** に固定します。npm、Yarn、pnpm で lockfile を作成・更新しないでください。

## 初回セットアップ

```powershell
cd frontend
bun install --frozen-lockfile
```

`bun.lock` は必ずコミットします。依存更新は `bun update` またはDependabotのPRで行い、lockfileだけを手編集しません。

## Expo Goとの互換性

このフロントエンドは、Expo Go 57系で開発確認できるよう **Expo SDK 57系** に揃えています。Expo SDKを更新する場合は、先にExpo Goの対応SDKを確認してください。Expo Goに含まれないネイティブモジュールを確認する場合は、Development Buildを用意します。

Expoアカウントなしでローカル確認する場合は、PCと端末を同じLANへ接続し、`bun run start:offline`（`expo start --offline --lan`）を実行してQRコードを読み取ります。これはリモートのテスト配布ではありません。Expo Goの公開URL／EAS Updateはログインが必要なため、ログインなしで配布する場合はAndroid APKまたはiOSのTestFlight／Ad Hocビルドを使います。

Recovery PhraseのArgon2idは、Development Build / ストアビルドでは`react-native-libsodium`のネイティブ実装を使います。Expo GoとWebでは同じ`memory_kib=32768`、`iterations=3`、`parallelism=1`のパラメータでJS実装へフォールバックします。したがって、Expo Go上での速度はネイティブ実機ビルドの速度にはなりません。iOS実機で高速化を確認する場合は、ネイティブモジュールを含むDevelopment Buildを作成してください。

## 開発・検証

```powershell
bun run start
bun run typecheck
bun run lint
bun run test
bun run security:audit
```

CIでは品質検査と`bun run security:audit`を並列実行し、Bunのダウンロードキャッシュを `bun.lock` のハッシュで再利用します。最後にPRコメントとGitHub Actions Summaryへ集約結果を出します。横断のSecurity checks、CodeQL、Google OSV Scannerも同じPRで実行されます。

`bun audit` の未承認・期限切れ脆弱性はCIを失敗として扱います。修正版が未公開で到達不能なものだけは `scripts/verify-audit.ts` と `osv-scanner.toml` の両方に、理由・影響範囲・失効日を記録した期限付き例外を置けます。例外の期限を延長する場合は、上流の修正版と到達可能性を再調査してPRレビューを必須とします。

## Issue #1の認証導線

- `app/(auth)/login.tsx` と `register.tsx` からGoogle OAuthを開始し、Passkey完了後に通常sessionへ進みます。
- OAuth / Passkey handoff verifierはSecure Storageへ保存し、deep linkの一回限りコードと交換します。
- Access Tokenはメモリだけに置き、Secure Storageにはuser/session IDとRefresh Tokenだけを保存します。アプリ起動時とフォアグラウンド復帰時はsingle-flightでRefreshします。
- Refresh失敗、session handoff失敗、ログアウト時は一時verifierとsession情報を削除します。通信結果が不明なRefreshでは同じrequest IDを保持して再試行できます。
- Expo GoではWeb Passkeyをアプリ内ブラウザで実行します。pre-auth tokenやAccess TokenをURL queryへ置かず、Passkey用fragmentまたは短命なsession handoffだけを使います。

APIの開発上書きは `.env` の `EXPO_PUBLIC_API_BASE_URL` で指定できます。未指定時は、Expo Webを `http://localhost` または `http://127.0.0.1` で開いた場合だけ `http://127.0.0.1:8080/api/v1` を使い、それ以外（iPhoneのExpo Goを含む）は `https://samurai-meet.disnana.com/api/v1` に接続します。ローカルGo APIへ接続する場合は、端末から到達できるURLを明示してください。Web Passkeyページは同じGoバックエンドの`/passkey`を開くため、明示的にAPIを上書きする場合は`EXPO_PUBLIC_WEB_APP_ORIGIN`も同じ開発環境に合わせてください。

デスクトップのローカル確認例:

```powershell
$env:EXPO_PUBLIC_API_BASE_URL="http://127.0.0.1:8080/api/v1"
$env:EXPO_PUBLIC_WEB_APP_ORIGIN="http://localhost:8081"
```

バックエンドを同じPCで起動する場合は、Go側にも`APP_ENV=development`、`DEV_CLIENT_ORIGIN=http://localhost:8081`、`WEBAUTHN_RP_ID=localhost`、`WEBAUTHN_RP_ORIGIN=http://localhost:8081`、`GOOGLE_REDIRECT_URI=http://localhost:8080/auth/callback`を設定します。Google Cloud Consoleにも同じcallbackを登録してください。`APP_ENV`だけを変更しても、`.env`に残った本番callbackや本番DB接続先は切り替わりません。

iPhoneのExpo GoからローカルGo APIを確認する場合だけ、`EXPO_PUBLIC_API_BASE_URL`へiPhoneから到達できるURL（例: `http://192.168.11.16:8080/api/v1`）を明示してください。通常は本番APIドメインへ接続します。API接続先を切り替えた場合、セッションはサーバー環境ごとに別なので、その環境で再ログインします。Google OAuthをトンネルで完結させる場合は、Go側のcallbackとGoogle Cloud Consoleの登録値も同じ公開Originに揃え、環境変数を変更した後はExpoを再起動してください。

## チャットの現行境界

`app/chat/[id].tsx` は暗号化RESTの履歴・送信・既読、画像添付、本文編集・削除、チャットDEK復号、翻訳と`Original`切替に接続済みです。バックエンドのリアルタイム経路はHTTP/3 WebTransportですが、Expo Goにはnative WebTransport APIがないため、Expo GoではREST同期を使います。native bridgeを含むDevelopment Buildと2端末の実機E2Eは別ゲートです。

チャット詳細はネイティブ端末の`Paths.cache`に保存した直近履歴を先に表示し、サーバーを正本としてバックグラウンド同期します。端末固有のSecureStore鍵でAES-256-GCM暗号化し、TTLは7日、保存上限は200メッセージ／約2MB、画面表示上限は500メッセージです。画像本体や復号済み画像データはキャッシュせず、キャッシュはサーバー障害時の表示継続用であり送信・既読・認可の根拠にはしません。安全メニューのキャッシュ削除から、対象チャットのファイルと鍵を消去できます。

初回またはキャッシュが古い場合は、チャット概要の`last_message_sequence`を使い、`before`カーソルで最新窓を最大100件ずつ取得します。サーバーの`updated_at`がキャッシュと一致する場合だけ履歴取得を省略し、編集・削除を含む更新があった場合は最大500件の最新窓を再同期します。過去分の追加は利用者の明示操作に限定し、WebTransportの再接続・取りこぼし回収には既存の`after`カーソルを使います。

本文送信前の安全確認はバックエンドのModeration APIを先に呼び、`allowed`のときだけ暗号化して送信します。OpenAIキー未設定時は通常送信不可です。テスト環境でサーバーの`CHAT_MODERATION_DEV_FREE_MODE=true`を明示した場合だけ、外部送信をしないローカル保守的判定が使われます。アプリ側はこの設定を持たず、実データを使った確認には利用しません。

募集フローは、プロフィール同期後に募集を公開し、別ユーザーが現在地・キーワードで検索して関心を送り、募集者が応募一覧から承認または辞退できます。現在地を使う場合は`expo-location`の前景位置情報許可が必要です。許可しなくてもキーワード検索と募集公開は継続できますが、距離による絞り込みは行われません。

募集の利用日は日本国内向けに`Asia/Tokyo`へ固定しています。`available_date`は`YYYY-MM-DD`、`start_time` / `end_time`は24時間制の`HH:mm`で扱い、APIへ送る`timezone`も`Asia/Tokyo`です。DBの期限などの絶対時刻はUTC RFC3339ですが、募集の日付・時刻は端末や実行ホストのローカルタイムゾーンへ変換しません。

OSのプッシュ通知は未実装で、現在の通知機能はGo APIの一覧・既読とアプリ内通知画面です。以前iOSで報告された募集画面の初期日時パース問題はISO内部値／`Asia/Tokyo`固定化と自動テストで解消済みですが、募集公開から応募・通知遷移までの実機全通し確認は未完了です。

詳細な受入手順は [docs/features/auth-client.md](../docs/features/auth-client.md) を参照してください。
