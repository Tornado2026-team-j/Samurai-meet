# iPhone実機E2E手順書（現行実装）

最終更新: 2026-09-01
対象コードコミット: `93d396c1bc38d24537bbce047de8a600682f6438`
判定: **実機未確認のため未完了**

> この手順書の対象は上記コードコミットです。今回の変更はdocsだけで、アプリやサーバーのソースは変更しません。チャット画像・Key B添付、0040互換/0042前方移行、Expo Go SDK54フォールバック、募集/応募の修正は上記コミット群に含まれています。実機ビルドには、対象コードと同じソース状態のコミットを使い、作業中のbackend/frontend差分を混ぜないでください。

2026-09-01時点の`HEAD`は上記の固定対象コードコミットと一致しています。このスナップショットには`917854d2`のmigration recovery、`05189109`のExpo Go SDK54 repair、`93d396c1`の募集・応募・通知の本番導線統一を含みます。今後のコードコミットを対象へ自動的に含めません。実機ビルドに使えるのはこの対象自身、または下記2.1で対象からHEADまでのコミット済み差分が`docs/`だけだと確認できる後続HEADだけです。今回の監査で変更するのはこの2つのdocsファイルだけですが、作業ツリーに別作業のbackend/frontend差分がある場合は実機対象から除外します。

この手順書は、現行の画面・API・サーバー設定を使って、iPhone実機で次の受入確認を行うためのものです。

- 募集作成 → 検索 → 応募 → 承認 → アプリ内通知 → 応募取消
- チャット送信前Moderationと通報・ブロック
- チャット画像の端末内暗号化、Key B端末証明に紐づくX25519鍵envelope、暗号文保存APIと送受信UI
- Key B、HTTP/3 WebTransport、翻訳、認可境界

自動テスト、CI成功、Expo Goで画面が開いたことは、iPhone実機E2EのPASSに置き換えません。各ケースは実機上で操作し、端末・ビルド・API接続先・日時・結果を記録してください。

### 自動検証スナップショット

2026-09-01に対象コード`93d396c1bc38d24537bbce047de8a600682f6438`で確認した自動検証は、`frontend`の`bun test` **135 pass / 0 fail / 414 expect calls** と`bun run typecheck`成功です。これはソース・型・自動テストの証跡であり、iPhone実機、OS通知、公開API、本番データ、native WebTransport、端末間画像復号を確認した証拠ではありません。下表と各ケースの実機判定はこの区別を維持します。

## 0. 判定ルール

| 判定 | 意味 |
| --- | --- |
| `PASS` | 指定したiPhone実機で、期待結果まで確認し、証跡を残した |
| `FAIL` | 実機で期待結果と異なる挙動を確認した |
| `BLOCKED` | 現行クライアントまたは前提環境に機能がなく、手順を実行できない |
| `NOT RUN` | 前提不足などでまだ実行していない |

コードや自動テストが存在しても、iPhone上で実際に期待結果を確認していないケースは`PASS`にしません。特に画像UI・チャットKey B・native WebTransport・OSプッシュ通知は、現時点では実機未確認です。画像Moderationは現行未実装なので、実機確認済みとは記録しません。

## 1. 現行の画面・API・実機ゲート

| 確認対象 | 現行画面・実装 | 主なAPI | 現在の実機判定 |
| --- | --- | --- | --- |
| 募集作成・下書き | `/foreigner` → 「募集を作成」→ `/tabs`。確認画面でカテゴリとキーワード候補を選択 | `POST /api/v1/recruitments/classify`、`POST /api/v1/recruitments`、`GET /api/v1/recruitments/mine` | 実機未確認 |
| 検索・応募 | `/japanese`、`/japanese/filters`、`/japanese/matches/[id]` | `GET /api/v1/recruitments`、`GET /api/v1/recruitments/{id}`、`POST /api/v1/recruitments/{id}/interest` | 実機未確認 |
| 承認・応募結果 | `/foreigner` → 応募カード → `/foreigner/applications/[id]`、応募者は `/japanese/guide-requested` | `GET /api/v1/matches`、`GET /api/v1/matches/{id}`、`POST /api/v1/matches/{id}/accept` または `reject` | 実機未確認 |
| アプリ内通知 | `/foreigner/notifications`、`/japanese/notifications`。通知本文の言語に関係なく構造化IDで遷移 | `GET /api/v1/notifications`、`POST /api/v1/notifications/{id}/read` | 実機未確認。OSプッシュは未実装 |
| 応募取消 | `/japanese/applications` の保留中応募 → 「取り下げる」 | `POST /api/v1/matches/{id}/withdraw` | 承認前のみ。実機未確認 |
| チャット本文 | `/chat` → `/chat/[id]`。送信前にModerationし、許可時だけ暗号化して送信 | `POST /api/v1/chats/{id}/moderation` → `POST /api/v1/chats/{id}/messages` | Expo GoはREST同期。実機Moderation未確認 |
| チャット通報・ブロック | チャット右上の安全メニュー、メッセージ長押し/タップの通報 | `POST /api/v1/reports`、`POST /api/v1/blocks`（body: `user_id`） | 実機未確認。運営キューは未実装 |
| チャット画像 | `/chat/[id]`に画像選択、端末内AES-256-GCM暗号化、参加者デバイスごとのopaque envelope、復号表示・失敗再試行UIがある。サーバーは画像平文・画像鍵を扱わない | `GET /api/v1/chats/{id}/attachment-key-recipients`、`POST /api/v1/chats/{id}/attachments`、`PUT /api/v1/chats/{id}/attachments/{attachment_id}/envelopes`、`GET /api/v1/chats/{id}/attachments/{attachment_id}/envelope`、`GET /api/v1/chats/{id}/attachments/{attachment_id}` | 実機未確認 |
| チャットKey B | Key B端末証明に紐づくX25519合意公開鍵へ、画像のfresh content keyを端末ごとに包む。秘密鍵は端末外へ送らない | 上記recipient/envelope API | 実機未確認。Keychain/Secure Storage・端末移行・相手端末だけの復号は未確認 |
| HTTP/3 WebTransport | `ENABLE_CHAT_WEBTRANSPORT=true`で有効化するサーバー経路。iOS側は`SamuraiMeetWebTransport` native moduleが必要 | `POST /api/v1/chats/{id}/transport-token`、HTTP/3 `CONNECT /api/v1/wt/chats/{id}` | **BLOCKED（現行リポジトリにnative bridgeなし）** |
| チャット翻訳 | 現行画面はローカル辞書による限定表示。`gemini-3.1-flash-lite`のチャット翻訳経路なし | — | **NOT RUN（未実装）** |
| 画像Moderation | 画像ModerationのAPI配線なし。暗号化画像をOpenAIへ送る処理もない | — | **BLOCKED（未実装）** |

