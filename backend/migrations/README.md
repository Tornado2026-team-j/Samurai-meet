# 認証・セッション migration

認証・画像の migration は PostgreSQL を対象にしています。

- `0001_auth_sessions.sql` はユーザー、セッション、Refresh Token、Passkey challenge、key envelopeを作成する。
- `0002_images.sql` は暗号化画像のメタデータを作成する。画像本体はDBに保存しない。
- `0003_oauth_states.sql` 以降はGoogle OAuth、モバイルhandoff、Refresh retry、Passkey credential JSON、画像の追加メタデータを追加する。
- `0008_photo_metadata.sql` は画像MIME、暗号文サイズ、profile画像用サーバー側wrapped keyを追加する。
- `0009_pre_auth_sessions.sql` はGoogle直後のPasskey専用pre-auth tokenと、Passkey直後のsession判定用`last_passkey_at`を追加する。
- `0010_session_handoffs.sql` はWeb PasskeyからExpo Goへ通常sessionを返す、暗号化済み短命handoffを追加する。
- `0011_passkey_reauth.sql` は既存sessionの直近Passkey再認証用ceremony typeを追加する。
- `0013_session_handoff_retry.sql` は使用済みsession handoffの再送を同じ`request_id`に限定する列を追加する。
- `0014_passkey_bootstraps.sql` はWeb URLへ渡す短命bootstrap tokenのhash、scope、元session/pre-auth、redirect、handoff challenge、期限、消費日時を追加する。
- `0015_passkey_bootstrap_binding.sql` はbootstrapとWebAuthn ceremony tokenを結び付けるhash列を追加する。
- 現在の簡易runnerはファイル名順にSQLを再実行する。`IF NOT EXISTS` / `IF NOT EXISTS`相当で再実行可能にしているが、適用履歴テーブルはまだ導入していない。
- 本番でmigration履歴テーブルを導入する場合は、既存DBの適用状態を確認してからrunnerを変更する。

ローカル開発・CI・運用環境は PostgreSQL を利用します。
