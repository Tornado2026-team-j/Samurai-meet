# 認証・セッション migration

認証・画像の migration は PostgreSQL を対象にしています。

- `0001_auth_sessions.sql` はユーザー、セッション、Refresh Token、Passkey challenge、key envelopeを作成する。
- `0002_images.sql` は暗号化画像のメタデータを作成する。画像本体はDBに保存しない。
- `0003_oauth_states.sql` 以降はGoogle OAuth、モバイルhandoff、Refresh retry、Passkey credential JSON、画像の追加メタデータを追加する。
- `0008_photo_metadata.sql` は画像MIME、暗号文サイズ、profile画像用サーバー側wrapped keyを追加する。
- 現在の簡易runnerはファイル名順にSQLを再実行する。`IF NOT EXISTS` / `IF NOT EXISTS`相当で再実行可能にしているが、適用履歴テーブルはまだ導入していない。
- 本番でmigration履歴テーブルを導入する場合は、既存DBの適用状態を確認してからrunnerを変更する。

ローカル開発・CI・運用環境は PostgreSQL を利用します。
