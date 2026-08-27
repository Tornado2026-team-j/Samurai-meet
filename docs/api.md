# API仕様書

最終更新: 2026-08-27

現在のGo実装との厳密な契約は [backend/API_SPEC.md](../backend/API_SPEC.md) を正とする。この文書では、フロントエンドが使う公開APIを、実装済みと予定に分けて一覧化する。

## 1. 共通

- 本番Base URL: `https://samurai-meet.disnana.com/api/v1`
- ローカルBase URL: `http://127.0.0.1:8080/api/v1`。ネイティブアプリは本番Base URLを通常値とし、ローカル／LANを使う場合だけ環境変数で明示する。自動切替はしない。
- JSON / UTF-8。募集の利用日・開始／終了時刻は`Asia/Tokyo`固定の壁時計、`created_at`や`expires_at`等の絶対時刻はUTC RFC3339。
- 現行サービスIDはopaque `TEXT`。UUID文字列であると仮定しない。
- 保護APIは`Authorization: Bearer <access_token>`。
- エラーは現行実装では`{ "error": "code" }`。将来、messageやfieldを含む共通形式へ移行する。

## 2. 実装済みAPI

### ヘルス

| Method | Path | 認証 |
| --- | --- | --- |
| GET | `/healthz` / `/api/v1/healthz` | 不要 |
| GET | `/readyz` / `/api/v1/readyz` | 不要 |

### Google OAuth / OIDC

| Method | Path | 認証 |
| --- | --- | --- |
| GET | `/api/v1/auth/google/start?app_redirect_uri=...&handoff_challenge=...` | 不要 |
| GET | `/auth/callback` | Googleからのcallback |
| POST | `/api/v1/auth/google/exchange` | 不要 |

`start`はアプリhandoff verifierのchallengeを受け取り、API内部でstateとGoogle PKCEを保存する。Google Consoleのredirect URIは次だけである。

```text
https://samurai-meet.disnana.com/auth/callback
```

`exchange`のrequest:

```json
{
  "handoff_code": "callbackからの一回限りcode",
  "handoff_verifier": "端末Secure Storageのverifier"
}
```

成功時:

```json
{
  "data": {
    "user_id": "opaque-user-id",
    "pre_auth_token": "short-lived-opaque-token",
    "passkey_required": true,
    "passkey_registered": false,
    "recovery_available": false
  }
}
```

`recovery_available`はv2 Master Key envelopeにRecovery公開鍵がある場合だけ`true`です。`false`の場合はRecovery Phrase復旧ではなく、Passkey成功後に新しいv2 Recovery Phraseを登録します。移行後に旧envelopeしかない、または未設定のアカウントへのRecovery challengeは`409 recovery_not_configured`を返します。

Google交換時点では通常sessionを発行しない。`pre_auth_token`はExpo Goがbootstrap発行にBearerで使う短命の内部資格情報で、Web URLへ渡してはいけません。アプリURIの許可値は、本番`samuraimeet://auth`、開発用Expo Goの`samuraimeettest://auth`または`exp://<host>/--/auth`です。ブラウザ開発クライアントは、開発時の固定Origin（標準は`http://localhost:8081/auth/complete`または`http://127.0.0.1:8081/auth/complete`）と設定済みOriginの`/auth/complete`だけを完全一致で許可します。CF Tunnelなどでproduction設定のバックエンドをExpo Goから使う場合は、`ALLOW_EXPO_GO_REDIRECT=true`を明示したときだけ`exp://<host>/--/auth`を許可します。APIのoriginとアプリの戻り先は別の値です。

OAuth handoff codeは10分で失効し、一回使用後に消費する。同じverifierで期限内に再送した場合だけ、サーバーが保存した暗号化レスポンスを返す。アプリがOAuth途中で落ちても、Secure Storageのverifierを保持すれば再開できる。Web Passkey後のsession handoffは別APIで、同じverifierに加えて同じ`request_id`を30秒以内に送る場合だけ再送できます。

Web PasskeyからExpo Goへ戻す場合は、Expo Goが`POST /auth/passkey/bootstrap`を呼び、返された短命bootstrap tokenだけをWeb URL fragmentへ渡します。Web画面は`X-Web-Passkey-Token`と`X-Passkey-Ceremony-Token`でoptions/verifyを呼び、成功時はhandoff codeだけを返します。Webレスポンスは`no-store`です。Google直後の`pre_auth_token`やAccess TokenをURLに含めません。

Bootstrap request:

