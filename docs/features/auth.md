# 機能仕様：認証・アカウント復旧

最終更新: 2026-08-24

この文書は認証の設計方針です。現在のHTTP契約は [backend/API_SPEC.md](../../backend/API_SPEC.md) を優先します。

## 1. 対象

- Google OAuth2 / OIDCによるユーザー識別と登録
- Passkey / WebAuthnの登録、追加、認証、解除
- JWS Access Token、PostgreSQL session、Refresh Token rotation
- Key-A、Key-B、Recovery Keyによる端末側暗号化データ復旧
- 退会時のsession失効、DB論理削除、暗号文画像とcacheの削除

## 2. 実装済みと未実装

| 項目 | 状態 |
| --- | --- |
| Google OIDC / PKCE / callback | 実装済み |
| Expo Goへのhandoffと中断再開 | 実装済み |
| JWS Access Token / Refresh rotation | 実装済み |
| logout / session管理 | 実装済み |
| Passkey HTTP儀式 | 実装済み。開発ブラウザはWeb domain/localhost、実端末はDevelopment Buildで検証する |
| Key-A envelope HTTP | 実装済み。Key-Aは端末側で暗号化した値だけ送る |
| 端末側画像暗号文の写真HTTP API | 実装済み。AES-GCM暗号化そのものはクライアント責務 |
| 退会削除オーケストレーション | 実装済み。DB行、暗号文ファイル、cacheを削除 |

## 3. クライアント構成

| 画面 / 処理 | ファイル案 | 言語 |
| --- | --- | --- |
| ログイン | `frontend/app/(auth)/login.tsx` | TypeScript / TSX |
| 認証状態 | `frontend/hooks/useAuth.ts` | TypeScript |
| Google OAuth開始・handoff | `frontend/services/api.ts` | TypeScript |
| Passkey呼び出し | `frontend/services/auth.ts` | TypeScript + iOS/Android OS API |
| Key-A / Recovery Key / AES-GCM | `frontend/services/crypto.ts` | TypeScript + Secure Storage |
| 最小動作確認 | `backend/expo-test/App.tsx` | TypeScript / Expo |

Expo GoはOAuth・session・Secure Storageの確認に使用します。ブラウザPasskeyは`backend/dev-client`でWebAuthn APIを確認し、Passkey native moduleはDevelopment Buildでのみ確認します。

## 4. Google OAuthとhandoff

1. アプリがランダムなhandoff verifierをSecure Storageへ保存する。
2. verifierのSHA-256 Base64URLを`handoff_challenge`としてAPIへ送る。
3. APIがGoogle用stateとPKCE verifierをPostgreSQLへ10分保存し、Googleへリダイレクトする。
4. Google callbackでOIDC `sub`を検証し、ユーザーをupsertする。
5. APIがhandoff codeのhashとchallengeを10分保存し、アプリURIへリダイレクトする。
6. アプリがhandoff codeとverifierを`/auth/google/exchange`へ送り、セッションを受け取る。
7. サーバーは応答を暗号化保存するため、DB commit直後のアプリクラッシュでも同じverifierで再交換できる。

現実装ではGoogle exchange時点で通常のAccess/Refresh sessionを発行します。Google認証後にPasskeyを必須にするプロダクト要件へ移行する場合は、`pre_auth_token`を追加し、通常sessionの発行をPasskey成功後へ移す必要があります（監査P1）。

Google Consoleに登録するredirect URIは次の一つだけです。

```text
https://samurai-meet.disnana.com/auth/callback
```

アプリへ戻すdeep linkはGoogle Consoleへ登録しません。本番は`samuraimeet://auth`、Expo Go開発時は`exp://<host>/--/auth`です。

## 5. Passkey

### 登録

Google exchangeまたは既存sessionで得たAccess Tokenで登録optionsを取得し、WebAuthn APIへ渡します。verifyでは`X-Passkey-Ceremony-Token`とcredential JSONを送ります。challengeはDBで一回だけ消費し、credential JSON、公開鍵、sign counterを保存します。

### ログイン

login optionsのbodyを空にするとdiscoverable loginです。assertionのcredential IDまたはuser handleから所有ユーザーを検索し、WebAuthnの署名、origin、RP ID、user verification、sign counterを検証します。成功時は通常のJWS/Refresh sessionを作成します。

### 追加・解除

