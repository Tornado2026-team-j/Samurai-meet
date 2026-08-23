# バックエンド TODO

最終更新: 2026-08-24

## 明日: 外部認証の実接続

- [ ] Google Cloud Console で OAuth クライアントを作成し、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REDIRECT_URI` を `backend/.env` に設定する。
- [ ] Google Cloud Console の許可済み redirect URI を `GOOGLE_REDIRECT_URI` と完全一致させる。
- [ ] Passkey 用の実ドメインを決め、`WEBAUTHN_RP_ID` と `WEBAUTHN_RP_ORIGIN` を設定する。本番では HTTPS を必須にする。
- [ ] `GET /auth/google/start` と `POST /auth/google/exchange` を実環境の Google アカウントで通す。
- [ ] Passkey の登録・認証儀式を実端末 / 実ブラウザで通す。

## 認証 API の実装

- [ ] Google `sub` を `users.google_subject_id` に保存・取得するリポジトリを実装する。
- [ ] OAuth の `state` と PKCE verifier を DB に短期保存し、コールバックで一回使用にする。
- [ ] `pre_auth_token`、Passkey challenge、credential の永続化を実装する。
- [ ] Passkey 成功後にセッション、Access Token、Refresh Token を発行する。
- [ ] `POST /auth/refresh` のトークン回転、30 秒の同一 `refresh_request_id` 再送、別 request ID の reuse 時の family 失効を実装する。
- [ ] ログアウト、全端末ログアウト、セッション一覧、個別失効 API を HTTP ルーターへ接続する。

## 画像暗号化・鍵管理

- [ ] Expo 側で Key-A + Key-B から画像鍵を導出し、AES-256-GCM で暗号化してからアップロードする。
- [ ] プロフィール画像用の RSA 公開鍵を API で配信し、端末側で画像鍵を RSA-OAEP-256 ラップする。
- [ ] サーバー用 RSA 秘密鍵を `.env` ではなく KMS / Secret Manager へ移す。
- [ ] 画像アップロード、ダウンロード、プロフィール画像の復号・配信 API を認可と接続する。
- [ ] 退会トランザクションから DB 論理削除、Refresh Token 失効、暗号文ファイル削除、キャッシュ無効化を順に実行する。

## 検証・運用

- [ ] Docker Compose の PostgreSQL を起動して `RUN_DATABASE_SMOKE_TEST=1` の HTTP スモークテストを実行する。
- [ ] CI の PostgreSQL サービス上で migration / HTTP スモークテストが緑であることを確認する。
- [ ] Google OAuth・Passkey 実接続後にセキュリティ監査を再実施する。