根拠となる実装位置は、[フロントエンドREADME](../frontend/README.md)、[バックエンドAPI仕様](../backend/API_SPEC.md)、[チャット通信仕様](features/chat-transport.md)、[現行進捗](進捗.md)、および各画面・サービスのソースです。`backend/API_SPEC.md`に過去のWebSocket表現が残る箇所はありますが、実機確認では対象コードのルーティングと`backend/HANDOFF.md`のWebTransport契約を優先します。

## 2. 前提環境

### 2.1 実機ビルドの対象固定（必須）

実機確認を始める前に、実際に端末へ入れるソースとAPI接続先を固定します。対象コードコミットから`HEAD`までの**コミット済み差分が`docs/`だけ**であり、さらに対象コードコミットから作業ツリーまでの`backend/`・`frontend/`差分（staged、unstaged、未追跡を含む）が空であることを確認します。これにより、固定対象コードそのものとdocsだけの後続コミットのどちらも許可しつつ、対象コードに含まれない作業中のソース差分は実機対象から除外できます。今回の固定対象は`93d396c1bc38d24537bbce047de8a600682f6438`で、更新時点のHEADと一致しています。別作業のbackend/frontend差分が残るcheckoutはこのゲートを満たさず、実機ビルドに使いません。

```powershell
$TargetCommit = '93d396c1bc38d24537bbce047de8a600682f6438'
$HeadCommit = git rev-parse HEAD
git rev-parse --show-toplevel
git status --short --untracked-files=all
git merge-base --is-ancestor $TargetCommit $HeadCommit
if ($LASTEXITCODE -ne 0) { throw 'TargetCommit is not an ancestor of HeadCommit' }

# 対象コードコミットからHEADまでのコミット済み差分。docs/以外があれば不許可。
$HeadDelta = @(git diff --name-only "${TargetCommit}..${HeadCommit}" -- .)
$HeadDelta
$HeadNonDocsDelta = @($HeadDelta | Where-Object { $_ -notlike 'docs/*' })
$HeadNonDocsDelta
if ($HeadNonDocsDelta.Count -ne 0) { throw 'HEAD contains a committed non-docs change' }

# 対象コードから実際の作業ツリーまでのbackend/frontend差分。
# committed、staged、unstaged、未追跡を全て列挙し、最後の出力が空であることを確認する。
$SourceDelta = @(
  git diff --name-only "${TargetCommit}..${HeadCommit}" -- backend frontend
  git diff --name-only -- backend frontend
  git diff --cached --name-only -- backend frontend
  git ls-files --others --exclude-standard -- backend frontend
) | Sort-Object -Unique
$SourceDelta
if ($SourceDelta.Count -ne 0) { throw 'backend/frontend contains a source delta' }
```

次を満たさない場合、ケースは`NOT RUN`または`BLOCKED`として記録し、画面が表示できてもPASSにしません。

- `git merge-base --is-ancestor $TargetCommit $HeadCommit`が成功する。
- `$HeadNonDocsDelta`が空である。`$HeadCommit`は`$TargetCommit`そのもの、または`docs/`だけを含む後続コミットに限る。実機ビルドの証跡には`TargetCommit`と`HeadCommit`の両方を記録する。
- `$SourceDelta`が空である。これは対象コードからのbackend/frontend差分を、コミット済み、staged、unstaged、未追跡の全てについて確認した結果である。何か1つでも出力された作業ツリーは実機対象にしない。
- 実機アプリに埋め込んだ`EXPO_PUBLIC_API_BASE_URL`が、証跡へ記録したAPIホストと一致する。
- 募集詳細のPASSには、対象`GET /api/v1/recruitments/{id}`の成功レスポンスをサーバー側で確認できることを含める。API取得に失敗した場合は、明確なエラー表示と再試行導線になり、モック募集を詳細として表示・応募などの操作対象にしないことを確認する。モックデータが表示されたり、そのデータへ操作できたりした場合はFAILとする。

