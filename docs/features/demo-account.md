# 設計書：審査・お試し用 Demo アカウント

最終更新: 2026-09-02
状態: 設計のみ（未実装）

## 1. 目的

ハッカソンの審査・短時間のお試しに限り、Google ログインなしで利用できる
**実DB上の一時アカウント**を提供する。

画面、画面遷移、プロフィール、募集、応募、マッチング、チャットの体験は
通常アカウントと同じものを使う。ローカルfixture、モックデータ、専用の
ショーケース画面は使用しない。

通常アカウントの認証・暗号鍵・データには影響を与えないことを最優先とする。

## 2. 適用範囲と非目標

### 対象

- 審査用 Expo Go ビルドと、そのビルドが接続する Demo 環境
- 作成から24時間だけ有効な `demo` アカウント
- `demo` アカウント同士の募集、応募、承認、チャット
- 通常の Key-A / Key-B 準備画面を使った高速なデモ用鍵生成

### 非目標

- 本番サービスの一般向けトライアル機能
- Demo アカウントから通常アカウントへの昇格・引き継ぎ
- Demo アカウントと通常アカウントの相互利用
- 通常アカウント用の Argon2id、Passkey、Recovery Key 契約の変更
- Demo 用暗号を通常アカウントの暗号方式へ移行すること

Demo 用の暗号方式は、画面上で暗号鍵の準備を体験させるためのものであり、
本番アカウントと同じセキュリティ保証を持つものとして表示・説明してはならない。

## 3. 用語と不変条件

| 用語 | 定義 |
| --- | --- |
| `regular` | Google / Passkey を使う通常アカウント |
| `demo` | 審査・お試し専用の24時間アカウント |
| `demo_expires_at` | Demo アカウントの絶対失効時刻。UTC RFC3339 |
| `demo-keyb-v1` | Demo の端末 Key-B 用鍵バージョン |
| `demo-chat-v1` | Demo チャット本文用鍵バージョン |

必ず次の不変条件を維持する。

1. `users.account_type` は作成後に変更できない。
2. `regular` は `demo_expires_at IS NULL`、`demo` は有効な期限を持つ。
3. `demo` の有効期限はクライアント時刻ではなくサーバー時刻で判定する。
4. `demo` と `regular` のユーザー間に、検索結果、応募、match、chat、添付、通知を作らない。
5. 暗号鍵、Recovery Phrase、Access Token、Refresh Tokenをログ・URL・分析イベントへ出さない。
6. Demo の暗号文を通常の鍵バージョンとして受け付けない。
7. 暗号化に失敗した場合、平文送信へフォールバックしない。

## 4. 実行環境の分離

本番への影響を避けるため、Demo は本番の公開サービスとは別環境で運用する。

### 必須構成

- Expo Go の審査ビルドは Demo API Base URL を明示的に持つ。
- Demo API は Demo 用 PostgreSQL、セッション署名鍵、ログ領域、ストレージを使う。
- Demo API のDBユーザーに本番DBへの権限を与えない。
- `APP_ENV=production` では `DEMO_ACCOUNT_ENABLED` を既定値 `false` とする。
- 本番起動時に Demo 機能が誤って有効なら、起動を失敗させる。
- API接続先が使えない場合に、本番APIへ自動フォールバックしない。

同一クラスタを使わざるを得ない場合も、DB、DBロール、ストレージprefix、
セッション署名鍵は分離する。アプリケーション層のスコープ検査だけを分離策の根拠にしない。

### Feature Flag

| 設定 | 既定値 | 用途 |
| --- | --- | --- |
| `DEMO_ACCOUNT_ENABLED` | `false` | バックエンドのDemo発行APIとDemo機能を有効化 |
| `EXPO_PUBLIC_DEMO_ACCOUNT_ENABLED` | `false` | 審査用クライアントの入口ボタンを表示 |
| `EXPO_PUBLIC_API_BASE_URL` | 通常値 | DemoビルドではDemo APIを明示指定 |

フラグが片側だけ有効でも利用できないようにする。クライアントだけでフラグを
判定せず、発行APIでもサーバー側フラグを確認する。

## 5. アカウント発行と24時間期限

### 5.1 発行API（予定）

`POST /api/v1/auth/demo/start`

認証不要。ただし Demo 環境のレートリミットと `DEMO_ACCOUNT_ENABLED` を必須とする。

