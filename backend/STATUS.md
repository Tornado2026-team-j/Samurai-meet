# バックエンド実装状況と引き継ぎ

最終更新: 2026-08-24

## 現在の構成

```text
Expo / Dev Client
  ├─ Google OAuth2 / OIDC（実接続設定待ち）
  ├─ Passkey / WebAuthn（HTTP 儀式の実装待ち）
  └─ 暗号化済み画像アップロード（HTTP API の実装待ち）
        │
Go API
  ├─ PostgreSQL: ユーザー、認証、セッション、画像メタデータ
  └─ private ファイル領域: 暗号化済み画像本体のみ
```

SQLite は使用しない。画像本体は DB に保存しない。

## 実装済み

- PostgreSQL 接続と `migrations/` の順次適用
- Docker Compose / GitHub Actions の PostgreSQL
- JWS Access Token の HS256 署名・検証（寿命 1 分）
- 256 bit 不透明 Refresh Token の生成・ハッシュ化
- Google OIDC の PKCE 認可 URL、コード交換、ID Token 検証部品
- WebAuthn Relying Party 初期化部品
- 暗号文専用の画像保存、SHA-256、容量/TTL 付き暗号文キャッシュ
- RSA-OAEP-256 によるプロフィール画像鍵ラップ
- `photos` migration

## 未実装: 次に行うこと

詳細は [TODO.md](TODO.md) を参照。

特に OAuth / Passkey の HTTP API、ユーザー・credential・session repository、Refresh 回転、画像 upload/download API、退会オーケストレーションは未実装である。現時点で「ログイン可能」とは扱わない。

## 環境変数

ベースは [`.env.example`](.env.example)。ローカルでは PostgreSQL を起動する。

```powershell
cd backend
docker compose -f docker-compose.dev.yml up -d
Copy-Item .env.example .env
```

Google OAuth の実接続には、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REDIRECT_URI` が必要。Passkey 実接続には、`WEBAUTHN_RP_ID` と `WEBAUTHN_RP_ORIGIN` が必要。

## セキュリティ上の不変条件

- Access Token、Refresh Token、Key-A、Key-B、Recovery Key、画像平文をログへ出さない。
- DB に Refresh Token の平文を保存しない。
- private 画像領域には暗号文だけを保存する。
- メモリキャッシュには暗号文だけを置く。
- プロフィール画像は端末で暗号化し、画像鍵をサーバー公開鍵でラップする。
- 退会ではセッション失効、DB 論理削除、暗号文ファイル削除、キャッシュ無効化を必ず同一の業務フローで行う。

## 引き継ぎ時の確認順

1. `TODO.md` で未実装と外部設定待ちを確認する。
2. `docs/features/auth.md`、`docs/api.md`、`docs/database.md` と本ファイルを突き合わせる。
3. `go test ./...` と GitHub Actions を確認する。
4. 実装後は本ファイル、TODO、API / DB / 認証仕様を同じコミットで更新する。
