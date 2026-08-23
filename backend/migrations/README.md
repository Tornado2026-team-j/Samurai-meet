# 認証・セッション migration

`0001_auth_sessions.sql` は PostgreSQL と SQLite の両方で使える SQL を対象にしています。

- 識別子はアプリケーション側で UUID を生成して `TEXT` として保存する。
- 時刻は UTC の ISO 8601 形式をアプリケーション側で書き込む。
- バイナリ値、公開鍵、暗号化データは Base64URL 等のテキストにして保存する。
- SQLite を使う接続では、外部キー制約を有効化する（`PRAGMA foreign_keys = ON`）。

運用環境では PostgreSQL を利用し、SQLite はローカル開発・単体テストだけに使います。