### 2.2 テストアカウントと端末

専用のテストアカウントを2つ用意します。個人アカウント、実在する住所、Recovery Phrase、Key B、Access/Refresh Tokenは使わず、証跡にも残しません。

- 端末A / アカウントA: 募集者。利用モードを外国人側にする。
- 端末B / アカウントB: 応募者。利用モードを日本人側にする。
- 推奨はiPhone 2台。1台で行う場合は、各フェーズの間にログアウトして再ログインし、アカウントを取り違えない。
- 表示言語（日本語/英語）と利用モードは別設定。プロファイル設定で一方だけを変更し、もう一方が勝手に変わらないことも確認する。
- 実機の日時・地域は日本向けにし、テストデータの募集日時は常に現在のJSTより未来にする。

### 2.3 バックエンド

テスト対象のAPIホストを1つに固定します。本番相当環境で行う場合は、テストデータと専用アカウントを使い、本番の利用者へ通知を出さない運用にしてください。

#### 2.3.1 ローカルE2E用schema

公開`public` schemaの`schema_migrations`に旧`0040_chat_attachment_key_envelopes.sql`を適用したときのchecksumが残っていても、`917854d2`以降のmigration runnerは、0040について監査済みの旧checksumと現行checksumの組み合わせだけを許容し、履歴を変更せず`0042_chat_attachment_key_envelope_primary_key.sql`を前方適用します。したがって、既知の旧状態でchecksum mismatchにより起動が停止し続ける仕様ではありません。一方、その他の不一致は引き続き停止します。適用済みmigration、`schema_migrations`の行、checksumを編集・削除して起動を通してはいけません。

ローカルE2Eでは、公開schemaを修復・上書きせず、テストデータの分離と再現性のため専用の`samurai_meet_e2e` schemaを作成して`DB_SCHEMA`へ指定します。これは公開schemaの既知の旧0040エラーを回避するためではありません。公開schemaを使う場合も、`917854d2`以降の限定checksum互換と0042前方移行に任せ、履歴を直接変更しません。DB接続値はサーバープロセスへexport済みの値、Secret Manager、またはそれらを安全に注入するlauncherから渡します。`.env`に値を置くだけで設定済みとみなさず、パスワードをコマンド・ログへ出しません。

```powershell
# DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD / DB_SSLMODEは
# サーバープロセスへexportまたはSecret Managerから安全に注入済みであること。
# .envに置くだけでは前提を満たさない。値を表示しない。
$env:DB_SCHEMA = 'samurai_meet_e2e'
psql -h $env:DB_HOST -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA IF NOT EXISTS samurai_meet_e2e'
# 別ターミナルで backend から実行する
go run ./cmd/server
```

`DB_SCHEMA`はサーバープロセスへ明示的にexportまたは安全に注入してからサーバーを起動します。このschemaは現行migrationを先頭から適用する空のE2E環境であり、本番データ・本番ユーザー・本番の募集/応募/通知を含みません。ローカルでこの方式により起動したサーバーの`/healthz`・`/readyz`（および`/api/v1/healthz`・`/api/v1/readyz`）は成功を確認済みですが、health/readinessの成功はiPhone実機E2Eや本番データ接続を証明しません。

別ターミナルで次を実行し、4つともHTTP 200になることを確認します。ローカル確認では`/healthz`が`{"status":"ok"}`、`/readyz`が`{"status":"ready"}`を返します。

```powershell
curl.exe --fail --silent --show-error http://127.0.0.1:8080/healthz
curl.exe --fail --silent --show-error http://127.0.0.1:8080/readyz
curl.exe --fail --silent --show-error http://127.0.0.1:8080/api/v1/healthz
curl.exe --fail --silent --show-error http://127.0.0.1:8080/api/v1/readyz
```

サーバーのSecret Manager/環境変数に次を設定します。値は手順書、端末画面、CIログへ書きません。

- `GEMINI_API_KEY`: 募集内容の分類に使うサーバー専用キー。
- `GEMINI_MODEL=gemini-3.1-flash-lite`: 現行の募集分類モデル。
- `OPENAI_API_KEY`: チャット本文の送信前Moderation用サーバー専用キー。未設定時は`moderation_unavailable`となり、クライアントは送信を止める。
- Moderationモデルは現行サーバー実装が`omni-moderation-latest`を使用する。モデル名やキーをクライアントから渡さない。
- `DB_*`と適用済みmigration: 対象DBへ接続でき、起動時migrationが成功すること。
- `IMAGE_STORAGE_DIR`、`IMAGE_MAX_UPLOAD_BYTES`: 暗号文画像APIを検証する場合のみ必要。既定の画像暗号文上限は20MiB。
- WebTransport実機確認を行う別環境では、`ENABLE_CHAT_WEBTRANSPORT=true`、`CHAT_WEBTRANSPORT_UDP_ADDR`、`CHAT_WEBTRANSPORT_TLS_CERT_FILE`、`CHAT_WEBTRANSPORT_TLS_KEY_FILE`、許可するOriginを設定する。これらは現行`.env.example`に全て掲載されていないため、デプロイ担当者が実効値を確認する。

起動後に、秘密値を含めず次を確認します。