Request:

```json
{
  "language": "ja",
  "app_mode": "local"
}
```

`language` と `app_mode` は許可値だけを受け付け、ユーザーID、期限、アカウント種別を
クライアントから指定させない。

Response の `data` は通常ログイン後の `Session` と同じトークン契約に、次を追加する。

```json
{
  "data": {
    "user_id": "opaque-demo-user-id",
    "session_id": "opaque-session-id",
    "access_token": "短命Access Token",
    "refresh_token": "opaque Refresh Token",
    "account_type": "demo",
    "demo_expires_at": "2026-09-03T12:00:00Z"
  }
}
```

サーバーは内部で次をtransactionとして行う。

1. 暗号学的乱数のopaque user IDを生成する。
2. `users.account_type = 'demo'`、`demo_expires_at = now + 24h`でユーザーを作る。
3. OAuth用の既存Google subjectとは衝突しない内部subjectを生成する。
4. 同じ期限を上限とするsessionとRefresh Tokenを作る。
5. `account_type`と期限を含む応答を返す。

Demo 発行APIは既存の Google exchange / Passkey exchange と共有しない。
Demo のユーザーにGoogle subjectやPasskey credentialを後付けするAPIも作らない。

### 5.2 期限検査

次のすべてで `demo_expires_at > server_now` を確認する。

- Access Tokenの認証
- Refresh Tokenの更新
- 募集、応募、match、chat、写真、通知の各API
- WebSocket / Chat Tokenの発行と接続
- WebTransportを追加する場合の接続認可

期限切れのRefresh Tokenから、通常の90日セッションへ延長してはならない。
期限切れは `401 demo_account_expired` とし、クライアントはDemo入口へ戻す。

期限後は論理的に利用不可とし、Demo専用のスイープでsession、鍵メタデータ、
Demoユーザーの業務データを削除する。スイープは `account_type = 'demo'` を条件にし、
通常ユーザーを対象にできないクエリ構造とテストを持たせる。

## 6. 画面とフロー

### 6.1 共有するもの

Demo 入口以降は、通常アカウントと同じ画面コンポーネント、route、APIサービスを使う。

- プロフィール設定
- 通常のホーム画面
- 募集一覧・募集詳細
- 応募・承認・マッチ成立
- チャット一覧・チャット詳細
- Key-B / Recovery Phrase の準備、表示、コピー、再入力確認、完了

画面を `DemoMode` のような別の画面ツリーへ分岐させない。分岐は認証後の
暗号鍵プロバイダーとDemo用APIの選択だけに限定する。

### 6.2 Demoで異なるもの

- Google OAuthとPasskey本人確認は行わない。
- Key-B準備画面の内部実装はDemo用プロバイダーを使う。
- 画面上には「審査用アカウント / 24時間有効」と明示する。
- Demoアカウントから通常アカウントのデータへ遷移できない。

Passkeyの省略は本人確認を弱めるためではなく、Demoアカウントを通常アカウントと
別のアカウント種別として発行するための設計上の差分である。

## 7. 高速なDemo Key-B設計

### 7.1 方針

Argon2idのパラメータを安全性の低い値へ下げるのではなく、256ビットのランダム
エントロピーから作るDemo用鍵へ分離する。ユーザーが決める短いパスワードを高速KDFで
処理する設計にはしない。

Expo Goで動く既存の純JSライブラリを使う。

- `@noble/hashes`: HKDF-SHA-256、SHA-256
- `@noble/ciphers`: AES-256-GCM
- `@noble/curves`: X25519
- 乱数: 既存crypto serviceの安全な乱数API

新しいネイティブ暗号モジュールをDemoのためだけに追加しない。

### 7.2 Key-B画面で行う処理

既存のKey-B / Recovery Phrase画面の表示・確認フローを維持し、プロバイダーだけを
次のように切り替える。

1. 端末内で32バイトのランダムエントロピーを生成する。
2. 既存の24語Recovery Phrase表示・コピー・再入力確認を行う。
3. Phrase自体はAPIへ送らず、確認後に端末のSecure Storageへ保存する。
4. HKDF-SHA-256のdomain separationでDemo Key-AとDemo Key-Bを導出する。
5. Key-Bからチャット用X25519合意鍵を導出し、公開鍵だけをDemo APIへ登録する。
6. 完了画面を表示して、通常と同じホーム画面へ遷移する。