```json
{
  "scope": "passkey_register",
  "app_redirect_uri": "samuraimeet://auth",
  "app_handoff_challenge": "SHA-256 Base64URL"
}
```

`/auth/passkey/web/options`、`/auth/passkey/web/reset`、`/auth/passkey/web/verify`はWebAuthn専用のブラウザAPIです。bootstrapは現在1分、ceremonyは5分、一回限りで、サーバーにはtoken hashだけを保存します。ブラウザ側のWebAuthn失敗時はresetで旧ceremonyを無効化してから、新しいoptionsを取得できます。Recovery検証が成功したpre-auth登録では、旧Passkeyを同一トランザクションで失効させてから、新しいcredentialを登録します。端末側に残る古いcredentialを再登録画面の除外対象にしないため、同じ端末でも再登録できます。verify成功時のJSONは`handoff_code`と`app_redirect_uri`だけです。

Web Passkey後のsession handoff:

| Method | Path | 認証 |
| --- | --- | --- |
| POST | `/api/v1/auth/session-handoff/start` | Access Token + 直近Passkey |
| POST | `/api/v1/auth/session-handoff/exchange` | `handoff_code` + verifier + `request_id` |

`exchange`の`request_id`は空白不可・128文字以内です。使用済みcodeの再送は、正しいverifierと同じ`request_id`を30秒以内に送った場合だけ許可されます。session handoffのstart/exchange応答は`Cache-Control: no-store`と`Referrer-Policy: no-referrer`を付けます。

### Passkey / WebAuthn

| Method | Path | 認証 | 状態 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/passkey/register/options` | Access Token | 実装済み |
| POST | `/api/v1/auth/passkey/register/verify` | Access Token + ceremony header | 実装済み |
| POST | `/api/v1/auth/passkey/login/options` | 不要 | 実装済み |
| POST | `/api/v1/auth/passkey/login/verify` | ceremony header | 実装済み |
| POST | `/api/v1/auth/passkey/reauth/options` | Access Token | 実装済み |
| POST | `/api/v1/auth/passkey/reauth/verify` | Access Token + ceremony header | 実装済み |
| GET | `/api/v1/auth/passkey` | Access Token | 実装済み |
| DELETE | `/api/v1/auth/passkey/{credential_id}` | Access Token | 実装済み |
| POST | `/api/v1/auth/passkey/bootstrap` | Access Tokenまたはpre-auth | 実装済み |
| POST | `/api/v1/auth/passkey/web/options` | `X-Web-Passkey-Token` | 実装済み |
| POST | `/api/v1/auth/passkey/web/reset` | bootstrap + ceremony header | 実装済み |
| POST | `/api/v1/auth/passkey/web/verify` | bootstrap + ceremony header | 実装済み |

optionsの成功レスポンスは`data.ceremony_token`と`data.options`。verifyでは`X-Passkey-Ceremony-Token`ヘッダーへtokenを入れ、bodyはOSのcredential/assertion JSONをそのまま送る。challengeは5分・一回限り。ブラウザ検証はHTTPSまたはlocalhost、native実機検証はExpo GoではなくDevelopment Buildを使う。

reauthは既存sessionのユーザーに対するPasskey assertionを検証し、成功時に`sessions.last_passkey_at`だけを更新する。新しいsessionやtokenは発行しない。Key-B、退会、Recoveryなどの高権限APIはこの直近認証境界を要求する。

### セッション

| Method | Path | 認証 | 状態 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/refresh` | Refresh body | 実装済み |
| POST | `/api/v1/auth/logout` | Access Token | 実装済み |
| POST | `/api/v1/auth/logout-all` | Access Token | 実装済み |
| GET | `/api/v1/me/sessions` | Access Token | 実装済み |
| DELETE | `/api/v1/me/sessions/{session_id}` | Access Token | 実装済み |

Refresh request:

```json
{
  "refresh_token": "opaque-token",
  "request_id": "client-generated-id"
}
```

互換のため`refresh_request_id`も受理する。Access TokenはHS256 JWS-JWTで1分、sessionは絶対90日・アイドル30日。Refresh Tokenは32byte乱数で、DBにはhashだけを保存する。更新ごとにrotationし、同じrequest IDだけ30秒再送可能。別request IDの使用済みtokenはreuseとしてsession family全体を失効し、409を返す。