対象コードの`backend/internal/httpapi/router.go`は、rootの`/healthz`・`/readyz`と`/api/v1/healthz`・`/api/v1/readyz`を同じhealth/readiness handlerへ登録しています。したがって、次の4つを確認対象にします。

```powershell
curl.exe --fail --silent --show-error https://<API_HOST>/healthz
curl.exe --fail --silent --show-error https://<API_HOST>/readyz
curl.exe --fail --silent --show-error https://<API_HOST>/api/v1/healthz
curl.exe --fail --silent --show-error https://<API_HOST>/api/v1/readyz
```

4つのエンドポイントがすべて成功しない場合はアプリ操作へ進まず、`FAIL`ではなく環境ブロッカーとして記録します。DB migration失敗、既存プロセスによる8080ポート占有、Proxyの502/503も同様です。

### 2.4 フロントエンドとAPI接続先

`frontend`で依存と自動検証を準備します。これは実機PASSの代替ではありません。

```powershell
cd frontend
bun install --frozen-lockfile
bun run typecheck
bun test tests/recruitment.test.ts tests/notifications.test.ts tests/chat.test.ts
```

実機へ配布するビルドには、明示したAPIベースURLを埋め込みます。

- `EXPO_PUBLIC_API_BASE_URL=https://<API_HOST>/api/v1`
- iPhoneから`127.0.0.1`/`localhost`を指定しない。そこはiPhone自身を指す。
- ローカルAPIを使う場合は、同一LANからiPhoneが到達できるIP/HTTPS URLを明示する。
- API接続先を変更したらExpoを再起動し、その環境で再ログインする。セッションは環境間で共有しない。
- Google OAuth / Passkeyを使う場合は、バックエンドのcallback、`WEBAUTHN_RP_ORIGIN`、Google Cloud Consoleの登録Originを同じ環境にそろえる。

ビルド種別の境界は次のとおりです。

- **Expo Go**: RESTの募集・応募・承認・アプリ内通知・テキストModerationの画面確認に使える。チャット画面にはREST同期である旨が表示され、手動の引き下げ更新で同期する。
- **Development Build / Store相当native build**: Passkey、Keychain/Secure Storage、native WebTransportなどの確認に必要。
- 現行リポジトリには`NativeModules.SamuraiMeetWebTransport`を実装したiOS moduleがないため、Development Buildを作るだけではWebTransport PASSにならない。moduleとTLS/UDP公開経路がそろうまで`BLOCKED`のままにする。

### 2.5 端末権限

- ログイン時のGoogle/Passkey操作を完了する。
- 募集作成で現在地・距離を使う場合だけ、位置情報の前景許可を与える。許可できない場合は公開地点名で続行し、距離検索をPASSにしない。
- OSプッシュ通知は現行未実装なので、通知ケースはアプリ内通知画面と手動更新で行う。
- チャットの画像ケースでは、カメラロール権限を許可し、選択した画像が端末内で暗号化されることを確認する。画像Moderationは現行未実装なので、その実行をPASS条件にしない。

## 3. 共通のログインと初期確認

1. 端末A/Bへ同じ対象ビルドをインストールし、対象コミットとAPIホストを記録する。
2. A/Bそれぞれで「Googleで続ける」→Passkey登録/本人確認を完了する。テスト用Passkeyを端末から削除した場合は、同じアカウントの復旧手順を勝手に省略しない。
3. Aは外国人側、Bは日本人側へ利用モードを設定する。
4. 表示言語を最初は日本語にそろえ、後で英語へ変更して同じ通知遷移を再試行する。言語変更だけで利用モードが変わっていないことを確認する。
5. A/Bのプロフィール表示名、国籍、公開自己紹介をテスト用に設定する。応募詳細では構造化された内部プロフィールJSON（`monsterSeed`、`skillTags`等）が表示されず、公開自己紹介だけが見えることを受入条件にする。
6. 端末A/BのアカウントIDは、証跡には末尾4文字などのマスク値だけを残す。

## 4. 募集 → 応募 → 承認 → 通知

### 4.1 端末A: 募集作成とプレビュー

1. `/foreigner`を開き、「募集を作成」をタップする。画面は`/tabs`へ遷移する。
2. 「したいことの説明」に、テスト用の公開内容を入力する。例: `大阪駅の近くでたこ焼きを食べたい`。
3. 公共の待ち合わせ地点名を入力し、候補が出た場合は選択する。自宅や正確な私有地点は入力しない。
4. 募集日、開始時刻、所要時間、募集人数、距離を入力する。日付は現在の`Asia/Tokyo`より未来、終了時刻は同日になるようにする。
5. 「次へ」をタップし、確認画面の読み込みが終わるまで待つ。ここでクライアントから次のリクエストが出ることをサーバー側のリクエストIDなどで確認する。

   - `POST /api/v1/recruitments/classify`
   - bodyは入力した`description`のみ。Geminiキーは端末へ渡さない。
   - 成功データはカテゴリ`Food`/`Places`/`Activity`/`Other`のいずれかと、最大5件のキーワード候補。

