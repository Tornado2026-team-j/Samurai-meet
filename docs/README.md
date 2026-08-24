# Samurai Meet ドキュメント一覧

Samurai Meet の要件・設計・実装方針を、目的ごとに分けて管理します。

## 読む順番

1. [要件定義書](requirements.md)：プロダクト全体の背景、スコープ、KPI、受け入れ条件
2. [アーキテクチャ概要](architecture.md)：アプリ、API、DB、ストレージの責務と通信経路
3. [技術選定・実装分担](tech-stack.md)：機能ごとに使用する言語、フレームワーク、配置先
4. [API 仕様書](api.md)：REST API、WebSocket、認証、エラー形式
5. [DB 仕様書](database.md)：テーブル、リレーション、インデックス、保持方針
6. [機能別仕様書](features/README.md)：各機能の画面、処理、API、DB、受け入れ条件
7. [セキュリティ最終監査](security-audit.md)：自動更新、セッション失効、P1 対応、リリース判定
8. [GitHub CI と main ブランチ保護](operations/github-governance.md)：CI の実行内容と管理者向け設定手順

## 機能別仕様書

| 機能 | 仕様書 |
| --- | --- |
| Google OAuth2 / Passkey / Recovery Key | [認証](features/auth.md) |
| プロフィール | [プロフィール](features/profile.md) |
| 本人確認 | [本人確認](features/identity-verification.md) |
| 現在地取得・キーワード検索 | [位置情報・検索](features/location-search.md) |
| 募集カード・マッチング | [募集・マッチング](features/matching.md) |
| チャット | [チャット](features/chat.md) |
| チャット通信トークン（QUIC / WebTransport） | [チャット通信](features/chat-transport.md) |
| 写真 | [写真](features/photos.md) |
| 相互評価・いいね | [相互評価](features/reviews.md) |
| 通報・ブロック | [安全機能](features/safety.md) |

## 仕様の読み方

- `FR-*`：機能要件
- `NFR-*`：非機能要件
- `API-*`：API 要件
- `DB-*`：DB 要件
- `AC-*`：受け入れ条件
- `要確認`：実装前にプロダクト・セキュリティ・法務の判断が必要な項目

## 実装の基本方針

- フロントエンドの標準言語は TypeScript。
- バックエンド API、マッチング、WebSocket、画像 API は Go。
- DB は PostgreSQL を唯一の正本とする。距離検索には PostgreSQL の PostGIS 拡張を利用する。
- 暗号化済み画像本体は非公開ファイルストレージ、画像メタデータと削除状態は PostgreSQL に保存する。
- クライアントは原則として Go API 経由で業務データへアクセスする。PostgreSQL やファイルストレージへモバイルアプリから直接接続しない。
- 暗号化対象データはクライアント側で扱い、Key-A をサーバーへ平文で送らない。
