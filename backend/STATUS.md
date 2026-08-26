# 実装状態

- 実装済み: Google OAuth、pre-auth、Passkey、session/refresh、v2 client root-key envelope、端末固有Key-Bの公開鍵登録・proof、暗号文画像API、退会API。
- 実装済み: プロフィール取得・自己紹介を含む更新API、募集カードの作成・検索・更新・終了、関心・承認・完了、最新位置保存。
- 実装済み: acceptedマッチ向けRESTチャット（暗号文、既読、冪等再送、短命Chat Token）、会合セッション、短期のBluetooth／位置推測補助値API。
- 未完了: Web Passkeyの実機E2E、端末画像の画面統合、削除reconciler、legacy画像移行、native Passkey実機、プロフィール編集・チャットのフロント接続、WebSocket配送、ネイティブBluetooth測定、通知・評価、Stripe Identity連携。募集公開・検索・応募・承認／辞退のフロント接続は完了。

マッチングの距離判定はPostGISなしのGo Haversineで実装している。件数増加時のPostGIS化、APIレート制限、通知一覧・未読管理はバックログに残す。

詳細と完了定義は [docs/ai/plans/backlog.md](../docs/ai/plans/backlog.md) を正とします。

## クライアント所有鍵v2（2026-08-26）

最終設計は [docs/ai/security/proton-style-key-management/proposal.md](../docs/ai/security/proton-style-key-management/proposal.md) に固定した。
今回の実装では、root-key protocolをv2へ固定し、24語Recovery Phrase envelope、別X25519端末合意鍵、
旧端末承認のtransfer APIを追加した。サーバーはMaster Key、Recovery Phrase、Key-B秘密値を扱わない。

profile画像のサーバー復号配信とExpo GoのOS Secure Storageは明示した互換・開発上の例外であり、
Proton級の本番zero-access/hardware-backed保証を意味しない。v1のBase64URL Recovery Keyは受け付けず、
pre-release migrationで旧root envelopeと旧Key-B materialを削除する。QR/OOBを含む画面統合、bulk画像再包み、Recovery Codes、
native attestation、完全性・可用性対策は引き続き本番ゲートである。
