# Expo Go OAuth / session テスト

1. `backend` で `go run ./cmd/server` を起動する。
2. Cloudflare Tunnelを `127.0.0.1:8080` へ向ける。
3. `backend/expo-test` で `bun run dev` を実行し、Expo GoでQRコードを読む。
4. 画面下部の**状態を更新**を押す。`/api/v1/readyz`が200ならAPIとCloudflare Tunnelの接続は確認済み。
5. **Googleでログイン**を押す。Google認可後、Expo Goの`exp://.../--/auth`でアプリへ戻り、Secure Storageの検証値でhandoff codeを交換してセッションを保存する。
6. ログイン後に**状態を更新**を押すと、readiness確認とRefresh Token rotationを一度に確認できる。**セッションを更新**だけでもRefreshを実行できる。

認可の途中でアプリが終了しても、検証値はSecure Storageに残る。deep linkのhandoffコードを受け取った次回起動時にセッション交換を再試行できる。handoffコードは10分で失効し、一度使うと再利用できない。

画面変更が反映されない場合だけ、Metroを一度停止して次を実行する。その後はFast Refreshを使う。

```powershell
cd backend/expo-test
bun run dev -- --clear
```

Go APIのOAuth許可URI設定を変更した場合は、Goサーバー自体も再起動する。Expo Goの`exp://`復帰を本番設定で試すローカル確認では、`backend/.env`の`ALLOW_EXPO_GO_REDIRECT=true`が必要である。運用公開時はfalseに戻し、Development Buildの固定schemeを使用する。

Google Console の許可済みリダイレクトURIは `https://samurai-meet.disnana.com/auth/callback` と完全一致させる。テスト結果画面のtokenは検証用途のみであり、画面共有・保存・ログへの貼り付けをしない。
