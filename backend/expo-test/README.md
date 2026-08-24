# Expo Go OAuth テスト

1. `backend` で `go run ./cmd/server` を起動する。
2. Cloudflare Tunnelを `127.0.0.1:8080` へ向ける。
3. `backend/expo-test` で `bun run start` を実行し、Expo Go で QR コードを読む。
4. **Googleでログイン** を押す。Google認可後、アプリ固有URI `samuraimeettest://auth` でExpo Goへ戻る。アプリはSecure Storageに保持した検証値でhandoffコードを交換し、セッションを保存する。

認可の途中でアプリが終了しても、検証値はSecure Storageに残る。deep linkのhandoffコードを受け取った次回起動時にセッション交換を再試行できる。handoffコードは10分で失効し、一度使うと再利用できない。

Google Console の許可済みリダイレクトURIは `https://samurai-meet.disnana.com/auth/callback` と完全一致させる。テスト結果画面のtokenは検証用途のみであり、画面共有・保存・ログへの貼り付けをしない。
