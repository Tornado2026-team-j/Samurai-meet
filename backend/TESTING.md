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

募集の利用日・壁時計は`Asia/Tokyo`、DB/APIの絶対時刻はUTCとして扱います。ISO内部値、JST固定の日時正規化、期限境界は自動テストで確認済みです。iOSの日時picker、過去時刻、日跨ぎ、公開・応募・通知遷移までの全通し実機E2Eは未完了です。以前のiOS初期表示`invalid_recruitment_date`は日時入力のISO/JST化で解消済みです。

Passkey/OAuth/native storageは正式`frontend/`とDevelopment Build／実機で確認します。Expo Goでnative moduleを使う経路の成功を本番相当の証拠にしません。通知のテストは現状アプリ内RESTの一覧・既読・イベント生成までで、OSプッシュ通知は対象外（未実装）です。

起動時migrationは`backend/migrations/*.sql`を順に正規化し、`schema_migrations`のSHA-256 checksumと一致する適用済みファイルだけをスキップします。適用済みSQLを編集してchecksum mismatchを隠してはいけません。checksum mismatchは原則として起動停止が期待動作であり、0040と0044だけは監査済みの旧checksumと現行checksumの組み合わせを限定許容し、後続migrationで前方移行します。変更は新規migrationで行います。
