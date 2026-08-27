# セキュリティ設計監査（履歴）

> 本書は2026-08-24時点の設計・実装差分レビューの履歴であり、現在のリリース承認やリポジトリ全体の安全性を示すものではありません。現行実装の境界は [docs/ai/system/current-status.md](ai/system/current-status.md) と [backend/API_SPEC.md](../backend/API_SPEC.md) を参照してください。QUIC、PostGIS、OSプッシュ通知、本人確認、評価、通報は現行未実装または未確定です。

## 監査情報

| 項目 | 内容 |
| --- | --- |
| 対象 | `docs/` 配下の認証、セッション、API、DB、QUIC、画像、位置情報仕様 |
| 実施日 | 2026-08-24 |
| 監査範囲 | 設計・実装差分・Go/Bun自動検査レビュー |
| ソースコード | 認証、session、OAuth、Passkey API、画像、開発クライアントを対象 |
| 判定 | 当時の設計判定。現行の本番リリース承認ではない |

> 本書の PASS は、仕様上の対策が記載されていることを示します。実装が安全であることを示すものではありません。

今回の検査では、CIと同じ`gosec v2.28.0 -exclude-generated ./...`が`Issues: 0`、Goのtest/vet/build、PostgreSQL統合テスト、Expo/フロントのTypeScript検査、Bun監査が成功しました。Bun監査は既存の期限付き例外だけを許可しています。これは本番リリース承認ではなく、残りのP1項目は下記のとおりです。

## 1. 総合判定

自動トークン更新は採用して問題ありません。ただし、次の構成を守ることが条件です。

1. Access Token は短命な JWS 署名付き JWT とする。
2. JWT の署名検証だけで認証を完了させず、DB の `sessions` を毎回確認する。
3. Refresh Token は端末の Secure Storage に保存し、DB にはハッシュだけを保存する。
4. Refresh のたびにローテーションし、使用済み token の再利用時は token family を失効する。
5. ログアウト・端末失効・アカウント停止は DB を正本として即時反映する。
6. 将来QUICを実装する場合は、接続時・heartbeat時にセッションを再検証する。現行チャットはRESTである。

## 2. 監査チェックリスト

| 監査 ID | 項目 | 判定 | コメント |
| --- | --- | --- | --- |
| SEC-001 | JWS / JWT の署名検証 | PASS | `iss`、`aud`、`iat`、`exp`、署名を検証する仕様がある |
| SEC-002 | JWT の失効確認 | PASS | `sid` から `sessions` を確認する仕様がある |
| SEC-003 | Refresh Token の平文保存禁止 | PASS | DB はハッシュのみ、端末は Secure Storage と定義 |
| SEC-004 | Refresh Token ローテーション | PASS | 使用ごとに新 token を発行する仕様がある |
| SEC-005 | Refresh Token 再利用検知 | PASS | 再利用時に token family を失効する仕様がある |
| SEC-006 | 自動更新のタイミング | PASS* | 残り30秒、アプリ復帰、401を実装対象とする。QUIC再接続時の更新は将来配送実装時の設計 |
| SEC-007 | 同時 Refresh の抑制 | PASS | クライアントの single-flight を定義 |
| SEC-008 | 通信失敗時の Refresh 再送 | PASS | 同じ`session_id`・`request_id`だけ30秒以内に暗号化済み結果を再返却 |
| SEC-009 | Google 直後の権限分離 | PASS | Google handoff交換は通常sessionを発行せず、Passkey専用pre-authだけを返す |
| SEC-010 | `pre_auth_token` の一回性 | PASS* | PostgreSQLでhash、scope、user、5分期限、used_atを管理する。Web Passkeyのcredential/session作成とpre-auth hash消費は同一transaction。bootstrap消費とhandoff作成は後段の別transactionで、失敗時の再試行性は追加課題 |
| SEC-011 | JWS 署名鍵のローテーション | PARTIAL | `kid`、HS256 allow-list、複数検証鍵と旧鍵検証の単体テストは実装済み。KMS運用・移行期間・漏えい時手順は未確定 |
| SEC-012 | QUIC の失効反映 | 未実装 | heartbeatと切断は設計のみ。QUIC／WebTransport配送自体が未実装 |
| SEC-013 | 端末Key-Bの信頼境界 | PASS* | Key-Bは端末Secure Storageだけに生成・保存し、サーバーはEd25519公開鍵だけを持つ。画像APIは端末proof、5分以内のtimestamp、DB nonce再利用防止、body hashを検証する。Recovery後はKey-A由来の画像wrapperから端末envelopeを再登録する。native実機、KMS不要の運用監査、legacy画像移行は別途確認が必要 |
| SEC-014 | Refresh API のレート制限 | PARTIAL | 認証系制限はあるが、token hash・IP・端末単位の値が未確定 |
| SEC-015 | 端末保存領域 | PASS | Refresh Token は Secure Storage、Access Token は短期利用 |
| SEC-016 | ログへの秘密情報混入 | PASS | token、Key-A、Key-B、Recovery Key をログ出力しない仕様 |
| SEC-017 | PostgreSQL の競合制御 | PASS | Refresh Token は行ロックとトランザクションで競合を防ぐ方針 |
| SEC-018 | 位置情報・写真の公開範囲 | PASS | 正確な位置を返さず、画像ストレージも非公開と定義 |
| SEC-019 | チャット専用 token | PARTIAL | Goに短命tokenの発行部品はあるが、HTTP handler既定の`quic`とサービス受理値`websocket`／`webtransport`が不一致。配送も未実装 |
| SEC-020 | QUIC 0-RTT の再送 | P1 | 1-RTT 前の状態変更禁止と実装テストが必要 |
| SEC-021 | QUIC / Expo 実装可否 | P1 | native module / WebTransport の PoC が未実施 |
| SEC-022 | Web Passkey URL秘密値境界 | PASS | URL fragmentは短命bootstrap tokenだけ。Access/Refresh/pre-authはURLへ渡さず、verifyはhandoff codeだけを返す |

