# バックエンド残タスク

このファイルは互換入口です。唯一の最新バックログは [docs/ai/plans/backlog.md](../docs/ai/plans/backlog.md) です。

検証専用の `expo-test` と `dev-client` は廃止しました。新しいクライアント検証は `frontend/` のテストと実機E2Eで行います。

## チャット機能 引き継ぎメモ（2026-08-27）

### 現在の前提

- 作業ブランチは `kazumatcho`。
- チャット（`docs/features/chat.md`）は`matches.status=accepted`の参加者だけが使える設計だが、そのマッチ成立を永続化する`matches`テーブル自体が存在しなかった。フロントの「JAMES BROWN」等は`frontend/mocks/matches.ts`のモックで、実データではない。
- `docs/features/matching.md`の設計（募集カードへの関心→カード所有者が承認）に合わせ、フェーズ0として`recruitment_cards`（最小構成）・`matches`・`blocks`を追加した（`backend/migrations/0019_matching.sql`、`backend/internal/matching`、`backend/internal/httpapi/matching.go`）。設計の詳細は[docs/database.md](../docs/database.md) 6章。
- キーワード・距離検索、PostGIS、カード編集・削除、`draft`公開ワークフロー、`matches/{id}/complete`、通報（`reports`）は未実装。1枚のカードにつき成立は1件までという暫定判断をしている（`matching.md` 8章の要確認事項）。
- 実DBでの`TestMatchingLifecycle`（`backend/internal/integration/integration_test.go`）は既存の統合テストと同じく`TEST_POSTGRES=1`環境でのみ実行され、未設定なら自動でスキップされる（Docker必須ではない。既存のPostgreSQLインストールでも、CIのようにGitHub Actionsのサービスコンテナでも可）。この作業をした際は手元にPostgreSQLが無かったので一時的にDockerコンテナで検証し、確認後に削除した。`go build`/`go vet`/`go test ./...`（`TestMatchingLifecycle`含む）は実DB上でPASS済み。

### 未完了タスク（チャット本体、フェーズ1以降）

1. **`messages`テーブルとチャットREST API**
   - migrationで`messages(id, match_id, sender_user_id, body, client_message_id, server_seq, created_at, read_at)`を追加する。
   - `backend/internal/chat`にService、`backend/internal/httpapi`にハンドラを実装する。`GET /chats`、`GET /chats/{id}/messages`、`POST /chats/{id}/messages`、`POST /chats/{id}/transport-token`。
   - アクセス制御は`matching.Service.IsMatched` / `ListAcceptedMatches`と`blocks`を使う。

2. **WebSocketサーバー**
   - `wss://.../api/v1/ws/chats/{chat_id}`。Chat Token（`aud=samurai-meet-chat`、既存の`auth.Signer`を別audienceでもう1インスタンス生成すれば流用可能）で接続認証する。
   - `message.send` / `message.read` / `typing.start` / `typing.stop`と`message.created` / `message.ack` / `message.read` / `error`。`client_message_id`で冪等化する。
   - 詳細仕様は`docs/features/chat.md`、`docs/features/chat-transport.md`。

3. **フロントエンド接続**
   - `frontend/services/websocket.ts`、`frontend/hooks/useWebSocket.ts`は空ファイル。チャット画面（`app/chat/[id].tsx`等）も未作成。バックエンドのAPI/WS契約が固まってから着手する。

### 再開時の順序

1. `git status --short --branch` で未コミット差分を確認する。
2. 可能ならDocker Desktopを起動し、`TEST_POSTGRES=1`で`go test ./...`（`TestMatchingLifecycle`含む）を一度実DBで確認する。
3. 上記「未完了タスク」の1から順に着手する。実装ごとに`backend/API_SPEC.md`、`backend/STATUS.md`、`backend/TODO.md`、`docs/database.md`、該当する`docs/features/*.md`を同じ変更で更新する。

## Recovery Key / 端末Key-B 引き継ぎメモ（2026-08-26）

### 現在の前提

- 作業ブランチは `codex/fix-passkey-web-routing`。Recovery Key再生成の変更はこのブランチにあり、PR・デプロイ前。
- PR #17 は `main` ← `frontend_matching` で、`frontend/app/index.tsx` を変更している。こちらの認証・暗号鍵変更も同ファイルを変更するため、PR化前に `origin/frontend_matching` を取り込み、競合解消後の統合結果を検証する。
- 既存のRecovery Keyは一回限りの秘密値としてサーバーへ送らない。端末内でKey-Aを復元する非常用鍵であり、Key-Aを変更せず新しいRecovery Key用envelopeへローテーションする。
- `kdf_params.data_salt` はRecovery Keyローテーションでは維持する。新しいRecovery Keyではsalt・nonce・暗号文を更新するため、既存画像の暗号文は再暗号化しない。
- Key-Bは端末内Secure Storageの32byte秘密鍵。サーバーには公開鍵と`device_id`だけを登録する。`backend/migrations/0012_key_b_materials.sql` のテーブルは現行の登録・復旧処理では使用していない。

