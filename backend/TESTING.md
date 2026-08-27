# テスト

```powershell
cd backend
go test ./...
go test -count=1 ./internal/matching
go vet ./...
go build ./cmd/server
python tests/frontend_smoke_test.py

cd ../frontend
bun run typecheck
bun run lint
bun test
```

`frontend_smoke_test.py` はUIテストではなく、起動済みGo APIのhealth/ready確認です。`internal/matching`のテストはJST固定の日時正規化、期限、距離・検索条件のサービス挙動を確認します。

募集の利用日・壁時計は`Asia/Tokyo`、DB/APIの絶対時刻はUTCとして扱うため、iOSの日時picker、過去時刻、日跨ぎ、公開APIまでを同じ実機E2Eで確認します。現在、iOS初期表示の`invalid_recruitment_date`報告があり、このE2Eは未完了です。

Passkey/OAuth/native storageは正式`frontend/`とDevelopment Build／実機で確認します。Expo Goでnative moduleを使う経路の成功を本番相当の証拠にしません。通知のテストは現状アプリ内RESTの一覧・既読・イベント生成までで、OSプッシュ通知は対象外（未実装）です。

起動時migrationは`backend/migrations/*.sql`を順に正規化し、`schema_migrations`のSHA-256 checksumと一致する適用済みファイルだけをスキップします。適用済みSQLを編集してchecksum mismatchを隠してはいけません。checksum mismatchは起動停止が期待動作であり、変更は新規migrationで行います。