## 3. P1 必須対応

### SEC-008 Refresh 通信失敗時の再送（実装済み）

Refresh はローテーションするため、サーバーが更新に成功した後、レスポンスだけが失われるケースを考慮する必要があります。古い Refresh Token をそのまま再送すると、正当な再試行でも token reuse と判定され、セッション全体が失効する可能性があります。

採用した方式は `request_id` とサーバー側の冪等性記録です。同一 `session_id`・`request_id` の再送だけ 30 秒間同じ結果を返し、レスポンスは暗号化して保存します。Refresh Token の平文は DB に保存しません。別のrequest IDで使用済みtokenが来た場合はreuseとしてsession familyを失効します。

ここで重要なのは、旧 Access Token と旧 Refresh Token を分けることです。旧 Access Token は自身の `exp` まで自然に有効ですが、旧 Refresh Token は同じ冪等リクエスト以外では即時に reuse として扱います。

### SEC-010 `pre_auth_token`（実装済み）

`pre_auth_token` は通常 API に使えないよう、次を必須にします。

- 有効期限は 5 分以内。
- `aud = passkey`、scope は Passkey 登録・認証だけ。
- 一回使用したら DB 上で失効。
- `user_id` と OAuth 認証イベントに紐付ける。
- Access Token、Refresh Token、プロフィール、チャット、Key-B を取得できない。

実装では`pre_auth_tokens`にtoken hashだけを保存し、5分期限、scope、user、`used_at`を検証します。Google交換時は通常sessionを発行せず、Passkey成功後に通常sessionを発行します。Web terminal flowではcredential/session作成とpre-auth hash消費を同一transactionにまとめ、pre-authが無効化された場合にPasskey stateだけが残らないようにしています。bootstrap消費とhandoff作成は後段の別transactionであり、handoff失敗時の再試行性・孤児sessionのreconcilerは追加課題として追跡します。Expo GoはWeb Passkey後に、直近Passkey sessionから暗号化された短命session handoffを受け取ります。

### SEC-022 Web Passkey URL秘密値境界（実装済み）

- Expo GoはAccess Tokenまたはpre-auth tokenをBearerでbootstrap発行APIへ送る。
- bootstrapはhash、scope、元session/pre-auth、ceremony binding、期限、`used_at`で管理する。
- Web URL fragmentには`bootstrap_token`だけを入れる。
- Web options/verifyは`no-store`と`no-referrer`を返す。
- verify成功時は`handoff_code`とredirect URIだけを返し、Access/Refresh/pre-auth tokenをブラウザへ返さない。

### SEC-011 JWS 鍵管理（基盤実装済み）

