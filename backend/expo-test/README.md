# Expo Go OAuth / session テスト

1. `backend` で `go run ./cmd/server` を起動する。
2. Cloudflare Tunnelを `127.0.0.1:8080` へ向ける。
3. `backend/expo-test` で `bun run dev` を実行し、Expo GoでQRコードを読む。
4. 画面下部の**状態を更新**を押す。`/api/v1/readyz`が200ならAPIとCloudflare Tunnelの接続は確認済み。
5. **Googleでログイン**を押す。Google認可後、Expo Goの`exp://.../--/auth`でアプリへ戻り、Secure Storageの検証値でhandoff codeを交換する。この時点では通常sessionではなく、Passkey専用の`pre_auth_token`が保存される。
6. **Passkeyを完了してアプリへ戻る**または**WebでPasskeyをテスト**を押す。ドメインのWeb検証画面がPasskey登録/認証を行い、短命なPKCE session handoffで通常Access/Refresh sessionをExpo Goへ返す。
7. 通常sessionへ戻った後に**状態を更新**を押すと、readiness確認とRefresh Token rotationを一度に確認できる。**セッションを更新**だけでもRefreshを実行できる。

Google認証、Passkey、session handoffの途中でアプリが終了しても、必要なverifierと`pre_auth_token`はSecure Storageに残る。次回起動時または再度Webテストを開いた時に処理を再開できる。handoff codeは10分で失効し、verifierなしでは交換できない。

画面変更が反映されない場合だけ、Metroを一度停止して次を実行する。その後はFast Refreshを使う。

```powershell
cd backend/expo-test
bun run dev -- --clear
```

Go APIのOAuth許可URI設定を変更した場合は、Goサーバー自体も再起動する。Expo Goの`exp://`復帰を本番設定で試すローカル確認では、`backend/.env`の`ALLOW_EXPO_GO_REDIRECT=true`が必要である。運用公開時はfalseに戻し、Development Buildの固定schemeを使用する。

Google Console の許可済みリダイレクトURIは `https://samurai-meet.disnana.com/auth/callback` と完全一致させる。テスト結果画面のtokenは検証用途のみであり、画面共有・保存・ログへの貼り付けをしない。

## ログイン後の検証パネル

ログインが完了すると、次の操作を同じ画面から確認できる。

- **WebでPasskeyをテスト**: `https://samurai-meet.disnana.com/`をアプリ内ブラウザで開く。Google直後の`pre_auth_token`はURL fragmentでWeb画面へ渡し、HTTP queryやサーバーログへ送らない。Web画面側でPasskeyの登録・ログインを行った後、短命なsession handoffでExpo Goへ戻る。Expo Goからnative Passkey APIを直接呼び出すのではなく、ドメインのWebAuthn実装を使う方式。
- **通常session後のPasskey再認証**: Expo GoはAccess Token、user ID、session IDをURL fragmentでWeb検証画面へ渡す（Refresh Tokenは渡さない）。Web側の再認証API成功後にのみsession handoffを開始し、Key-Bや高権限処理と同じ直近Passkey境界を確認できる。Expo Go画面からのKey-B取得とKey-A+Key-BのHKDF結合は未接続である。
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

1. Googleログイン後、画面が`pre_auth_token`を保持した状態になることを確認する。この段階で鍵・写真・session一覧APIが使えないのは正常。
2. **WebでPasskeyをテスト**からWeb画面を開き、初回はPasskey登録、登録済みなら既知ユーザーのPasskeyログインを確認する。
3. Expo Goへ自動復帰し、通常sessionのユーザーIDが表示されることを確認する。
4. **登録済みPasskeyを更新**でcredentialが表示されることを確認する。
5. **Key-A生成・envelope保存**を押してRecovery Keyを安全なテスト用メモへ一時的に控える。
6. **端末Key-Aを削除**、続けてRecovery Keyを入力して**端末Key-Aを復旧**する。
7. **セッション一覧**で個別失効、**セッションを更新**、**全端末ログアウト**、再ログインを確認する。

このクライアントは開発・検証専用であり、本番アプリの画面にそのまま組み込まない。Google交換時点では通常セッションを発行せず、Passkey成功後のsession handoffでのみ通常セッションを発行する。