6. 確認画面でカテゴリを4択から1つ選び、キーワード候補を必要なものだけ選択/解除する。カテゴリと候補が画面に見え、未選択の候補が勝手に公開データへ入らないことを確認する。
7. 任意の下書き分岐を行う場合は「下書き保存」をタップし、成功表示後に`/recruitments/mine`（プロフィールの「自分の募集を管理」）で下書きが見えること、再編集後もカテゴリ・キーワードが保持されることを確認する。その後、同じ募集を公開する。
8. 「公開する」を1回だけタップする。送信中の連打で重複カードが作られないことを確認する。
9. 公開後、Aの募集管理またはホームで、ステータスが公開中であることを確認する。募集IDをマスクして記録する。

期待API:

```text
POST /api/v1/recruitments/classify  -> 200
POST /api/v1/recruitments            -> 201
GET  /api/v1/recruitments/mine       -> 200
```

### 4.2 端末B: 期間検索と応募

1. `/japanese`を開き、募集一覧が表示されるまで待つ。
2. 来月など日付ストリップに出ていない募集を探す場合は、検索アイコンから「検索条件」を開く。
3. 「募集日（期間）」の「開始日」「終了日」に`YYYY-MM-DD`で未来の期間を入力する。検索期間を1日だけにしたい場合は同じ日付を両方へ入力する。
4. 必要に応じてカテゴリ、時間帯、距離、キーワードを指定し、「この条件で検索」をタップする。来月の募集が期間条件に含まれることを確認する。
5. Aの募集カードをタップし、募集詳細で日付、時間、場所、カテゴリ、キーワードを確認する。
6. 「この人を案内したい！」を1回だけタップする。応募送信中の表示が終わるまで再タップしない。
7. `/japanese/applications`（応募履歴）を開き、対象が`pending`/「審査中」で1件だけ表示されることを確認する。match IDをマスクして記録する。

期待API:

```text
GET  /api/v1/recruitments?available_from=YYYY-MM-DD&available_to=YYYY-MM-DD&...
GET  /api/v1/recruitments/{recruitment_id}
POST /api/v1/recruitments/{recruitment_id}/interest -> 201
GET  /api/v1/matches?role=requester&limit=50
```

同じ応募をもう一度送った場合の`409 interest_already_sent`は重複防止の確認であり、二重応募の成功ではありません。募集期限切れは`recruitment_expired`、ブロック対象は存在を推測できない404相当です。

### 4.3 端末A: 通知から応募詳細を開いて承認

1. Aでホームを下へ引いて再読み込みする、または通知ベルから`/foreigner/notifications`を開く。OSプッシュ通知を期待しない。
2. 「新しい応募」/`New application`が表示され、Bの応募であることを確認する。
3. 通知カードをタップする。既読APIの応答を待たなくても応募詳細へ遷移できることを確認する。
4. `/foreigner/applications/[id]`で、Bの名前・国籍・公開自己紹介を確認する。`{"monsterSeed":...}`、`skillTags`、内部JSON全体、Key B、tokenが画面に出た場合はFAILとする。
5. 「この人を案内役に決定」/`Choose this guide`を1回だけタップする。
6. 応募詳細が「案内役に決定しました」/`Guide chosen`へ変わり、承認ボタンが再実行できないことを確認する。

期待API:

```text
GET  /api/v1/notifications?unread_only=false&limit=50 -> 200
POST /api/v1/notifications/{notification_id}/read   -> 2xx（遷移をブロックしない）
GET  /api/v1/matches/{match_id}                       -> 200
POST /api/v1/matches/{match_id}/accept                -> 200
```

### 4.4 端末B: 承認通知と表示言語の回帰

1. Bで通知画面を開き、`match_confirmed`相当の「案内が決定しました」/`Guide confirmed`を確認する。
2. 通知をタップし、`/japanese/guide-requested`へ遷移する。本文が英語でも日本語でも、通知のタイトル文字列ではなくサーバーの構造化IDで同じ対象へ遷移することが受入条件。
3. プロフィールで表示言語だけを英語へ変更し、利用モードが日本人側のままであることを確認する。通知一覧を開き、英語ラベルと同じ遷移を再確認する。
4. A/Bを逆にしない形で、日本語へ戻して同じ遷移を確認する。言語切り替えの途中で古い利用モード画面へスワイプで戻らないことも記録する。

## 5. 応募取消（承認前の別ケース）

現行APIの応募取消は**保留中の応募だけ**が対象です。承認後に同じmatchを取消すことは現行契約に含まれません。したがって、承認済みケースを取消ケースとして再利用せず、別の募集で行います。

1. Aで、4章とは別の未来日募集を公開する。短いテスト用説明でよい。
2. Bでその募集へ応募し、`/japanese/applications`で`pending`/「審査中」を確認する。Aはまだ承認しない。
3. Bの応募履歴で対象の「取り下げる」/`Withdraw`をタップし、確認ダイアログの「確定」/`Confirm`をタップする。
4. 対象が`cancelled`/「取り下げ済み」になり、同じボタンを連打できないことを確認する。
5. Aの通知画面を更新し、「応募が取り下げられました」/`Application withdrawn`が対象の募集へ紐づいていることを確認する。

期待API:

```text
GET  /api/v1/matches?role=requester&limit=50 -> 200
POST /api/v1/matches/{match_id}/withdraw   -> 200
```

承認済みチャットの安全メニューにある「案内を辞退」は、現行画面でも accepted match用キャンセルAPIが必要と表示される場合があります。これを応募取消のPASSにしないでください。承認後取消が必要なら、API仕様と画面仕様を別途決めてから実装・再テストします。

## 6. チャット本文・Moderation・通報・ブロック

