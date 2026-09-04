# ドキュメント入口

最終更新: 2026-09-03

現行コードと設計の状態は [実装状態の境界](ai/system/current-status.md) と [実装バックログ](ai/plans/backlog.md) を正とし、HTTPの厳密な契約は [backend/API_SPEC.md](../backend/API_SPEC.md) を正とします。ルートや`backend`、`frontend`のREADMEは各パッケージの実行手順と現在の利用上の注意をまとめています。

| 読者 | 入口 | 目的 |
| --- | --- | --- |
| 初めて参加する人 | [human/](human/README.md) | 図と補足で全体を理解する |
| 審査・発表の準備をする人 | [審査員向けリモートテストキット](human/remote-test-kit.md) | ハッカソン審査で触ってもらう配布物・操作手順・fallbackを準備する |
| 実装する人・AI | [ai/](ai/README.md) | API契約、不変条件、残タスクを守る |
| 実機検証を担当する人 | [iPhone実機E2E手順書](ios-real-device-e2e.md) | 現行画面・API・前提環境で受入確認する |

既存の `docs/features/` は機能別の補足です。`docs/requirements.md` と `docs/security-audit.md` は目標・過去監査の記録であり、現在の完了状態を判断する資料ではありません。新規実装の正確な契約は `docs/ai/` と `backend/API_SPEC.md` に追記します。
