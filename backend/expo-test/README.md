# Expo Go OAuth テスト

1. `backend` で `go run ./cmd/server` を起動する。
2. Cloudflare Tunnelを `127.0.0.1:8080` へ向ける。
3. `backend/expo-test` で `bun run start` を実行し、Expo Go で QR コードを読む。
4. **Googleでログイン** を押す。ブラウザでGoogleの認可後、`https://samurai-meet.disnana.com/auth/callback` の結果画面が表示されれば、DBユーザー・セッション・Refresh Tokenの作成まで成功している。

Google Console の許可済みリダイレクトURIは `https://samurai-meet.disnana.com/auth/callback` と完全一致させる。テスト結果画面のtokenは検証用途のみであり、画面共有・保存・ログへの貼り付けをしない。