この章は4章の承認済みmatchで行います。`accepted`になる前はチャットAPIを使えません。

### 6.1 許可される本文

1. AまたはBで`/chat`を開き、対象チャットを開く。
2. Expo Goでは「Development Buildが必要」「手動更新を使う」旨のREST同期表示が出ることを確認する。これはWebTransport PASSではない。
3. 入力欄へ、個人情報や外部連絡先を含まないテスト文（例: `駅の改札前で会いましょう。`）を入力して送信する。
4. サーバー側のリクエストログまたはテストプロキシで、次の順序を確認する。本文・tokenをログへ残さない。

   1. `POST /api/v1/chats/{id}/moderation` に送信前の本文を渡す。
   2. `decision=allowed`のときだけ、クライアントで暗号化して`POST /api/v1/chats/{id}/messages`を行う。
   3. 相手側の履歴更新、またはRESTの手動更新で暗号文メッセージを復号表示する。

5. OpenAIの生レスポンス、カテゴリ、score、平文がアプリ画面・通知・DB・通常ログへ出ないことを確認する。Moderationの平文はこの同期判定中だけサーバーが参照する明示的な例外であり、厳密な完全E2EEとは表示しない。

### 6.2 Moderationの実機検証マトリクス

本番の実データを使わず、ステージングの運用承認済みprovider stubまたはテストプロキシで判定結果を固定して実行します。プロキシには本文を保存せず、method・path・status・時刻・相関ID・呼出順だけを証跡へ残します。

| ケース | Moderationの期待値 | `POST /api/v1/chats/{id}/messages` | 画面の期待値 |
| --- | --- | --- | --- |
| allowed | `200`、`decision=allowed` | 1回だけ`201` | 通常どおり送信済み表示 |
| blocked | `200`、`decision=blocked` | **呼ばれない** | 一般化された安全上の理由を表示 |
| unavailable / timeout / 上流5xx | `200`、`decision=unavailable`、`code=moderation_unavailable` | **呼ばれない** | 再試行案内を表示 |
| 未認証・非参加者・pending・ブロック済み | `401`/`403`/`404`/`409`（状態に応じた拒否） | **呼ばれない** | 対象を推測できない拒否表示 |
| 空入力・2,000 Unicode文字超過・不正UTF-8 | `400`相当 | **呼ばれない** | 入力エラー表示 |

1. 端末の操作とテストプロキシの相関IDを対応付け、`/moderation`が先、かつ許可時だけ`/messages`が後になることを確認する。
2. blocked・unavailable・認可拒否では、暗号化処理、`/messages`、通知への本文保存が開始されないことを確認する。
3. OpenAIの生レスポンス、カテゴリ、score、平文がアプリ、DB、通常ログ、エラー本文、URLに現れないことを確認する。
4. リクエスト処理中だけ平文を参照し処理後に保持しないというメモリ上の性質は、iPhone画面だけでは証明できない。HTTP/DB/ログの非保持は実機で確認し、メモリ破棄は対象コードのレビューとバックエンドテストの証跡を別ゲートで添付する。

### 6.3 ブロック・Unavailable・上限

1. **blocked**: ステージングで運用承認済みのModeration blocked fixtureを入力する。実在人物への脅迫や個人情報を手順書へ貼らない。安全判定がblockedになったら、一般化された日本語/英語の理由表示を確認する。
2. blocked時は、画面が暗号化処理と`POST /messages`を開始しないことを、サーバーアクセスログまたはテストプロキシで確認する。blockedでもメッセージが保存された場合はFAIL。
3. **unavailable**: 本番ではなくステージングでOpenAIキー未設定、タイムアウト、または上流5xxを再現し、`decision=unavailable`と再試行案内を確認する。クライアントはfail-closedで暗号化・送信しない。確認後はキーと経路を復元する。
4. 2,000 Unicode文字を超える入力、空入力、通信切断を確認する。平文がエラー本文・URL・ログへ出ないことを確認する。
5. 右上の安全メニューからブロックを実行し、相手が新規メッセージを送れなくなることを確認する。通報は理由（迷惑行為、ハラスメント、なりすまし、不適切な写真、危険、その他）を選び、成功表示を確認する。
6. メッセージの通報では、選択メッセージと前後の会話が運営確認対象になる旨を確認する。ただし現行では運営キュー/管理画面は未実装なので、運営対応完了までをPASSにしない。

期待API:

```text
POST /api/v1/chats/{id}/moderation -> 200
POST /api/v1/chats/{id}/messages   -> allowedの後だけ
POST /api/v1/reports               -> 201
POST /api/v1/blocks               -> 204（body: `{"user_id":"..."}`）
```

対象コードの`blockCollection`はAccess Tokenを要求し、POST bodyの`user_id`を受け付け、ブロック成功時はレスポンスbodyなしのHTTP 204を返します。したがって、このbodyとステータスを実機証跡へ記録します。

### 6.4 翻訳の現状

現行のチャット画面は、復号した各text本文を`POST /api/v1/chats/{id}/translate`へ送り、Geminiに原言語判定と利用者の表示言語（現行対応は日本語/英語）への翻訳を依頼します。クライアント側のローカル言語推測で短絡せず、AIの`source_language`を使って翻訳表示を決めます。初回結果はKey-B由来鍵で暗号化し、メッセージrevision・対象言語とともに保存します。同じ条件では保存済みenvelopeを復号して再利用するため、Geminiを呼び直しません。翻訳表示中に本文下の`Original`をタップすると原文へ戻せます。DB・キュー・監査ログに保存されるのは暗号化envelopeだけで、翻訳本文は保存しません。

