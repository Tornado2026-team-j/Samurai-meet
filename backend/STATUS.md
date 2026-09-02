# 実装状態

- 実装済み: Google OAuth、pre-auth、Passkey、session/refresh、v2 client root-key envelope、端末固有Key-Bの公開鍵登録・proof、暗号文画像API、退会API。
- 実装済み: プロフィール取得・自己紹介を含む更新API、募集カードの作成・検索・更新・終了、関心・承認・完了、最新位置保存、通報登録（`reports`）とブロックの作成・一覧・解除。
- 実装済み: acceptedマッチ向けチャット（REST + WebSocketリアルタイム配送。端末Key-B由来の暗号文、既読、冪等再送、本文編集・削除、AI翻訳とKey-B暗号化翻訳envelopeのメッセージrevision別保存、短命Chat Token、接続中のセッション/ブロック/マッチheartbeat。単一APIインスタンス前提のプロセス内ハブ）、会合セッション、短期のBluetooth／位置推測補助値API。
- 実装済み: 通知の永続化・一覧・未読管理、応募／承認／辞退／暗号化チャット送信からの通知生成、通知画面のAPI接続。
- 未完了: Web Passkeyの実機E2E、端末画像の画面統合、削除reconciler、legacy画像移行、native Passkey実機、プロフィール編集、端末Key-Bのチャット参加者間共有、チャットの実機E2E、チャット配送の複数インスタンス対応（`LISTEN/NOTIFY`）とChat Token接続中ローテーション、ネイティブBluetooth測定、評価、Stripe Identity連携。募集公開・検索・応募・承認／辞退のフロント接続は完了。

マッチングの距離判定はPostGISなしのGo Haversineで実装している。募集の利用日・壁時計は`Asia/Tokyo`固定で正規化し、絶対時刻はUTCで扱う。件数増加時のPostGIS化、APIレート制限、チャット配送の複数インスタンス対応はバックログに残す。

通常のネイティブAPI接続先は`https://samurai-meet.disnana.com/api/v1`であり、LANの8080へ自動切替しない。Expo Goではnative Passkeyやhardware-backed storageを検証できず、Development Build／ストアビルドで別途確認する。

詳細と完了定義は [docs/ai/plans/backlog.md](../docs/ai/plans/backlog.md) を正とします。

## クライアント所有鍵v2（2026-08-26）

最終設計は [docs/ai/security/proton-style-key-management/proposal.md](../docs/ai/security/proton-style-key-management/proposal.md) に固定した。
今回の実装では、root-key protocolをv2へ固定し、24語Recovery Phrase envelope、別X25519端末合意鍵、
旧端末承認のtransfer APIを追加した。サーバーはMaster Key、Recovery Phrase、Key-B秘密値を扱わない。

profile画像のサーバー復号配信とExpo GoのOS Secure Storageは明示した互換・開発上の例外であり、
Proton級の本番zero-access/hardware-backed保証を意味しない。v1のBase64URL Recovery Keyは受け付けず、
pre-release migrationで旧root envelopeと旧Key-B materialを削除する。QR/OOBを含む画面統合、bulk画像再包み、Recovery Codes、
native attestation、完全性・可用性対策は引き続き本番ゲートである。
