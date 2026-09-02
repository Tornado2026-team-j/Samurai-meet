# 引き継ぎ

実装を再開する前に [docs/ai/README.md](../docs/ai/README.md)、[現在の実装状態](../docs/ai/system/current-status.md)、[バックログ](../docs/ai/plans/backlog.md)、[ゼロトラスト規約](../docs/ai/security/zero-trust.md) を読むこと。現行コードとこの引き継ぎが食い違う場合は、Go／TypeScriptの実装・テストを確認してからドキュメントを直す。

## 現在の境界（2026-08-27）

- 通常のネイティブAPI Base URLは `https://samurai-meet.disnana.com/api/v1`。`127.0.0.1:8080`やLAN URLへは自動切替しない。別環境は `EXPO_PUBLIC_API_BASE_URL` 等を明示する。
- 募集・マッチングのGo APIと、外国人／日本人画面からの募集フロー接続コードは存在する。日時入力はISO内部値と `Asia/Tokyo` 固定へ統一し、フロント／Goの自動テストで確認済み。募集作成から通知遷移までのiOS実機全通しE2Eは未確認。絶対時刻はUTC。
- 通知はDB永続化、一覧・既読、応募／承認／辞退／暗号化チャット送信のイベント生成、通知画面接続まで。OSプッシュ通知は未実装。
- チャットの唯一のリアルタイム配送経路はHTTP/3 WebTransport（`internal/chat/quic*.go`）です。旧WebSocket実装・Hub・依存は削除済みで、`/api/v1/ws/chats/{id}` は410を返します。RESTの暗号文送信・履歴・既読は同期・復旧経路として残します。
- `POST /api/v1/chats/{id}/transport-token` は省略時・明示時とも `webtransport` だけを発行します。WebTransport listenerはTLS 1.3/UDPとOrigin allowlist、Authorization header token、0-RTT mutation拒否、15秒ごとのtoken/session/match/token世代再検証、PostgreSQL LISTEN/NOTIFYによる複数インスタンスfan-outを提供します。実機native moduleとUDP公開経路は別途E2E確認が必要です。

## 変更時の注意

- 適用済みmigrationは編集しない。runnerは正規化SQLのSHA-256を `schema_migrations` に保存し、checksum mismatchで起動を止める。0040と0044だけは監査済みの旧checksumと現行checksumの組み合わせを限定許容し、後続の0042または0045で前方移行する。DDL変更は新しい番号のmigrationを追加する。
- 作業ツリーには未追跡の `backend/migrations/0026_match_withdrawal.sql` がある。本ドキュメントコミットではmigration本体をステージせず、対応するGoコード・テストと一緒に正式コミットするまで未適用として扱う。
- Expo Goはnative Passkey、hardware-backed storage、native moduleの実機相当検証に使わない。Development Build／ストアビルドの確認を別に行う。
- 秘密値、`.env`、token、Recovery Phraseを表示・commit・ログ出力しない。dirty worktreeでは作業対象以外の差分を保持する。

## 検証コマンド

```powershell
cd backend
go test ./...
go vet ./...
go build ./cmd/server

cd ../frontend
bun run typecheck
bun run lint
bun test
```

最後に `git diff --check` と、コミット対象のパス一覧を確認する。自動テスト成功だけではiOS実機E2E、Expo Go／Development Build差、production domain接続、migration適用済みDBの整合性を証明しない。
