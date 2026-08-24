# 実装バックログ（コード基準）

```mermaid
flowchart TD
  KMS[Key-B: KMS・rotation・audit] --> Image[端末画像暗号化]
  Image --> Delete[削除reconciler・監査]
  Native[Native Passkey・app links] --> Business[プロフィール・募集・マッチ]
  Delete --> Business
  Business --> Chat[別audienceのChat token]
```

| 優先 | 項目 | 依存 | 完了定義 |
| --- | --- | --- | --- |
| P0 | Web Passkeyの正式frontend化 | Web hosting | `WEB_PASSKEY_URL` に本番UI、短命ceremony token、実機E2E |
| P0 | Key-B KMS/rotation/audit | Secret Manager/KMS | wrap鍵が環境平文でなく、取得・rotation・失敗を監査しfail closed |
| P0 | 再認証tokenをURLから除去 | session handoff API | fragmentのAccess Tokenを用途限定one-time tokenへ置換しテスト |
| P1 | client画像暗号化 | Key-A/Key-B HKDF | 端末でdata key生成・AES-GCM・wrap、サーバーは暗号文のみ |
| P1 | 削除reconciler | DB/ストレージ | 孤児検出、冪等ジョブ、監査、バックアップ期限の運用 |
| P1 | native Passkey実機 | app links | Associated Domains/assetlinks、登録・別端末・解除を確認 |
| P2 | 認証統合テスト拡張 | PostgreSQL | handoff/reuse/challenge/rotationの実DB並行ケース |
| P2 | 業務API | profile schema | プロフィール→募集→マッチ→block/report の順で所有権・監査・rate limitを実装 |
| P3 | Chat transport | 業務API | Access/Refreshと別audience、0-RTT変更禁止、heartbeat失効 |

各項目は実装前に脅威、API契約、migration、observability、rollback、E2E受入条件をPR本文へ記載する。
