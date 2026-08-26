# 実装状態の境界

## 実装済み（backend）

- OAuth/pre-auth/session/refresh/Passkey/再認証、暗号文画像エンドポイント、Key-A envelope、端末固有Key-Bの公開鍵proof、退会API。
- `POST /auth/passkey/reauth/options` と `/verify` は実装済み。詳細は `backend/API_SPEC.md` とコードを確認すること。

## 未実装・本番承認不可

- `frontend/` はネイティブクライアントを担当する。Web Passkey UIはGoバックエンドの `/passkey` から配信し、bootstrap→options/verify→アプリdeep linkを実装する。実機E2E確認は継続して必要。
- `frontend/services/auth-contract.ts` のURL fragmentは`bootstrap_token`だけ。Access Token、Refresh Token、pre-auth tokenはWeb URLへ渡さない。
- 端末画像の画面統合、共通監査基盤、画像quarantine、削除reconciler、legacy画像移行は未実装。Key-Bはサーバー取得方式ではない。

## CORSと開発Web

`CLIENT_ORIGIN` があればそれだけを許可し、空の場合に限り `development` で `DEV_CLIENT_ORIGIN` を許可する。Web Passkey UIはバックエンドの `/passkey` から同一Originで配信する。OAuth callbackの`/auth/complete`許可は、正式Web Passkey UIを配信するOriginのための設定である。
