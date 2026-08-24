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

## ログイン後の検証パネル

ログインが完了すると、次の操作を同じ画面から確認できる。

- **WebでPasskeyをテスト**: `https://samurai-meet.disnana.com/`をアプリ内ブラウザで開く。開発環境のGoサーバーは`backend/dev-client`を`/`から配信できるため、Cloudflare Tunnelを`127.0.0.1:8080`へ向けたままWebAuthn画面を開ける。Web画面側でPasskeyの登録・ログインを行う。Expo Goからnative Passkey APIを直接呼び出すのではなく、ドメインのWebAuthn実装を使う方式。
- **登録済みPasskeyを更新 / 解除**: 現在のセッションでPasskey一覧を取得し、credential単位で解除する。
- **Key-A生成・envelope保存**: 端末内でKey-AとRecovery Keyを生成し、Key-AそのものではなくRecovery Keyで暗号化したenvelopeだけをAPIへ保存する。Recovery Keyは表示中だけ保持する。
- **端末Key-Aを削除**: 新端末・端末紛失の復旧を再現する。
- **Recovery Keyで端末Key-Aを復旧**: 保存済みenvelopeを取得し、Recovery Keyを端末内で使ってKey-Aを復号してSecure Storageへ戻す。
- **セッション一覧 / 失効 / 全端末ログアウト**: 現在のセッションを含む一覧を確認し、個別または全件を失効させる。
- **退会テスト**: 確認文`DELETE`を入力して、ユーザー、セッション、Passkey、鍵envelope、画像metadata、暗号化済み画像ファイルの削除処理を確認する。

### PasskeyのWebテスト前提

`APP_ENV=development`と`DEV_CLIENT_DIR=dev-client`でGoサーバーを起動している場合、`https://samurai-meet.disnana.com/`はGoの8080番から検証画面を返す。Cloudflare Tunnelを8080へ向けている現在の構成でそのまま確認できる。Pythonの開発プロキシを使う場合だけ、次の方法で5173番へ一時的に向けてもよい。

```powershell
cd backend/dev-client
python server.py
```

本番ドメインでPasskeyを使う環境変数は次の組み合わせにする。

```dotenv
WEBAUTHN_RP_ID=samurai-meet.disnana.com
WEBAUTHN_RP_ORIGIN=https://samurai-meet.disnana.com
```

`localhost`で試す場合は`WEBAUTHN_RP_ID=localhost`、`WEBAUTHN_RP_ORIGIN=http://localhost:5173`にする。Expo Goから開く場合も、PasskeyのRP IDとoriginはアプリの`exp://`ではなく、開いたWebドメインに一致させる。

### 推奨テスト順

1. Googleログイン後、**状態を更新**でセッションを確認する。
2. **WebでPasskeyをテスト**からWeb画面を開き、Passkey登録・ログインを確認する。
3. Expo Goへ戻り、**登録済みPasskeyを更新**でcredentialが表示されることを確認する。
4. **Key-A生成・envelope保存**を押してRecovery Keyを安全なテスト用メモへ一時的に控える。
5. **端末Key-Aを削除**、続けてRecovery Keyを入力して**端末Key-Aを復旧**する。
6. **セッション一覧**で個別失効、**全端末ログアウト**、再ログインを確認する。

このクライアントは開発・検証専用であり、本番アプリの画面にそのまま組み込まない。現行APIはGoogle OAuth完了時点で通常セッションを発行するため、Passkey必須ログインの強制確認は別途`pre_auth_token`導入後に実施する。
