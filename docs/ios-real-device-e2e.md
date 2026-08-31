# iPhone実機E2E手順書（現行実装）

最終更新: 2026-09-01
対象コードコミット: `ef4ae2096ca88b7e6f354c558492f3948941a607`
判定: **実機未確認のため未完了**

> この手順書の対象は上記コードコミットです。今回の変更はdocsだけで、アプリやサーバーのソースは変更しません。更新時点の作業ツリーには別作業の未コミットソース差分があるため、その作業ツリーを実機ビルドに使わず、対象コードと同じソース状態のクリーンなコミットからビルドしてください。

なお、2026-09-01時点の`HEAD`（`eeec9d468ada63ad33d75f4d32f2a475a1e08142`）は、対象コードコミットから`docs/`以外のコミット済み差分も含むため、このcheckoutのまま実機E2E対象にはしません。下記2.1の判定が成功する対象コードコミット、または`docs/`だけの後続コミットへ切り替えてから実施してください。

この手順書は、現行の画面・API・サーバー設定を使って、iPhone実機で次の受入確認を行うためのものです。

- 募集作成 → 検索 → 応募 → 承認 → アプリ内通知 → 応募取消
- チャット送信前Moderationと通報・ブロック
- チャット画像の暗号文保存APIと、現行クライアントで実行できない範囲
- Key B、HTTP/3 WebTransport、翻訳、認可境界

自動テスト、CI成功、Expo Goで画面が開いたことは、iPhone実機E2EのPASSに置き換えません。各ケースは実機上で操作し、端末・ビルド・API接続先・日時・結果を記録してください。

## 0. 判定ルール

| 判定 | 意味 |
| --- | --- |
| `PASS` | 指定したiPhone実機で、期待結果まで確認し、証跡を残した |
| `FAIL` | 実機で期待結果と異なる挙動を確認した |
| `BLOCKED` | 現行クライアントまたは前提環境に機能がなく、手順を実行できない |
| `NOT RUN` | 前提不足などでまだ実行していない |

`BLOCKED`と`NOT RUN`は完了扱いにしません。特に画像UI、チャットKey B、native WebTransport、OSプッシュ通知は、現時点で実機PASSを付けてはいけません。

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
| チャット画像 | バックエンドの暗号文BLOB APIのみ。現行`/chat/[id]`に画像選択・送信UIなし | `POST /api/v1/chats/{id}/attachments`、`GET /api/v1/chats/{id}/attachments/{attachment_id}` | **BLOCKED** |
| チャットKey B | 現行Key Bは端末証明・プロフィール画像/端末移行用。チャット本文・添付の共有鍵ではない | — | **BLOCKED（未実装）** |
| HTTP/3 WebTransport | `ENABLE_CHAT_WEBTRANSPORT=true`で有効化するサーバー経路。iOS側は`SamuraiMeetWebTransport` native moduleが必要 | `POST /api/v1/chats/{id}/transport-token`、HTTP/3 `CONNECT /api/v1/wt/chats/{id}` | **BLOCKED（現行リポジトリにnative bridgeなし）** |
| チャット翻訳 | 現行画面はローカル辞書による限定表示。サーバーGemini翻訳経路なし | — | **NOT RUN（Gemini翻訳未実装）** |
| 画像Moderation | 画像ModerationのAPI配線なし | — | **BLOCKED（未実装）** |

根拠となる実装位置は、[フロントエンドREADME](../frontend/README.md)、[バックエンドAPI仕様](../backend/API_SPEC.md)、[チャット通信仕様](features/chat-transport.md)、[現行進捗](進捗.md)、および各画面・サービスのソースです。`backend/API_SPEC.md`に過去のWebSocket表現が残る箇所はありますが、実機確認では対象コードのルーティングと`backend/HANDOFF.md`のWebTransport契約を優先します。

## 2. 前提環境

### 2.1 実機ビルドの対象固定（必須）

実機確認を始める前に、実際に端末へ入れるソースとAPI接続先を固定します。対象コードコミットから`HEAD`までの**コミット済み差分が`docs/`だけ**であり、さらに対象コードコミットから作業ツリーまでの`backend/`・`frontend/`差分（staged、unstaged、未追跡を含む）が空であることを確認します。これにより、対象コードコミットそのものとdocsだけの後続コミットのどちらも許可しつつ、作業中のソース差分は実機対象から除外できます。