- JWS header の `alg` を許可リストで検証し、`none` や想定外アルゴリズムを拒否する。
- header に `kid` を付け、検証鍵をバージョン管理する。
- 署名鍵は KMS / Secret Manager に保存し、リポジトリやアプリに埋め込まない。
- 鍵ローテーション時は現行鍵と直前鍵だけを短期間検証可能にする。
- 鍵漏えい時は該当 `kid` を無効化し、全セッション失効または再認証を行う。

実装は`JWS_KEY_ID`と`JWS_VERIFY_KEYS`で現行鍵と検証鍵を分離し、未知の`kid`、`none`、想定外algを拒否する。KMS/Secret Managerへの直接統合、鍵の有効期間、漏えい時のrunbookは本番前の未完了事項である。

### SEC-013 端末固有Key-B（実装済み）

- [x] Key-Bは端末で生成し、Secure Storage／Keychain／Keystoreから外へ出さない。サーバーは公開鍵と端末IDだけを保存する。
- [x] 端末登録は署名検証済みAccess Token、active DB session、5分以内のPasskey再認証に限定する。
- [x] 画像APIは端末Key-B由来の署名、timestamp、body hash、ワンタイムnonceを検証し、replayを拒否する。
- [x] Recovery後の新端末はKey-A由来の画像鍵wrapperから端末別envelopeを再登録できる。
- [x] 退会で端末、画像envelope、proof nonce、画像metadataを削除する。
- [ ] native実機のSecure Storage復元・端末移行・Key-B表示保護を確認する。
- [ ] legacy `key_b_materials` と旧画像行が残る環境の移行計画を確定する。

### 2026-08-24 Key-B差分監査

対象は`7004815..e71d585`のKey-B、直近Passkey認可、migration、統合テストである。Go test/vet/build、隔離PostgreSQL統合テスト、PR #3のGo/PostgreSQL/Expo/CodeQL/Secret/OSV/依存監査は成功した。Codex Securityプラグインの差分ランチャーはWindowsのCP932文字コード例外でscan IDを生成できなかったため、ここに手動差分監査の範囲と結果を記録する。

- [x] **P2 — 端末proofのcache・replay防止。** 端末画像APIは秘密値をレスポンスへ返さず、body hashと短いtimestamp、DB nonceでリクエストを固定する。
## 4. QUIC / WebTransport 設計監査（配送未実装）

以下は将来のQUIC／WebTransportを実装する際の検証条件であり、現行コードが満たしたことを示さない。現行のチャットはRESTの履歴取得・暗号文送信・既読である。

- QUIC の TLS 1.3 は通信路の機密性・完全性を提供するが、Samurai Meet のユーザー・マッチ・セッション認可はアプリケーション token で別途検証する。
- Chat Token は通常の Access Token と別の `aud`、`scope`、`chat_id` を持たせたJWSとする。JWSの署名は暗号化の代替ではなく、QUIC / TLS 1.3が通信路を保護する。
- `jti`、短い`exp`、`sid`、`chat_id`、token世代（配送実装時に追加）、セッション状態、接続数制限を組み合わせ、JWSの再利用によるリプレイを検知・抑止する。
- Refresh Token は QUIC / WebTransport 上へ送信しない。
- Chat Token は通常の Access Token の Refresh とは別の短命 token とし、期限・切り替え間隔はチャット transport の負荷試験で決定する。
- `token_seq` の巻き戻しを拒否し、失効した `sid`、マッチ終了、ブロック、停止を heartbeat で切断する。
- QUIC 0-RTT のアプリケーションデータは再送され得るため、1-RTT handshake 完了前のメッセージ送信、既読更新、写真送信、通報、評価を禁止する。
- QUICのパケット再送とアプリケーションメッセージの再送を分離する。結果不明時のアプリ再送は同じ`client_message_id`で冪等化し、指数バックオフ・最大試行回数・期限を設ける。4xxや認証失効では再送しない。
- Expo の標準機能だけで QUIC / WebTransport を利用できるか、native module を含めて PoC で確認する。未対応なら QUIC対応native moduleまたはdevelopment buildを導入し、WebSocketへの自動フォールバックは行わない。例外採用はチーム合意と比較記録を前提とする。

