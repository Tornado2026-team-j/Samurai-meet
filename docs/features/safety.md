# 機能仕様：通報・ブロック・安全対応

## 1. 対象

面識のない人同士をつなぐサービスとして、ユーザー、募集カード、メッセージ、写真を通報・遮断できるようにします。

対応要件：FR-014、C-002、C-005

## 2. ユーザー操作

### 通報

- 対象：ユーザー、募集カード、メッセージ、写真
- 理由：迷惑行為、嫌がらせ、なりすまし、不適切画像、危険行為、その他
- 任意コメントを受け付ける。
- 通報後は対象の非表示・ブロックを提案する。

### ブロック

- 対象ユーザーのプロフィール、募集カード、チャット、関心を非表示または拒否する。
- ブロックしたことを相手へ詳細に通知しない。
- 自分のブロック一覧から解除できるかは要確認。

## 3. 実装分担

| 処理 | 言語 / 場所 | 状態 |
| --- | --- | --- |
| 通報・ブロック画面 | TypeScript / TSX | 未 |
| API 入力・対象権限・遮断判定 | Go（`backend/internal/safety`、`backend/internal/httpapi/safety.go`） | 実装済み |
| 本文のAI検査連携（チャット） | Go（`backend/internal/moderation`、`backend/internal/httpapi/chat_moderation.go`） | 実装済み（`POST /chats/{id}/moderate`。Geminiで分類し `warn`/`block` を `reports` へ `source='ai_auto'` で自動登録） |
| 画像の検査連携 | Go + 専用検査サービスの検討 | 未 |
| 運営キュー・状態更新 | Go / 管理画面 | 未（`reports.status`列は用意済み。`source` 列で AI自動分をフィルタ可能） |
| 原票・処理履歴 | PostgreSQL / SQL（`0027_reports.sql`、`0035_reports_source.sql`、既存`blocks`） | `reports` 実装済み、`audit_logs` 未 |

## 4. API / DB

実装済み（すべて Access Token 必須）:

- `POST /reports` — body `{target_type, target_id, reason, comment?}`。`target_type` は `user` / `recruitment_card` / `message` / `photo`、`reason` は `nuisance` / `harassment` / `impersonation` / `inappropriate_photo` / `dangerous` / `other`。`comment` は最大2000。同一通報者×同一対象で未処理の通報がある場合は既存の通報を返す（201）。自分自身・存在しないユーザーの通報は拒否。応答には `source`（`user` / `ai_auto`）を含む。クライアントは `source` を指定できない。
- `POST /chats/{id}/moderate` — チャットのAI不適切検知。body `{text, message_id}`。復号済み平文を Gemini で `abuse` / `sexual` / `money` / `external_contact` / `dangerous_place` / `personal_info` / `coercion` に分類し、`{data:{categories, severity, escalated}}` を返す。`severity` は `none` / `warn` / `block`（`external_contact` / `personal_info` は常に `block`）。`warn` / `block` は `reports`（`target_type='message'`, `reason` はカテゴリから決定, `source='ai_auto'`, `comment` に検知内容）へ自動登録し `escalated=true`。ユーザー単位で1秒1回。参加者以外・存在しないメッセージは404。
- `GET /me/blocks` — 自分がブロックした相手の一覧（`user_id`, `name`, `created_at`）。
- `POST /blocks` — body `{user_id}`。冪等（204）。
- `DELETE /blocks/{user_id}` — 解除（204、未ブロックは404）。

未実装:

- 運営用：`GET /admin/reports`、`PATCH /admin/reports/{id}`
- `audit_logs` テーブルと管理者操作の記録
- ブロック時に既存のpending match・関心を自動で拒否/非表示にする処理（現状は新規の関心送信だけを`matching`が遮断）

## 5. 運営処理

1. 通報を受付し、対象と理由を保存する。
2. 自動で一時非表示にする条件を判定する。
3. 運営者が内容を確認する。
4. 警告、対象コンテンツ削除、ユーザー停止、アカウント削除を実行する。
5. 管理者操作を監査ログに残す。

## 6. セキュリティ・プライバシー

- 通報者の情報を対象者へ不用意に開示しない。
- 通報対象のメッセージ・写真への運営アクセス範囲を定義する。
- E2EE を採用する場合、ユーザーが明示的に通報したデータだけを検査可能にする設計を検討する。
- 緊急時は警察・救急等へ連絡することを UI と利用規約に明記する。
- アカウント停止、復旧、削除の判断と問い合わせ窓口を用意する。

## 7. 受け入れ条件

- ユーザー、カード、メッセージ、写真を通報できる。（API実装済み・`TestSafetyReportAndBlock`）
- ブロック後に相手のカードとチャットが表示されない。（`matching` / `chat` の読み取りが`blocks`を参照。新規関心の遮断はテスト済み。既存match/カード非表示のフロント反映は未）
- 通報が運営キューへ登録される。（`reports`行として登録。運営キューUIは未）
- AIが暴言・差別・性的内容・詐欺・外部誘導などを検知し、怪しい内容は運営確認対象になる。（`POST /chats/{id}/moderate` で `warn`/`block` を `reports.source='ai_auto'` として自動登録。統合テスト `TestChatModerationEscalatesToReportsQueue`。運営キューUIは未）
- 管理者の処理履歴が改ざん困難な監査ログに残る。（未・`audit_logs`）
- 停止ユーザーがトークンを使って業務 API を利用できない。（既存のセッション判定で担保）

## 8. 要確認

- 運営対応時間、緊急通報の連携、SLA。
- 自動モデレーションの導入可否。
- E2EE と通報・法令対応の両立方式。
- ブロック解除、異議申立て、停止期間。