実機では、認証済みaccepted chatで日本語本文と英語本文をそれぞれ送受信し、翻訳リクエスト、原言語判定、表示言語への変換、`Original`切替、provider障害時に原文を維持することを確認します。翻訳時の犯罪可能性検知や翻訳結果を用いた運営自動通知は現行要件・実装に含めず、確認済みとは記録しません。実機確認前はこの項目を`NOT RUN`として扱います。

## 7. チャット画像・暗号文保存

### 7.1 現行iPhoneクライアントの判定

現行`frontend/app/chat/[id].tsx`には、画像選択、端末内AES-256-GCM暗号化、添付アップロード、参加者デバイスごとの鍵envelope、添付受信復号、失敗時の再試行UIがあります。これらはコードと自動テストで確認済みですが、iPhone実機での画像選択・権限・送受信・復号・失敗復帰は未確認です。

次を実機で確認できるまで、画像E2Eは`NOT RUN`（前提となる端末確認が未実施）として扱います。native依存やAPI接続不能などで手順自体を実行できない場合は`BLOCKED`にします。

- カメラロールから画像を選ぶ
- クライアントでAES-256-GCM暗号化し、Key B端末証明に紐づくX25519公開鍵へ添付鍵を包む
- 画像を送信・受信し、相手端末だけで復号表示する
- 送信失敗時に平文画像・画像鍵がログやAPI bodyへ出ず、再試行できる

画像Moderationは現行未実装であり、このE2Eで実行した・安全判定できたとは記録しません。EXIF除去も現行の自動/実機証跡に含めず、必要なら別要件として扱います。

### 7.2 バックエンド契約の確認（現行アプリの実機PASSではない）

現行クライアントで実機確認を行う場合は、テスト用画像だけを使います。平文画像、画像鍵、Key B秘密鍵をサーバーやログへ渡さないでください。

対象コードコミットには添付鍵recipient/envelope APIと現行フロントの呼び出しが含まれています。未コミットのbackend/frontend差分を含む状態で画像E2Eを実行せず、2.1の対象固定を通してください。

このバックエンド契約は暗号文の保存・取得境界を確認するもので、画像の内容をModerationする経路ではありません。画像Moderationの実機ケースは現行未実装のため`BLOCKED`です。

1. accepted chatの参加者として、テスト用画像をクライアント内でAES-256-GCM暗号化する。EXIF除去は現行の自動/実機証跡に含めず、必要なら別要件として記録する。
2. raw暗号文を次のエンドポイントへ送る。画像の平文をbodyへ送ってはいけない。

   ```text
   POST /api/v1/chats/{chat_id}/attachments
   X-Chat-Attachment-Content-Type: image/jpeg|image/png|image/webp
   X-Chat-Attachment-Nonce: 12-byte base64url
   X-Chat-Attachment-Algorithm: AES-256-GCM
   X-Chat-Attachment-Key-Version: chat-attachment-e2ee-v1
   body: raw AES-256-GCM ciphertext
   ```

3. `201`レスポンスに`id`、`cipher_sha256`、`nonce`、`algorithm`、`key_version`があり、平文や暗号鍵がないことを確認する。
4. 自分が同じchatへアップロードした未参照添付のIDだけを`POST /messages`の`attachment_id`へ1回関連付ける。別ユーザー、別chat、既に関連付け済みの添付は拒否されることを確認する。
5. accepted/completed chatの参加者としてGETし、レスポンスが`application/octet-stream`、`Cache-Control: private, no-store`、`nosniff`であることを確認する。サーバーは復号しない。
6. 第三者・ブロック後のユーザーでGETし、404相当になることを確認する。添付をmessageへ関連付けないまま約24時間経過させるテスト環境では、孤児スイープで削除されることを確認する。

これはAPIの認可・保存境界の自動/QA確認であり、現行iPhoneアプリの画像送受信E2Eを完了したことにはなりません。実機で相手端末だけの復号まで確認して初めて、そのケースを`PASS`にします。

## 8. Key B・WebTransport（native実機ゲート）

### 8.1 Key B

現行Key Bは端末証明、端末移行、プロフィール画像のenvelopeに加え、チャット画像の端末間鍵envelopeに使われます。チャット本文の共有鍵をKey Bで包む実装とは別です。画像についても、コードや自動テストだけで「iPhone実機のチャットKey B保護済み」と報告しません。

- チャット画像のrecipient APIから参加者のX25519公開鍵を取得できる
- 各端末向けenvelopeを作成し、相手端末の秘密鍵だけで画像鍵をunwrapできる
- 端末移行画面が開く
- Key Bの公開鍵や端末proofがAPIへ送られる

チャット画像のKey B保護は実装・自動検証済みですが、native端末での復号/失敗復帰、端末移行後の既存添付、鍵ローテーション・失効は未確認です。通報・Moderation時の平文例外も別境界であり、画像Moderationが実装済みだとは扱いません。

### 8.2 WebTransport

現行サーバーのリアルタイム経路はHTTP/3 WebTransportです。旧WebSocketへ切り替える手順はありません。native moduleが導入されたビルドでのみ、次を行います。

