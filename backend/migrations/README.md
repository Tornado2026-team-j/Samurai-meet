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
- `0021_client_root_key_transfer.sql` はv2のX25519端末合意公開鍵と、旧端末から新端末へopaqueなroot-key envelopeを移行する行を追加する。
- `0022_disable_legacy_root_keys.sql` はリリース前のv2-only cutoverで、旧v1 root envelope、Recovery challenge、旧Key-B materialを削除し、v2-only制約を追加する。
- `0023_storage_cleanup_jobs.sql` はアカウント削除後の暗号化画像ストレージ削除を再試行可能にするジョブを追加する。
- `0024_recovery_delete_capability.sql` はRecovery後の退会・完全削除に使う短命capabilityを追加する。
- `0025_notifications.sql`はユーザー単位の直近7日通知、既読時刻、応募・承認／辞退・暗号化チャット送信の冪等イベントを保存する。通知にはチャット本文や鍵を保存しない。
- `0026_match_withdrawal.sql` は応募取り下げ用の`matches.status = cancelled`を追加する。取り下げ後も応募履歴を保持するため、既存の応募・通知フローと合わせて適用する。
- `0027_reports.sql` は通報の原票テーブル`reports`（対象種別・理由・任意コメント・運営ステータス）を追加する。運営キュー処理と管理者操作の監査ログは別途。通報者情報は対象者へ返さない。同一通報者×同一対象で未処理の通報は1件に集約する。
- `0031_recruitment_details.sql` は既存の募集カテゴリ（`Food` / `Places` / `Activity` / `Other`）を維持したまま、募集人数と公開用の場所表示名を追加する。正確な座標は従来どおりAPIレスポンスへ含めない。
- `0032_identity_verifications.sql` はStripe IdentityのセッションIDと確認状態を保存する。本人確認書類や住所は保存しない。
- `0033_push_devices.sql` はOSプッシュ通知用のExpo Push Tokenと通知種別ごとの設定を端末単位で保存する。
- `0036_device_transfer_cancellation.sql` は端末引き継ぎの`pending`／未受取`approved`を`cancelled`へ遷移できるようにし、キャンセル時刻と検索用indexを追加する。完了・拒否・期限切れ・キャンセル済みからの再遷移はAPIとtransactionで拒否する。
- `0034_chat_attachments.sql` はチャット写真の暗号文メタデータ`chat_attachments`を追加する。画像本体はDBに保存せず暗号文BLOBストレージへ置き、平文・EXIF・暗号鍵は保存しない。`message_id`が`NULL`の未参照アップロードは起動時スイープで削除する。`--`コメント内に`;`を書かない（runnerは`;`で文を分割する）。
- `0035_restore_places_category.sql` は、短期間導入された`Heritage`カテゴリを正式カテゴリの`Places`へ戻す。0031が既に適用済みの環境にも、既存募集を失わず適用できる。
- `0043_chat_message_edit_timestamp.sql` は、送信者が暗号化本文を置き換えた時刻を保持する`messages.edited_at`を追加する。本文自体や編集履歴は保存しない。
- `0044_chat_message_translations.sql` は、メッセージrevision・対象言語ごとのチャットDEK暗号化翻訳envelopeを`chat_message_translations`へ保存する。翻訳本文・原言語は保存せず、メッセージ編集・削除・保持期限で関連行を消去する。
- `0045_chat_message_translations_encrypted.sql` は、先行導入版0044の平文翻訳キャッシュを削除し、暗号化envelopeの列へ前方移行する。サーバーはKey-Bを持たないため、旧平文キャッシュは再暗号化せず破棄する。
- `0046_chat_key_envelopes.sql` は、ランダムなチャットDEKをKey-A由来のaccount envelopeまたは端末X25519 device envelopeとして保存する。サーバーはenvelopeを復号せず、既存行の置換も許可しない。
- `0047_chat_key_manifests.sql` は、チャットDEKのクライアント検証用commitmentと、device envelopeのowner authority／参加者自身の端末登録制限を支えるmanifestを保存する。DEKやenvelopeの平文は保存しない。
- `0048_chat_message_plaintext_binding.sql` は、翻訳要求の本文を対象messageへ結び付けるcommitmentと16byte saltの保存列を追加する。現行のcommitment値はクライアント保持鍵によるHMAC-SHA-256で、本文自体やHMAC鍵は保存しない。
- `0049_chat_translation_account_limits.sql` は、複数インスタンスで共有できるアカウント単位の翻訳provider token bucketとin-flight重複抑止の状態を追加する。翻訳本文やprovider応答は保存しない。
- `0050_chat_translation_inflight_expiry_type.sql` は、in-flight重複抑止の期限比較を文字列ではなくPostgreSQLのtimestamp型で行うようにする。
- `0051_chat_key_manifest_commitment_format.sql` は、chat DEK commitmentをSHA-256のraw Base64URL（パディングなし）43文字に制限する。
- `0052_meeting_resume_consent.sql` は、中止済み会合の再開に参加者双方の明示同意を要求する時刻列を追加する。片側の中止は即時に反映され、双方が再開に同意した後も新たな相互開始が必要になる。
- `0053_matching_search_indexes.sql` は、募集検索で空き枠を確認するaccepted match数の参照を高速化する部分indexを追加する。
- `0054_backfill_recruitment_deadlines.sql` は、既存の募集中カードを開始24時間前締切へ前方移行し、期限列をPostgreSQLのtimestamp型へ変換して精度と検索性能を両立する。
- `0055_match_likes.sql` は、終了済みのマッチで参加者が相手へ一度だけ送れる「いいね」を保存する。重複送信は一意制約で防ぎ、受信者の公開like数だけを集計する。
- runnerは`schema_migrations`へファイル名と正規化SQLのSHA-256を記録し、適用済みSQLを再実行しない。起動が同時になった場合もPostgreSQL advisory lockで直列化する。適用済みファイルの内容が変わった場合はchecksum mismatchで停止する。
- 0040と0044には、既知の旧checksumと現行checksumの組み合わせだけをrunnerが監査済み互換として許容する。履歴行は変更せず、後続の0042または0045で前方移行する。
- 既存DBへ導入する初回起動では、ファイル名順に現行schemaを確認しながら未登録migrationを一度だけ適用する。適用済み状態を手作業で捏造・削除せず、バックアップと監査ログを残してから運用する。

適用済みSQLの編集・リネーム・置換は行わない。checksum mismatchは既存DBとファイルの不整合を知らせる意図した停止であり、該当行を削除したりchecksumを書き換えたりして回避してはいけない。変更は新しい番号のmigrationとして追加し、既存環境では適用履歴とバックアップを確認してから起動する。

ローカル開発・CI・運用環境は PostgreSQL を利用します。