導出の概念契約は次のとおりとする。

```text
demo_key_a = HKDF-SHA256(entropy, salt, "samurai-meet/demo/key-a/v1", 32)
demo_key_b = HKDF-SHA256(entropy, salt, "samurai-meet/demo/key-b/v1", 32)
agreement_private = HKDF-SHA256(demo_key_b, empty, "samurai-meet/demo/agreement/v1", 32)
agreement_public = X25519.publicKey(agreement_private)
```

実装では中間鍵とエントロピーを処理後にメモリから消去する。通常用の
`Argon2id+HKDF-SHA256` envelope、Key-A、Key-Bの保存形式をDemo形式で上書きしない。

### 7.3 Demo鍵API（予定）

`POST /api/v1/me/demo/device-key`

- Bearer Access Token必須
- `account_type = demo` と期限を確認
- `key_version = demo-keyb-v1` のみ受け付ける
- 公開鍵は32バイトのBase64URLだけを受け付ける
- 秘密鍵、Recovery Phrase、Key-B本体を受け付けない
- 通常の `/me/devices` と通常のKey envelope APIへDemoを流さない

Key-B準備画面の状態機械は共有するが、通常用サービスとDemo用サービスの境界は
TypeScriptの型とAPIパスで明確に分ける。

## 8. Demoチャット暗号

### 8.1 鍵共有

マッチ成立後、`GET /api/v1/chats/{id}/demo/peer-key` で、同じDemoチャットの
相手の公開鍵だけを取得する。エンドポイントは次を満たさない場合に拒否する。

- 呼び出しユーザーが有効なDemoアカウントではない
- chatがacceptedではない
- 参加者2人がともに `demo`
- 相手のDemo公開鍵が未登録、失効、または期限切れ

クライアントは次の共有鍵を端末内で導出する。

```text
shared = X25519(local_agreement_private, peer_agreement_public)
chat_key = HKDF-SHA256(
  shared,
  SHA256("samurai-meet/demo-chat/v1/" + chat_id),
  "samurai-meet/demo-chat/key/v1",
  32
)
```

X25519秘密鍵と共有鍵はAPIへ送らない。サーバーは公開鍵、暗号文、nonce、
アルゴリズム名、鍵バージョンだけを扱う。

### 8.2 メッセージ

- 暗号: AES-256-GCM
- `key_version`: `demo-chat-v1`
- nonce: メッセージごとに安全な乱数で12バイト
- AAD: chat ID、鍵バージョン、content typeを含める
- 本文・位置情報・添付の暗号化に失敗したら送信を中止する
- 通常の `chat-keyb-v1` と相互変換・相互復号しない

Demoも送信前のモデレーションや翻訳を有効にする場合、それらは既存仕様と同じ
平文例外である。したがってDemoチャットも完全E2EEとは表示しない。

## 9. マッチングのスコープ強制

### 9.1 対象操作

次のすべてで、参加者・募集所有者の `account_type` と有効期限を確認する。

- 募集検索、募集一覧、募集詳細
- 募集作成、応募、応募取り消し
- match一覧、match詳細、承認、拒否、完了
- chat threadの作成、一覧、詳細
- チャット本文、既読、編集、削除、transport token、WebSocket
- 写真添付、画像鍵受領者一覧、添付取得
- 通知、通報、ブロックなど、対象ユーザーやmatchを参照する処理

### 9.2 実装位置

UIのフィルターだけでは不十分なため、次の三層で実装する。

1. **DBクエリ条件**: 所有者と閲覧者のscope一致を `JOIN` / `WHERE` に含める。
2. **サービス層**: `RequireCompatibleAccountScope(viewer, other, now)` を共通化し、
   mutationの入口で再検査する。
3. **HTTP / WebSocket層**: claimsのユーザーIDだけを信頼せず、DBでユーザー種別・期限・
   match参加者を解決してから処理する。

概念的な条件は次のとおり。

```sql
viewer.account_type = other.account_type
AND viewer.status = 'active'
AND other.status = 'active'
AND (viewer.account_type <> 'demo' OR viewer.demo_expires_at > :server_now)
AND (other.account_type <> 'demo' OR other.demo_expires_at > :server_now)
```

