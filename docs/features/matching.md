# 機能仕様：募集カード・マッチング

最終更新: 2026-08-27

## 1. 対象

ユーザーが日時、時間帯、キーワード、公開半径を指定した募集カードを公開し、閲覧者の関心をカード所有者が承認したときだけマッチを成立させます。承認後はチャットと会合セッションを別APIで開放します。

現行コードでは募集・検索・関心・承認／辞退のGo APIと、外国人／日本人画面からの募集フロー接続コードが存在します。ただしiOS初期表示で`invalid_recruitment_date`が発生した報告があるため、実機での募集公開完了は未確認です。

対応要件：FR-007、FR-009、C-001、C-003、C-004、C-005

## 2. 募集カード項目

| 項目 | 必須 | 仕様 |
| --- | --- | --- |
| 日時 | Yes | `available_date`。国内利用向けに`Asia/Tokyo`固定の壁時計として扱う |
| 時間帯 | Yes | `start_time` / `end_time` |
| キーワード | Yes | 交流目的、言語、興味分野等。複数可 |
| 公開半径 | Yes | 1 km / 3 km / 5 km の選択式 |
| 位置 | 自動 | 有効な現在地から取得。正確な値は非公開 |
| 有効期限 | 自動 | 時間帯終了後に非表示 |
| 状態 | 自動 | `draft / open / matched / closed / expired` |

## 3. カード状態

```text
card:  draft -> open -> matched
                  ├-> closed
                  └-> expired

match: pending -> accepted -> completed
       └-> cancelled（応募者が取り下げ）
```

- `draft`：未公開。作成者だけが閲覧可能。
- `open`：公開中。公開半径と検索条件を満たすユーザーへ表示。
- `matched`：少なくとも 1 件のマッチが成立。カードを閉じるか期限切れになるまで、追加の関心を受け付ける。カード自体は今回のAPIでは`completed`へ遷移しない。
- `closed`：作成者が停止。
- `expired`：日時または有効期限を過ぎた状態。

## 4. マッチフロー

1. ユーザー A がカードを閲覧する。
2. A が「興味がある」を送る。
3. カード所有者 B が承認する。
4. `matches.status = accepted` となる。
5. チャットを作成または開放する。
6. 交流後、`completed` にして評価を有効にする。

## 5. 実装分担

| 処理 | 言語 / 場所 |
| --- | --- |
| カード入力・プレビュー・状態表示 | TypeScript / TSX |
| 入力値の一次検証・フォーム状態 | TypeScript |
| 状態遷移、重複、期限、権限 | Go |
| 距離・公開条件 | GoのHaversine + PostgreSQL（PostGIS未導入） |
| 永続化 | PostgreSQL / SQL |

## 6. API / DB

- `GET /api/v1/recruitments`
- `GET /api/v1/recruitments/mine`
- `POST /api/v1/recruitments`
- `GET /api/v1/recruitments/{id}`
- `PATCH /api/v1/recruitments/{id}`
- `DELETE /api/v1/recruitments/{id}`（物理削除ではなくclosed化）
- `POST /api/v1/recruitments/{id}/interest`
- `GET /api/v1/matches?role=owner&status=pending&limit=50`
- `GET /api/v1/matches/{id}`
- `POST /api/v1/matches/{id}/accept`
- `POST /api/v1/matches/{id}/reject`
- `POST /api/v1/matches/{id}/withdraw`
- `POST /api/v1/matches/{id}/complete`
- `POST /api/v1/matches/{id}/meeting`
- テーブル：`recruitment_cards`、`matches`、`blocks`

募集カードの公開には名前・国コードが揃ったプロフィールが必要です。作成・更新の成功レスポンスは `{ "data": { ...card } }`、検索は `{ "data": [ ...card ] }` です。カードのレスポンスには正確な緯度・経度を含めず、現在地を使った場合だけ `distance_band`（`within_1_km` / `within_3_km` / `within_5_km`）を返します。

検索条件は `keyword`（複数可）、`available_date`、`start_time`、`end_time`、`radius_km`（1/3/5）、`verified_only`、`latitude`、`longitude`、`limit`（最大50）です。緯度経度を省略した場合は、期限内の `user_locations` を使います。位置がない場合はキーワード・日時検索として扱い、位置による絞り込みは行いません。

現行のPostgreSQLイメージにはPostGISを追加していないため、距離計算はGoのHaversine計算です。座標はDB内だけで扱い、PostGISへの置換は性能改善タスクとして残します。

`timezone`を省略または空にした募集入力は`Asia/Tokyo`へ正規化し、他のtimezoneは拒否します。`created_at`や`expires_at`などの絶対時刻はUTCで扱います。過去時刻・日跨ぎ・端末日時pickerの実機確認は未完了です。

応募者は`pending`中に関心を取り下げられ、matchの状態は`cancelled`になります。取り下げ後の行は履歴と通知の冪等性のため保持します。

## 7. 受け入れ条件

- 必須項目が揃わないカードを公開できない。
- 公開半径は 1 km / 3 km / 5 km のいずれかに限定される。
- 作成者以外がカードを編集・削除できない。
- 同じユーザーが同じカードへ重複して関心を送れない。
- 相互承認前にチャットが開かない。承認後のチャットは`chat_threads`を遅延作成する。
- 期限切れカードへ新たな関心を送れない。
- ブロック関係があるユーザーへカードが表示されない。
- 同じカードへの関心はユーザーごとに一度だけで、重複時は `409 interest_already_sent`。
- カード所有者以外の承認・更新・削除は拒否する。
- フロントエンドは募集公開、募集検索・詳細、関心送信、応募一覧、承認・辞退を上記APIへ接続する。
- 上記フロント接続はコード上の状態であり、iOSの初期日時パースエラー解消後に実機E2Eを完了扱いとする。
- `accepted`前のチャットAPIは存在しない。承認後はRESTの暗号化メッセージ、既読、短命transport tokenを利用できる。

## 8. 要確認

- 通知はアプリ内RESTの一覧・既読・未読管理まで実装済み。OSプッシュ通知は未実装。
- 具体的な待ち合わせ場所をいつ・誰に表示するか。
- 時間帯の変更をマッチ成立後に許可するか。
- QUICによるリアルタイム配送と、会合セッション／距離補助のフロント接続。QUICは未実装の予定である。
