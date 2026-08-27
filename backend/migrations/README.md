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
- `0016_recovery_proof.sql` は当時のRecovery Keyで復号したKey-Aの公開証明鍵と、期限・試行回数付きの一回限りRecovery challengeを追加した旧migrationである。v2 cutover後は旧行を削除する。
- `0017_user_display_name.sql` はPasskeyの表示名に使うユーザー表示名をusersへ追加する。
- `0018_device_image_keys.sql` は端末公開鍵、端末proof nonce、画像の端末別Key-B envelope、Key-A由来の画像鍵wrapperを追加する。Key-B平文は保存しない。
- `0019_profiles_matching.sql` はプロフィール、最新位置、募集カード、ブロック、マッチ状態を追加する。位置の正確な値はAPIレスポンスへ返さない。
- `0020_chat_meetings.sql` はacceptedマッチ用のチャット、暗号化メッセージ、既読状態、会合セッション、短期の距離補助値を追加する。平文本文やBLE識別子は保存しない。
- runnerは`schema_migrations`へファイル名と正規化SQLのSHA-256を記録し、適用済みSQLを再実行しない。起動が同時になった場合もPostgreSQL advisory lockで直列化する。適用済みファイルの内容が変わった場合はchecksum mismatchで停止する。
- 既存DBへ導入する初回起動では、ファイル名順に現行schemaを確認しながら未登録migrationを一度だけ適用する。適用済み状態を手作業で捏造・削除せず、バックアップと監査ログを残してから運用する。

ローカル開発・CI・運用環境は PostgreSQL を利用します。

- `0021_client_root_key_transfer.sql` はv2のX25519端末合意公開鍵と、旧端末が新端末へMaster Keyを移行するためのopaque transfer行を追加する。秘密鍵、Master Key、Recovery Phrase、verification code平文は保存しない。
- `0022_disable_legacy_root_keys.sql` はリリース前のv2-only cutoverで、旧v1 root envelope、Recovery challenge、旧Key-B materialを削除し、`key_envelopes`へv2-only制約を追加する。旧開発アカウントのv1 Recovery Keyは復旧できないため、v2の鍵登録をやり直す。
- `0023_storage_cleanup_jobs.sql` はアカウント削除後の暗号化画像削除を再試行可能にする。ユーザー行への外部キーは持たず、DB削除コミット後もストレージ削除が完了するまでジョブを保持する。
