# 認証・セッション migration

認証・画像の migration は PostgreSQL を対象にしています。

- `0001_auth_sessions.sql` はユーザー、セッション、Refresh Token、Passkey challenge を作成する。
- `0002_images.sql` は暗号化画像のメタデータを作成する。画像本体は DB に保存しない。
- migration はアプリケーションが順番に適用し、適用履歴は `schema_migrations` に保存する。

ローカル開発・CI・運用環境は PostgreSQL を利用します。