### プロフィール（バックエンド実装済み・編集UIの完全同期は未完了）

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/me` | 自分のプロフィール取得 |
| PATCH | `/api/v1/me/profile` | 名前、国籍、自己紹介の更新 |

`PATCH`の入力は`name`、`nationality_code`、`bio`です。名前は最大64、bioは最大1000 Unicode code points、国コードは大文字2文字です。指定しない項目は既存値を維持しますが、完成プロフィールでは名前と国コードが必須です。名前は次回以降のPasskey登録表示名にも同期しますが、既存PasskeyのOS表示名は変更されません。本人確認状態・いいね数・アイコン参照はこのAPIから更新できません。成功時は`{ "data": { ... } }`、不正値は`400 invalid_profile`です。

### 募集・検索・マッチ（バックエンド実装済み。フロント接続コードあり・iOS実機E2E未確認）

| Method | Path | 用途 |
| --- | --- | --- |
| POST | `/api/v1/recruitments` | 募集作成 |
| GET | `/api/v1/recruitments` | 現在地・日時・keywordで検索 |
| GET | `/api/v1/recruitments/mine` | 自分が作成した募集一覧 |
| GET | `/api/v1/recruitments/{id}` | 募集詳細 |
| PATCH | `/api/v1/recruitments/{id}` | 募集更新 |
| DELETE | `/api/v1/recruitments/{id}` | 募集をclosed化 |
| POST | `/api/v1/recruitments/{id}/interest` | 関心を送る |
| GET | `/api/v1/matches?role=owner&status=pending&limit=50` | 自分の募集への応募一覧 |
| GET | `/api/v1/matches/{id}` | 参加者向けマッチ詳細 |
| POST | `/api/v1/matches/{id}/accept` | カード所有者が承認 |
| POST | `/api/v1/matches/{id}/reject` | カード所有者が辞退 |
| POST | `/api/v1/matches/{id}/withdraw` | 応募者がpendingの関心を取り下げ |
| POST | `/api/v1/matches/{id}/complete` | 参加者が完了 |
| POST | `/api/v1/matches/{id}/meeting` | 承認済みマッチの会合セッション作成 |
| POST | `/api/v1/me/location` | 現在地を1時間保存 |

募集は`Food` / `Places` / `Activity` / `Other`、公開半径は1/3/5kmに限定します。利用日・開始／終了時刻は`Asia/Tokyo`固定で扱い、timezoneを省略または空にした入力はJSTへ正規化し、他のtimezoneは拒否します。検索結果とカード詳細に正確な緯度・経度は含めず、位置が利用できる場合だけ`distance_band`を返します。現行はGoのHaversine計算で、PostGISは未導入です。募集フローの接続コードはありますが、iOS初期表示の`invalid_recruitment_date`報告があるため、実機での公開成功は未確認です。重複関心は`409 interest_already_sent`、期限切れは`409 recruitment_expired`、ブロック関係は404相当で返します。

## 3. 追加・未完了API

### プロフィール・本人確認

| Method | Path | 用途 |
| --- | --- | --- |
| POST | `/api/v1/me/verification` | 本人確認開始 |

### 評価・本人確認

| Method | Path | 用途 |
| --- | --- | --- |
| POST | `/api/v1/matches/{id}/reviews` | 相互評価 |
| POST | `/api/v1/me/verification` | Stripe Identity等の本人確認開始 |

本人確認済みマークは、クライアントの戻り値ではなく、署名検証済みWebhookを受けたバックエンドだけが設定します。

### 通知（バックエンドREST・フロント画面接続済み）

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/notifications?unread_only=false&limit=50` | 直近7日間の自分の通知一覧 |
| POST | `/api/v1/notifications/{id}/read` | 通知を既読にする |

応募、承認・辞退、暗号化チャットメッセージ送信時にサーバーで通知を作成します。通知画面の表示文はクライアント側で日本語／英語に変換し、チャット本文は保存・表示しません。現状はアプリ内REST通知であり、OSプッシュ通知は未実装です。