`CHAT_WEBTRANSPORT_UDP_ADDR`はサーバーのUDP bind addressであり、URLそのものとは限りません。接続先はTLS証明書のホスト名を使った`https://<WEBTRANSPORT_HOST>/api/v1/wt/chats/{chat_id}`とし、UDP bind address・証明書・公開ポートの対応をデプロイ担当者から確認します。

1. iPhoneへDevelopment Buildをインストールし、`SamuraiMeetWebTransport`が実際に含まれていることを確認する。Expo Goで代用しない。
2. accepted chatを開き、次のtoken発行を確認する。

   ```text
   POST /api/v1/chats/{chat_id}/transport-token
   ```

3. native moduleがTLS 1.3/HTTP/3のCONNECTへ、`Authorization: Bearer <短命Chat Token>`をheaderだけで設定していることを確認する。tokenをURL queryやcookieへ入れない。
4. `https://<WEBTRANSPORT_HOST>/api/v1/wt/chats/{chat_id}`へ接続し、証明書検証、UDP到達、Origin/認可を確認する。
5. 別端末からメッセージ、typing、既読を発生させ、`message.created`、`message.read`、`typing`等を受信する。接続が切れたらRESTの`sequence` cursorで欠落を回収する。
6. Wi-Fi/モバイル回線切替、アプリ復帰、token再発行、session revoke、match終了、ブロックを行い、接続が閉じて新tokenで再接続することを確認する。
7. `/api/v1/ws/chats/{id}`へ接続しないこと、旧WebSocketが410になることをサーバー側で確認する。

現行リポジトリにはこのnative moduleがないため、上記1〜7は未実施です。サーバーのGoテストやExpo GoのREST同期表示だけでWebTransport実機PASSを付けません。なお現行画面の本文送信はREST暗号文送信を使い、WebTransportはnative接続がある場合のリアルタイム配送/同期経路です。送信がRESTであること自体をWebSocket fallbackと解釈しません。

## 9. 認可回帰チェック

A/B以外の専用テストアカウントCを使い、存在推測や越権を確認します。CのtokenとIDは証跡に残さないでください。

| 操作 | 期待結果 |
| --- | --- |
| 未認証で募集・通知・match・chatへアクセス | `401` |
| BがAの募集を承認/却下 | `403`または仕様上の権限エラー。状態は変化しない |
| AがBの応募をwithdraw | `403`または`invalid_matching_state`。状態は変化しない |
| pending matchでchat履歴/送信/token | chatなしまたは`chat_not_available`。Moderationへ本文を転送しない |
| CがA/Bのmatch、chat、添付を取得 | 404相当。対象の存在を推測できない |
| completed chatで新規送信/token発行 | 拒否。履歴取得・既読だけ許可 |
| ブロック後の募集、match、chat、添付 | 404相当または仕様の拒否。新規送信不可 |
| blocked/unavailable Moderation | 暗号化と`/messages`を開始しない |

認可を先に行ってからModerationへ平文を渡すことも確認します。権限のないCの入力がOpenAIまたはModeration providerへ届いた場合は重大なFAILとして記録します。

## 10. 証跡テンプレートと完了条件

ケースごとに次をコピーして記録します。token、Recovery Phrase、Key B、平文チャット、個人情報、画像そのものは貼り付けません。

```text
Run ID:
実施日時（JST）:
対象コミット:
iPhone機種 / iOS:
ビルド種別（Expo Go / Development Build / Store相当）:
API base（ホストのみ。tokenなし）:
アカウント（A/B/CのマスクID）:
表示言語 / 利用モード:
ケース:
結果（PASS / FAIL / BLOCKED / NOT RUN）:
期待結果:
実測結果:
関連APIとHTTP結果（request ID等のみ）:
スクリーンショット保存先（秘密情報なし）:
ブロッカー/次の対応:
```

全体を完了と判定できるのは、少なくとも次を満たした場合だけです。

- 2台のiPhone実機で募集→応募→承認→アプリ内通知→案内状況を完走した。
- 承認前の別応募で取消と取り下げ通知を確認した。
- 日本語/英語、外国人側/日本人側の組み合わせで通知遷移が壊れないことを確認した。
- Moderationのallowed / blocked / unavailable / 認可拒否を実機とサーバー証跡で確認した。
- 画像UI、画像暗号化・鍵共有・復号、画像Moderationが実装された場合は、別の画像ケースを実機でPASSにした。
- native WebTransport module、TLS/UDP公開、切断・再接続・token失効を実機でPASSにした。
- Key Bのチャット鍵共有・ローテーションを実装した場合は、相手端末以外で復号できないことを実機で確認した。

このコミット時点では、最後の3項目を含む複数の実機ゲートが未実施/未実装です。よって、この手順書の追加や自動テスト成功だけでリリース完了とはしません。

## 11. 参照ファイル

- [フロントエンド開発・API接続](../frontend/README.md)
- [バックエンド引き継ぎ](../backend/HANDOFF.md)
- [バックエンドAPI仕様](../backend/API_SPEC.md)
- [チャット通信（HTTP/3 WebTransport）](features/chat-transport.md)
- [認証クライアント仕様](features/auth-client.md)
- [現行進捗](進捗.md)
- [サーバー環境変数の例](../backend/.env.example)