既存Access Tokenで登録を何本でも追加できます。credential一覧を表示し、所有者一致を確認してから個別解除します。最後のcredentialを解除してもGoogle OAuthログインは残りますが、Passkeyだけでのログインはできなくなります。

### Webドメインでの検証

WebAuthnの検証では、サーバー設定を画面のOriginに一致させます。HTTPSの本番ドメインでは次の値です。

```text
WEBAUTHN_RP_ID=samurai-meet.disnana.com
WEBAUTHN_RP_ORIGIN=https://samurai-meet.disnana.com
```

`WEBAUTHN_RP_ID`にはschemeやportを含めません。開発ブラウザでは`http://localhost:5173`と`WEBAUTHN_RP_ID=localhost`を使います。Google OAuth後はWebクライアントの`/auth/complete`へhandoffされ、開発パネルから登録、discoverable login、credential追加・解除、Refresh、ログアウトを確認できます。Expo Goはnative Passkeyのテスト対象外です。

## 6. セッションと更新タイミング

| 項目 | 方針 |
| --- | --- |
| Access Token | HS256 JWS-JWT、TTL 1分、`sid`でDB sessionに紐づける |
| Refresh Token | 32byte以上のopaque乱数、DBはSHA-256 hashのみ |
| session | 絶対期限90日、アイドル期限30日 |
| 旧Access Token | 自身のexpまでは有効。ただしDB session失効確認を必須にする |
| 旧Refresh Token | 原則即時使用済み。同じrequest IDの再送だけ30秒許可 |
| reuse | 別request IDの使用済みtokenはsession familyごと失効 |

クライアントは次のタイミングで更新します。

- アプリ起動・フォアグラウンド復帰・API呼び出し前に残り時間を確認する。
- 残り30秒以下ならsingle-flightでRefreshを一つだけ実行する。
- 通信結果が不明なら同じ`request_id`で一度だけ再送する。
- Refresh失敗、reuse検知、handoff verifier不一致時はtokenと一時状態を削除して再ログインする。
- バックグラウンド中に定期Refreshしない。

## 7. 新端末・Recovery Key

実装時の目標フローは次のとおりです。

1. 端末でKey-Aを生成しSecure Storageへ保存する。
2. Recovery Keyを一度だけ表示し、ユーザーに保存させる。
3. Recovery Keyから導出した鍵でKey-AをAES-256-GCM暗号化する。
4. 暗号化済みKey-AとKDFパラメータだけを`PUT /api/v1/me/key-envelopes`で保存する。
5. 新端末ではGoogle認証、Recovery Key入力、端末上の復号、Secure Storage保存を行う。
6. 復旧途中でアプリが終了しても、状態と入力要求を再開できるようにする。

Recovery Keyの平文をサーバー、ログ、DBへ送らない。Recovery Key紛失時に運営者が復号できるかは、復号不能設計のリスクを明示したうえでプロダクト決定する。

## 8. 画像鍵と退会

画像本体は端末でAES-256-GCM暗号化し、`POST /api/v1/me/photos`へ暗号文だけを送る。private画像の画像鍵は端末側Key-Aでラップする。profile画像は同じ端末側ラップに加えて、`GET /api/v1/keys/profile-image`で取得したRSA-OAEP-256公開鍵でも画像鍵をラップする。後者だけをサーバーが復号し、`GET /api/v1/profile-photos/{id}`のレスポンス作成中に平文を使う。平文はDB、privateフォルダ、メモリcacheへ保存しない。

`DELETE /api/v1/me` は`{"confirm":"DELETE"}`を要求する。DB user rowをロックしてsessionを失効し、暗号文フォルダとcacheを削除した後、refresh/passkey/challenge/key envelope/handoff/photo metadataとusers rowを削除する。旧Access Tokenはsession行がなくなるため利用できない。

## 9. 監査不変条件

- Googleのemailを主キーにせず、OIDC `sub`を利用する。
- redirect URI、OAuth state、Google PKCE、アプリhandoff challengeを検証する。
- Access/Refresh token、handoff code、Key-A/Key-B/Recovery Keyをログへ出さない。
- JWS署名だけで認証完了とせず、DBのsessionとuser statusを確認する。
- Refresh TokenをWebSocket / QUICへ送らない。チャット用tokenは別audienceで発行する。
- 端末側画像暗号化の秘密鍵をAPIへ平文送信しない。
