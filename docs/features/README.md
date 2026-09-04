# 機能別仕様書

各機能の画面、処理、API、DB、実装言語、受け入れ条件を定義します。

| ID | 機能 | 仕様書 |
| --- | --- | --- |
| F-01 | 認証・アカウント復旧 | [auth.md](auth.md) |
| F-02 | プロフィール | [profile.md](profile.md) |
| F-03 | 本人確認 | [identity-verification.md](identity-verification.md) |
| F-04 | 現在地・検索 | [location-search.md](location-search.md) |
| F-05 | 募集・マッチング | [matching.md](matching.md) |
| F-06 | チャット | [chat.md](chat.md) |
| F-06b | チャット通信トークン／HTTP/3 WebTransport（バックエンド実装済み、native実機未確認） | [chat-transport.md](chat-transport.md) |
| F-06c | チャット：実機再接続・失効・負荷試験の手順書 | [chat-load-test.md](chat-load-test.md) |
| F-07 | 写真 | [photos.md](photos.md) |
| F-08 | 相互評価・いいね | [reviews.md](reviews.md) |
| F-09 | 通報・ブロック | [safety.md](safety.md) |
| F-10 | 審査・お試し用Demoアカウント（設計のみ） | [demo-account.md](demo-account.md) |

機能間の共通仕様は、[API 仕様書](../api.md)、[DB 仕様書](../database.md)、[技術選定・実装分担](../tech-stack.md) に集約します。
