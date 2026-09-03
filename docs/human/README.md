# Samurai Meet ガイド

このフォルダは、初めてプロジェクトに触れる人の入口です。技術用語は説明を添え、正確な実装契約は [AI向け資料](../ai/README.md) に分けています。

読む順番は、[全体像](overview.md) → [ログイン](auth-and-login.md) → [フロントエンド接続](frontend-connection.md) → [安全性と残作業](security-and-roadmap.md) です。

> **現在地:** 認証・セッション・Passkey・鍵の基盤、募集・マッチングAPI、外国人/日本人の募集導線、募集管理・応募履歴、通知APIとアプリ内通知画面は実装済みです。チャット画面は暗号化REST、画像添付、編集・削除、翻訳、既読へ接続済みで、バックエンドのリアルタイム配送はHTTP/3 WebTransportです。Expo GoはREST同期を使い、native WebTransport、プロフィール編集UI、OSプッシュ通知、募集から通知遷移までのnative実機全通しE2Eは未完了です。