根拠： [RFC 9001（QUIC を TLS で保護）](https://www.rfc-editor.org/rfc/rfc9001)、[RFC 9114（HTTP/3）](https://www.rfc-editor.org/rfc/rfc9114)。RFC 9001 は 0-RTT のアプリケーションデータが再送され得るため、再送時に影響が出る操作へ使わないよう説明しています。

## 5. 自動更新の安全なシーケンス

```mermaid
sequenceDiagram
    participant App as Mobile App
    participant API as Go API
    participant DB as PostgreSQL

    App->>App: Access Token の残り時間を確認
    App->>API: POST /auth/refresh
    API->>API: Refresh Token をハッシュ化
    API->>DB: セッション・期限・未使用状態を原子的に確認
    DB-->>API: 有効
    API->>DB: 旧 token を使用済みにし、新 token hash を保存
    API-->>App: 新 Access Token + 新 Refresh Token
    App->>App: Secure Storage を新 token に置換

    Note over API,DB: 失効済み・使用済み・期限切れなら更新拒否
    Note over App,API: 通信結果不明時は古い token を盲目的に再送しない
```

## 6. テスト必須項目

### セッション

- 有効な JWT でも `sessions.revoked_at` 設定後は REST が `401` になる。
- （将来）ログアウト直後に QUIC 接続が閉じる。
- 全端末ログアウトで全セッションが利用不能になる。
- ユーザー停止時に既存 token が利用不能になる。

### Refresh

- 有効な Refresh Token で一度だけ更新できる。
- 使用済み token の再利用で token family が失効する。
- 期限切れ、別ユーザー、別セッションの token を拒否する。
- 同時 Refresh が二重発行や誤失効を起こさない。
- サーバー成功後にレスポンスが失われた場合の方針どおりに動く。
- Access Token が残り 30 秒を超えているときに不要な更新をしない。
- アプリのバックグラウンド中に定期更新しない。

### Chat Token / QUIC

- Chat Token を REST、プロフィール、Recovery、Key-B、別チャットへ利用できない。
- Chat Token の期限前に次の token へ切り替えられる。
- 古い `token_seq` への巻き戻しを拒否する。
- 1-RTT handshake 前のメッセージ送信・既読・写真・状態変更を拒否する。
- セッション失効、ブロック、マッチ終了で QUIC 接続を閉じる。
- QUIC が一時的に利用できない場合はRESTポーリングへフォールバックする。WebSocketは自動採用せず、技術的にQUICが成立しない場合だけチーム合意で例外採用を決定する。
- 通信断・タイムアウト・一時的なサーバーエラーでは同じ`client_message_id`を期限・回数付きで自動再送し、4xxでは再送しない。

### 認証・鍵

- [x] Google 認証だけでは通常 API を利用できない。Google交換はpre-authだけを返し、Passkey成功後にだけ通常sessionを発行する。
- `pre_auth_token` の期限切れ・二回使用・scope 外利用を拒否する。
- `alg` 改ざん、`kid` 不正、issuer / audience 不正を拒否する。
- 端末登録、Key-A envelope、退会には5分以内のPasskey再認証が必要であり、画像APIには追加で端末proofが必要である。
- Recovery Key、Key-A、Key-B、Refresh Token がログ・クラッシュレポートに出ない。

## 7. リリース判定

### 本番リリース前に必須

- [x] SEC-008 の通信失敗時ポリシーを決定・実装
- [x] SEC-010 の `pre_auth_token` 一回性を実装
- [x] SEC-022 の Web Passkey URLからAccess/pre-auth tokenを除去
- [x] SEC-011 の JWS `kid` / 複数検証鍵を実装
- [ ] SEC-011 のKMS運用・鍵移行期間・漏えい時runbookを確定
- [x] SEC-013 の端末Key-B公開鍵登録・端末proof・nonce replay防止・退会削除・Recovery画像envelopeを実装
- [ ] SEC-013 のnative実機、legacy画像移行、proof監査イベントを設計レビュー
- [ ] SEC-020 の 0-RTT 禁止を実機・統合テスト
- [ ] SEC-021 の QUIC / WebTransport native PoC
- [ ] 上記テスト項目を自動テスト化
- [ ] 依存ライブラリの脆弱性スキャン
- [ ] ステージングでログアウト・端末失効・Refresh reuse の実機テスト
- [ ] 外部セキュリティレビューまたは侵入テスト

### 監査結論

自動更新の設計方針と、DB失効・token rotation・30秒の冪等再送・Google後のpre-auth／Passkey強制・Expo Goのsession handoff・Passkey HTTP儀式・端末proof付き暗号文画像について、当時確認した範囲の記録である。一方、現行実装ではQUIC／WebTransport配送、0-RTT制御、native clientの端末移行・実機確認、legacy画像移行、JWS鍵のKMS運用などが未完了であり、この文書を本番承認の根拠にしてはいけない。
