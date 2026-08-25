# 実装状態の境界

## 実装済み（backend）

- OAuth/pre-auth/session/refresh/Passkey/再認証、暗号文画像エンドポイント、Key-A envelope、Key-B暗号文保存、退会API。
- `POST /auth/passkey/reauth/options` と `/verify` は実装済み。詳細は `backend/API_SPEC.md` とコードを確認すること。

## 未実装・本番承認不可

- `frontend/` にWeb Passkey画面、画像暗号化/upload、プロフィール等の業務API clientはない。`services/api.ts` も未実装。
- Web Passkey UIは別の正式Web配信物として、bootstrap→options/verify→アプリdeep linkを実装・配信・E2E確認する必要がある。バックエンドのbootstrap、request_id付きhandoff、URL秘密値境界は実装済み。
- `frontend/services/auth-contract.ts` のURL fragmentは`bootstrap_token`だけ。Access Token、Refresh Token、pre-auth tokenはWeb URLへ渡さない。
- KMS、Key-B取得監査、共通監査基盤、画像quarantine、削除reconcilerは未実装。

## CORSと開発Web

`CLIENT_ORIGIN` があればそれだけを許可し、空の場合に限り `development` で `DEV_CLIENT_ORIGIN` を許可する。バックエンドはUIを配信しない。OAuth callbackの`/auth/complete`許可は、正式Web Passkey UIを配信するOriginのための設定である。