### 未完了タスク

1. **Recovery Key復旧後のローテーションを完成させる**
   - 旧Recovery KeyでKey-Aを復元する。
   - 新しいRecovery Keyとenvelopeを端末内で生成する。
   - ユーザーが新しい鍵を保存したことを確認してから`PUT /api/v1/me/key-envelopes/{key_version}`で保存する。
   - 画面離脱・通信失敗時はpending materialを保持し、次回起動時に同じ新鍵を再表示する。保存成功後だけpending情報を削除する。
   - 受け入れ条件: 旧Recovery Keyで復旧でき、新Recovery KeyでKey-Aを復元でき、`data_salt`が変わらず、旧Recovery Keyでは新envelopeを復元できない。

2. **Key-Bを失った端末の再登録UIを追加する**
   - Passkey再認証（直近5分）を完了した後に、プロフィール画面から「この端末のKey-Bを再登録」を実行できるようにする。
   - 端末内で新しいKey-Bと新しい`device_id`を生成し、`POST /api/v1/me/devices`へ公開鍵だけを送る。Key-B平文はAPI・DB・ログへ送らない。
   - 再登録後は新端末用の画像鍵envelopeを作成できることを表示する。Key-Bがない状態を「再認証してください」だけで終わらせない。
   - 受け入れ条件: 旧Key-BがなくてもPasskey再認証後に再登録でき、旧`device_id`と公開鍵を上書きせず、新`device_id`で画像を取得できる。

3. **機種変更フローを明示して検証する**
   - 新端末では「同期済みPasskey」または「Recovery Keyで復旧」から新Passkeyを登録し、新Key-Bを生成する。旧Key-Bを引き継がない。
   - 画像取得時、端末用envelopeがない場合はKey-Aで`account_wrapped_image_key`を開き、新Key-B用に再ラップして保存する。現在は遅延再ラップ方式なので、全画像を一括移行する必要があるか判断する。
   - 旧端末の一覧・個別失効API/UIを追加する。機種変更完了時に旧端末を残すか、ユーザーが明示的に失効できるようにする。
   - 受け入れ条件: 新端末で既存画像を復号でき、旧端末のKey-Bでは新端末用envelopeを取得できず、端末失効後は画像APIの端末署名が拒否される。

4. **Passkey表示名を仕様化する**
   - 現在のWebAuthn `user.name` / `user.displayName` はGoogle表示名、メールアドレス、`Samurai Meet`の順で決まり、プロフィール入力名や端末名ではない。
   - Passkeyごとの表示名・端末名を保存する項目はない。OSがcredential IDを表示する場合があるため、アカウント表示名と端末名をどう見せるか決める。
   - 受け入れ条件: 登録画面・OS側に期待する表示名を実機（iOS/Android/Web）で確認し、既存credentialの表示が変わらないことも説明する。

5. **API/UI・実機E2Eを追加する**
   - Recovery Key: 正しい鍵、誤った鍵、5回超過、通信失敗、画面離脱後の再開、再生成後の旧鍵拒否。
   - Key-B: 初回登録、Secure Storage消失、機種変更、再登録、端末失効、画像の遅延再ラップ。
   - 認証境界: Access Tokenだけ、期限切れPasskey再認証、別ユーザーの`device_id`、API直叩きでの回避を拒否する。

### 再開時の順序

1. `git status --short --branch` と `git diff --name-only` で未コミット差分を確認する。
2. PR #17の `origin/frontend_matching` を取得し、現在ブランチへ統合して `frontend/app/index.tsx` の競合を解消する。強制push・無断でのPR #17ブランチ上書きはしない。
3. `bun run typecheck`、`bun run lint`、`bun test`、`go test -count=1 ./...`、`git diff --check` を実行する。PostgreSQL統合テストは開発DBの`DB_SCHEMA`等を設定して実行する。
4. `backend/TODO.md`を含め、意図したファイルだけをステージして差分を確認してから日本語コミットを作る。
5. 通常push後、SourceTreeの`tp-li-dev`アカウントでPR #17との関係（既存PR更新か、別PR作成か）を確認し、重複差分を含めない。