### チャット・会合（バックエンドREST実装済み・フロント未接続）

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/chats` | チャット一覧 |
| GET | `/api/v1/chats/{id}/messages` | 暗号化メッセージ履歴 |
| POST | `/api/v1/chats/{id}/messages` | E2EE暗号文の送信 |
| POST | `/api/v1/chats/{id}/read` | 既読更新 |
| POST | `/api/v1/chats/{id}/transport-token` | 対象chat専用短命token |
| GET | `/api/v1/meetings/{id}` | 会合セッション取得 |
| POST | `/api/v1/meetings/{id}/start` | 会合開始 |
| POST | `/api/v1/meetings/{id}/end` | 会合終了 |
| GET | `/api/v1/meetings/{id}/proximity` | 直近の距離補助値 |
| POST | `/api/v1/meetings/{id}/proximity` | Bluetooth／位置推測の補助値送信 |

チャット送信は`accepted`マッチの参加者だけが行え、平文ではなくBase64URLのAES-256-GCM暗号文だけを保存します。同じ`client_message_id`の再送は冪等です。現時点はRESTの履歴取得・送信・既読と短命transport tokenまでで、QUICのリアルタイム配送は未実装です。QUICが一時的に利用できない場合はRESTのポーリングへフォールバックし、WebSocketへの切替はチーム合意なしには行いません。距離補助値はクライアント推定であり、本人確認や安全判定には使いません。

### 画像・鍵（実装済み）

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/keys/profile-image` | RSA-OAEP-256公開JWK配信 |
| POST | `/api/v1/me/photos` | 端末でAES-256-GCM暗号化した暗号文を保存 |
| GET | `/api/v1/me/photos/{id}` | 所有者向け暗号文を配信 |
| DELETE | `/api/v1/me/photos/{id}` | DB、privateファイル、cacheを削除 |
| GET | `/api/v1/profile-photos/{id}` | profile画像だけをサーバー復号して配信 |
| GET | `/api/v1/me/key-envelopes` | Access Tokenと5分以内のPasskey再認証が必要なroot-key envelope一覧 |
| PUT | `/api/v1/me/key-envelopes/{key_version}` | Access Tokenと5分以内のPasskey再認証が必要なroot-key envelope保存・version更新 |
| GET | `/api/v1/me/key-envelopes/{key_version}` | Access Tokenと5分以内のPasskey再認証が必要な指定version取得 |
| DELETE | `/api/v1/me/key-envelopes/{key_version}` | Access Tokenと5分以内のPasskey再認証が必要な指定version削除 |
| POST | `/api/v1/me/devices` | Access Tokenと5分以内のPasskey再認証が必要な端末公開鍵登録 |
| GET | `/api/v1/me/devices` | Access Tokenと5分以内のPasskey再認証が必要な端末メタデータ一覧 |
| POST | `/api/v1/auth/recovery/challenge` | pre-authまたはAccess Token + 5分以内のPasskey再認証でRecovery challenge取得 |
| POST | `/api/v1/auth/recovery/verify` | 同じ認証主体のchallengeにRecovery Phraseで復号したroot由来の署名を提示 |
| DELETE | `/api/v1/me` | Access Tokenと5分以内のPasskey再認証、およびconfirm付きの退会・完全削除 |

画像平文、画像鍵、Master Key、Key-B、Recovery PhraseはAPIログへ出さない。Key-Bは端末ごとにSecure Storageへ生成・保存し、サーバーへは公開鍵と`device_id`だけを登録する。private画像の各リクエストは端末Key-B由来の署名、時刻、ワンタイムnonce、body hashを要求し、サーバー単独で画像を復号できない。`KEY_B_WRAP_KEY`やサーバーからのKey-B取得APIは使用しない。Key-Bは画像鍵の包みと端末proofに、Master Keyはアカウントrootの包みに、Recovery Phraseはv2 root envelopeの包みに用途を分離する。Recovery challengeはhashのみをDBに保存し、TTL・最大5回の検証試行・1時間あたり10回の発行制限を設ける。profile画像はサーバー公開鍵で画像鍵をwrapして互換配信し、private画像は端末側鍵を使う。画像uploadの正確な`X-Photo-*`ヘッダーは [backend/API_SPEC.md](../backend/API_SPEC.md) を参照する。

Chat Tokenの発行部品はAccess TokenやRefresh Tokenと別audienceのJWSで対象chat・sessionに束縛しますが、現行のリアルタイム配送は未実装です。HTTP handlerの既定`quic`とチャットサービスの受理値`websocket`／`webtransport`が不一致のため、既定経路もコード整合まで動作済みとみなしません。現時点はRESTで、Refresh Tokenをtransportへ送らない契約、同じ`client_message_id`による冪等再送を維持します。正確なbody形式、TTL、暗号文サイズは [backend/API_SPEC.md](../backend/API_SPEC.md) のチャット節を参照する。

## 4. Token更新タイミング

