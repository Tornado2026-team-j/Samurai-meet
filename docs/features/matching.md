# 機能仕様：募集カード・マッチング

## 1. 対象

ユーザーが日時、時間帯、キーワード、公開半径を指定した募集カードを公開し、双方の関心が一致したときだけチャットを開放します。

対応要件：FR-007、FR-009、C-001、C-003、C-004、C-005

## 2. 募集カード項目

| 項目 | 必須 | 仕様 |
| --- | --- | --- |
| 日時 | Yes | `available_date`。タイムゾーンを保存 |
| 時間帯 | Yes | `start_time` / `end_time` |
| キーワード | Yes | 交流目的、言語、興味分野等。複数可 |
| 公開半径 | Yes | 1 km / 3 km / 5 km の選択式 |
| 位置 | 自動 | 有効な現在地から取得。正確な値は非公開 |
| 有効期限 | 自動 | 時間帯終了後に非表示 |
| 状態 | 自動 | `draft / open / matched / closed / expired` |

## 3. カード状態

```text
draft -> open -> matched -> completed
          ├-> closed
          └-> expired
```

- `draft`：未公開。作成者だけが閲覧可能。
- `open`：公開中。公開半径と検索条件を満たすユーザーへ表示。
- `matched`：少なくとも 1 件のマッチが成立。新規関心を受け付けるかは要確認。
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
| 距離・公開条件 | Go + SQL / PostGIS |
| 永続化 | PostgreSQL / SQL |

## 6. API / DB

- `GET /recruitments`
- `POST /recruitments`
- `GET /recruitments/{id}`
- `PATCH /recruitments/{id}`
- `DELETE /recruitments/{id}`
- `POST /recruitments/{id}/interest`
- `POST /matches/{id}/accept`
- `POST /matches/{id}/complete`
- テーブル：`recruitment_cards`、`matches`、`blocks`

## 7. 受け入れ条件

- 必須項目が揃わないカードを公開できない。
- 公開半径は 1 km / 3 km / 5 km のいずれかに限定される。
- 作成者以外がカードを編集・削除できない。
- 同じユーザーが同じカードへ重複して関心を送れない。
- 相互承認前にチャットが開かない。
- 期限切れカードへ新たな関心を送れない。
- ブロック関係があるユーザーへカードが表示されない。

## 8. 要確認

- カード所有者が承認する方式か、双方の「いいね」で自動成立する方式か。
- 1 枚のカードに許可するマッチ数。
- マッチ成立後にカードを非公開にするか。
- 具体的な待ち合わせ場所をいつ・誰に表示するか。
- 時間帯の変更をマッチ成立後に許可するか。