検索結果では異なるscopeの行を存在しないものとして除外する。直接IDを指定した
resource readでも、scope不一致は同じ `404 not_found` として返し、存在確認による
ユーザー列挙を助けない。mutationでcross-scopeを作ろうとした場合もtransactionを
commitしない。

### 9.3 DB制約と既存データ

新規migrationは既存の通常ユーザーを次の既定値で保護する。

- `users.account_type`: `regular` を既定値とする。
- `users.demo_expires_at`: 通常ユーザーはNULL。
- `demo_device_keys`: Demo専用の公開鍵テーブル。通常の `devices` と混在させない。
- `users(account_type, demo_expires_at)` に期限検索用indexを追加する。

migration前にcross-scope matchが存在しないことを検査する。存在した場合は自動削除や
自動修復をせず、migrationを失敗させて運営判断を要求する。

## 10. 本番影響を防ぐ実装境界

- 通常のAuth / Key-B / Recovery / device APIの成功条件は変更しない。
- 通常用暗号定数 `chat-keyb-v1` とDemo用定数を同じ分岐で上書きしない。
- Demo用コードは `demo` パッケージ、`demo` APIパス、`demo`鍵バージョンへ分離する。
- Demoセッションを通常のPasskey、Recovery、device transferへ渡さない。
- 通常ユーザーの検索・matchクエリにDemo行が混ざらないことをSQLテストで確認する。
- Demo APIのfeature flagが無効なとき、発行APIはルーティングされないか明示的に拒否する。
- ログは `account_type` とイベント種別だけを持ち、token、鍵、Phrase、本文を持たない。
- 本番デプロイではDemo DB、Demo署名鍵、Demo URLが設定されていないことをCIで検査する。
- Demo機能の障害時に通常ログインへ自動転送しない。

## 11. テストと受け入れ条件

### Backend

- 通常ユーザー作成時に `account_type = regular` となる。
- Demo発行時の期限が24時間で、クライアント指定値を無視する。
- 期限境界でAccess / Refresh / Chat Tokenが拒否される。
- Demo同士の検索、応募、承認、chatが成功する。
- Demoから通常募集を検索・取得・応募できない。
- 通常ユーザーからDemo募集を検索・取得・応募できない。
- 直接ID指定、chat、WebSocket、添付でもcross-scopeを拒否する。
- Demo暗号バージョンを通常ユーザーが保存・送信できない。
- 通常の `chat-keyb-v1` が既存テストどおり動く。
- 期限切れスイープが通常ユーザーの行を削除しない。

### Frontend / Expo Go

- Demo入口以降の画面コンポーネントとrouteが通常利用時と同一である。
- Key-B / Recovery Phraseの表示・コピー・再入力・完了フローを体験できる。
- Demoの鍵生成経路でArgon2idやPasskeyを呼ばない。
- 2つのDemoアカウントで暗号文の暗号化・復号が往復できる。
- peer key未取得時に平文送信しない。
- Demoセッション失効時に再試行ループや通常ログインへの誤遷移が起きない。
- 対象Expo Go端末でKey-B準備時間を計測し、重いKDFが実行されていないことをログ・
  テストで確認する。

### リリースゲート

次のいずれかが未確認なら、Demo実装を本番公開済みとは扱わない。

1. Demo環境の二端末E2Eで、Demo同士のmatchとchatが成功している。
2. 通常ユーザーとのcross-scope操作がAPIで拒否されている。
3. 本番設定でDemo発行APIとDemoボタンが無効である。
4. 通常アカウントの既存認証・鍵・チャット回帰テストが通っている。
5. ログ、DB、ネットワークキャプチャの確認で秘密鍵・Phrase・tokenが漏れていない。

## 12. 実装順序

1. additive migrationとaccount scope読み取りを追加する。
2. Demo専用発行API、期限検査、Demo専用公開鍵APIを追加する。
3. matching / chat / attachmentの全入口へscope guardを追加する。
4. フロントの専用モック画面を削除し、既存KeySetupへDemo crypto providerを接続する。
5. `demo-chat-v1` の暗号化・復号を既存チャット画面へ接続する。
6. Backend、Frontend、Expo Go二端末でテストする。
7. Demo環境を有効化し、本番環境の無効設定を検証する。

関連仕様: [認証](auth.md)、[マッチング](matching.md)、[チャット](chat.md)、
[データベース](../database.md)、[API仕様](../api.md)