1. アプリ起動時とフォアグラウンド復帰時はsingle-flightでRefreshし、保存済みRefresh Tokenからメモリ上のAccess Tokenを復元する。
2. 通常の保護APIが`401 missing_or_invalid_access_token`を返した場合も、同じsingle-flight Refreshを一度だけ実行して元のリクエストを一度だけ再試行する。401以外や403の再認証要求はRefreshで迂回しない。
3. 通信結果が不明なら同じ`request_id`で30秒以内に再送する。
4. 新tokenのSecure Storage保存後に旧tokenを置き換える。更新中のAPI呼び出しは同じ更新Promiseを共有する。
5. Refresh失敗、409 reuse、session失効時はAccess/Refreshを削除し、GoogleまたはPasskeyへ戻る。
6. バックグラウンド中に定期Refreshしない。Passkeyブラウザからの復帰時はhandoff交換の完了後にだけフォアグラウンドRefreshを行う。

端末登録、root-key envelope、Recoveryのsession経路、退会はRefreshだけでは許可せず、直近Passkey再認証を要求する。Recoveryの新端末経路はGoogle後の短命pre-authに限定し、challenge開始とverifyで同じpre-auth hash・scope・userを再検証する。端末画像APIはAccess Tokenだけで完結させず、端末Key-Bのproofも要求する。

### クライアント所有鍵・機種変更（v2）

暗号鍵の最終設計と脅威モデルは [proton-style-key-management/proposal.md](ai/security/proton-style-key-management/proposal.md) を参照する。
この節のAPIは、サーバーがMaster Keyを復号できないことを前提に、端末間で暗号文envelopeを中継する。

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| POST | `/api/v1/me/devices` | Access Token + 直近Passkey | Ed25519 Key-B公開鍵と任意のX25519合意公開鍵を登録 |
| GET | `/api/v1/me/devices` | Access Token + 直近Passkey | 端末公開メタデータ一覧 |
| POST | `/api/v1/me/device-transfers` | Access Token + 直近Passkey + 対象端末proof | 新端末向け移行要求を作成 |
| GET | `/api/v1/me/device-transfers` | Access Token + 直近Passkey + 端末proof | 保留中の移行要求を取得 |
| GET | `/api/v1/me/device-transfers/{id}` | Access Token + 直近Passkey + 対象端末proof | 対象端末が包み済みMaster Keyを取得 |
| POST | `/api/v1/me/device-transfers/{id}/approve` | Access Token + 直近Passkey + 旧端末proof | ユーザー確認済みのopaque envelopeを登録 |
| POST | `/api/v1/me/device-transfers/{id}/complete` | Access Token + 直近Passkey + 対象端末proof | 新端末の復号・保存完了を通知 |

作成bodyは`target_device_id`、`target_key_version`、`target_public_key`、`verification_code`です。コードの平文はDBへ保存せず、サーバーはtarget公開鍵の差し替えを承認bodyから受け付けません。approve bodyの`wrapped_master_key`はX25519 + HKDF-SHA256 + AES-256-GCMのopaque envelopeで、APIは形式と宛先公開鍵だけを検証します。コードは端末間の取り違え防止用であり、サーバー侵害への対抗にはユーザーがfingerprintを照合するかQR/OOBで公開鍵を直接確認する必要があります。

移行要求は15分で失効し、ユーザーごとの同時保留数を制限します。GETは`pending`中にwrapped値を返さず、`approved`または`completed`の対象端末にだけ返します。Access Tokenだけ、別ユーザーのdevice ID、期限切れ・再利用・不一致proofでは移行できません。

v2のRecovery envelopeは24語Recovery Phraseのentropyを端末内でArgon2id + HKDF-SHA256に通してMaster KeyをAES-256-GCMで包みます。phrase自体、Master Key、Key-B平文はAPIへ送信しません。root-key protocolはv2だけを受け付けます。`/me/key-envelopes/{key_version}`で旧versionを指定した要求は`410 legacy_key_version_disabled`、移行後に旧envelopeしかないアカウントのRecovery challengeは`409 recovery_not_configured`です。pre-release migration `0022_disable_legacy_root_keys.sql`で旧envelopeと旧Key-B materialを削除するため、古い開発アカウントはv2鍵登録をやり直してください。Recovery成功後は新しいPhraseを表示し、ユーザー確認後にenvelopeを保存します。保存に失敗した場合は端末内のpending materialを残し、成功時だけ旧Phraseを無効化します。

## 5. 実装変更時の同期対象

APIを実装・変更したら、次を同じ変更で更新する。

- `backend/API_SPEC.md`
- `docs/features/<feature>.md`
- `docs/database.md`とmigration
- `backend/STATUS.md` / `backend/TODO.md`
- Go単体・PostgreSQL統合・Python smoke・Expo typecheck
