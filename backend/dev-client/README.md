# Backend Dev Client

バックエンド API を手動確認するための開発専用ブラウザクライアントです。プロダクトの Expo アプリには含めません。

```powershell
# terminal 1
cd backend
go run ./cmd/server

# terminal 2
cd backend/dev-client
python server.py
```

`http://localhost:5173` を開きます。画面のAPI URLは同一オリジンの`/api/v1`へ自動設定され、Python開発プロキシがローカルGo APIへ中継します。OAuthの`/auth/callback`もGo APIへ中継します。必要なら入力欄へ`http://127.0.0.1:8080/api/v1`を直接指定できます。プロダクトAPIの契約は常に`/api/v1`です。

`APP_ENV=development`または`test`でGoサーバーを`cd backend; go run ./cmd/server`から起動した場合は、`DEV_CLIENT_DIR`（既定値`dev-client`）の静的画面もGo APIの`/`から配信されます。Cloudflare Tunnelを`127.0.0.1:8080`へ向ける構成では、`https://samurai-meet.disnana.com/`がその検証画面になります。`APP_ENV=production`ではこの静的配信は無効です。

画面にはGoogle OAuth、Refresh、ログアウト、WebAuthnのPasskey登録・ログイン・一覧・解除を用意しています。ブラウザのWebAuthnテストは、サーバーの `WEBAUTHN_RP_ID` と `WEBAUTHN_RP_ORIGIN` を画面を開いたOriginに合わせてから実行してください。本番ドメインで行う場合は `samurai-meet.disnana.com` / `https://samurai-meet.disnana.com` を使用し、OAuthの戻り先は `/auth/complete` です。
