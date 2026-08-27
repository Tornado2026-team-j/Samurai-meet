# 認証クライアント実装（Issue #1 / PR4）

最終更新: 2026-08-24

Issue #1「ユーザー登録・ログイン保持」に対するExpoクライアント側の実装メモです。HTTPの正式な契約は [backend/API_SPEC.md](../../backend/API_SPEC.md)、認証全体の設計は [auth.md](auth.md) を参照してください。

## 実装範囲

- `frontend/app/(auth)/login.tsx` と `register.tsx` からGoogle OAuthを開始する。
- OAuth callbackのhandoff codeを、Secure Storageに保存したverifierで交換する。
- Google交換直後は通常sessionを発行せず、`pre_auth_token`を保持してPasskey画面へ遷移する。
- `frontend/app/(auth)/passkey.tsx` からWeb Passkey画面を開き、session handoffをverifier付きで交換する。
- 通常sessionはメモリ上にAccess Tokenを保持し、Secure Storageには`user_id`、`session_id`、Refresh Tokenだけを保存する。
- アプリ起動時とフォアグラウンド復帰時にsingle-flightでRefreshを実行してsessionを復元する。保護APIが`401 missing_or_invalid_access_token`を返した場合も、Refreshを一度だけ行って元のリクエストを一度だけ再試行する。Refresh失敗時は一時verifierとsession情報を破棄し、ログイン画面へ戻す。
- Passkeyブラウザからアプリへ戻る際は、一回限りのsession handoff交換が完了するまでAppStateのRefreshを待つ。`403 recent_passkey_authentication_required`はAccess Token更新では解決せず、Passkey再認証へ誘導する。
- セッション更新、Passkey再認証、現在のsessionからのログアウト、全端末ログアウトを提供する。

## Expo Goでの確認

```powershell
cd frontend
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
```

Expo Goでは `Linking.createURL('auth')` が `exp://<host>/--/auth` を返します。開発環境でだけこのredirectをバックエンドの許可リストに登録し、本番では固定scheme `samuraimeet://auth` またはDevelopment Buildを使います。

認証handoffのURL parser、Secure Storageへ保存するsessionの形、Passkey URL fragmentは `frontend/tests/auth-contract.test.ts` で検証します。Access Tokenやpre-auth tokenをログへ出さないでください。