```powershell
$TargetCommit = 'ef4ae2096ca88b7e6f354c558492f3948941a607'
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
- APIエラー時に募集詳細へモックカードが表示されても成功とみなさない。現行`frontend/app/japanese/matches/[id].tsx`には読み込み失敗時のモックフォールバックがあるため、対象`GET /api/v1/recruitments/{id}`の成功レスポンスをサーバー側で確認できないケースはFAILとする。

### 2.2 テストアカウントと端末

専用のテストアカウントを2つ用意します。個人アカウント、実在する住所、Recovery Phrase、Key B、Access/Refresh Tokenは使わず、証跡にも残しません。

- 端末A / アカウントA: 募集者。利用モードを外国人側にする。
- 端末B / アカウントB: 応募者。利用モードを日本人側にする。
- 推奨はiPhone 2台。1台で行う場合は、各フェーズの間にログアウトして再ログインし、アカウントを取り違えない。
- 表示言語（日本語/英語）と利用モードは別設定。プロファイル設定で一方だけを変更し、もう一方が勝手に変わらないことも確認する。
- 実機の日時・地域は日本向けにし、テストデータの募集日時は常に現在のJSTより未来にする。

### 2.3 バックエンド

テスト対象のAPIホストを1つに固定します。本番相当環境で行う場合は、テストデータと専用アカウントを使い、本番の利用者へ通知を出さない運用にしてください。

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
- チャットの画像ケースでは、カメラロール権限が表示されないこと自体が現行仕様である。画像選択ボタンがない状態をPASSにしない。

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

現行の`frontend/services/chat.ts`の`translateChatText`は限定的なローカル辞書です。`GEMINI_MODEL=gemini-3.1-flash-lite`は募集分類に使われ、チャット翻訳には接続されていません。したがって、チャット翻訳でGeminiの呼び出し、翻訳時の犯罪可能性検知、翻訳結果を用いた運営自動通知が確認できたとは記録しません。これらは別実装後にこの手順書へ再追加します。

## 7. チャット画像・暗号文保存

### 7.1 現行iPhoneクライアントの判定

現行`frontend/app/chat/[id].tsx`には、画像選択、EXIF除去、画像暗号化、添付アップロード、添付受信復号、添付鍵共有のUI/処理がありません。iPhone画面に画像ボタンが見えないことは不具合の実機PASSではなく、現行クライアントの未実装状態です。

このため、次を実行できない間は画像E2Eを`BLOCKED`とします。

- カメラロールから画像を選ぶ
- クライアントでEXIFを除去し、AES-256-GCMで暗号化する
- 添付鍵を相手へ暗号化して渡す
- 画像を送信・受信し、相手端末だけで復号表示する
- OpenAI画像Moderationを通す

### 7.2 バックエンド契約の確認（現行アプリの実機PASSではない）

クライアント実装または承認済みのQA harnessが別途用意された場合だけ、テスト用画像で次を確認します。平文画像、画像鍵、Key Bをサーバーやログへ渡さないでください。

対象コードコミットには添付鍵recipient/envelopeを登録するチャットAPIは含まれていません。作業ツリーに同名の未コミット差分があっても、この手順書の現行APIや実機PASSには含めません。未コミット差分を含む状態で画像E2Eを実行しないでください。

このバックエンド契約は暗号文の保存・取得境界だけを確認するもので、画像の内容をModerationする経路ではありません。画像Moderationの実機ケースは、画像選択UI、端末側の暗号化、サーバー側の安全判定、結果表示が実装されるまで`BLOCKED`です。

1. accepted chatの参加者として、クライアントでEXIFを除去した画像をAES-256-GCM暗号化する。
2. raw暗号文を次のエンドポイントへ送る。画像の平文をbodyへ送ってはいけない。

   ```text
   POST /api/v1/chats/{chat_id}/attachments
   X-Chat-Attachment-Content-Type: image/jpeg|image/png|image/webp
   X-Chat-Attachment-Nonce: 12-byte base64url
   X-Chat-Attachment-Algorithm: AES-256-GCM
   X-Chat-Attachment-Key-Version: approved client version
   body: raw AES-256-GCM ciphertext
   ```

3. `201`レスポンスに`id`、`cipher_sha256`、`nonce`、`algorithm`、`key_version`があり、平文や暗号鍵がないことを確認する。
4. 自分が同じchatへアップロードした未参照添付のIDだけを`POST /messages`の`attachment_id`へ1回関連付ける。別ユーザー、別chat、既に関連付け済みの添付は拒否されることを確認する。
5. accepted/completed chatの参加者としてGETし、レスポンスが`application/octet-stream`、`Cache-Control: private, no-store`、`nosniff`であることを確認する。サーバーは復号しない。
6. 第三者・ブロック後のユーザーでGETし、404相当になることを確認する。添付をmessageへ関連付けないまま約24時間経過させるテスト環境では、孤児スイープで削除されることを確認する。

これはAPIの認可・保存境界の確認であり、現行iPhoneアプリの画像送受信E2Eを完了したことにはなりません。

## 8. Key B・WebTransport（native実機ゲート）

### 8.1 Key B

現行Key Bは端末証明、端末移行、プロフィール画像のenvelopeに使われます。チャット本文の共有鍵はKey Bから合意されず、現行チャットの本文キー導出もチャットIDベースのクライアント実装です。したがって、次を確認しただけで「チャットKey B保護済み」と報告しません。

- プロフィール画像が暗号化されている
- 端末移行画面が開く
- Key Bの公開鍵や署名がAPIへ送られる

チャットでKey Bを使うには、相手の公開鍵への鍵包み、鍵バージョン、ローテーション、失効、通報時の平文例外境界を別途実装・仕様化し、native端末で復号/失敗復帰を確認する必要があります。現行手順では`BLOCKED`です。

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
