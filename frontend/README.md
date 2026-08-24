# フロントエンド開発

Samurai Meet の Expo / React Native クライアントです。パッケージマネージャーは **Bun 1.3.3** に固定します。npm、Yarn、pnpm で lockfile を作成・更新しないでください。

## 初回セットアップ

```powershell
cd frontend
bun install --frozen-lockfile
```

`bun.lock` は必ずコミットします。依存更新は `bun update` またはDependabotのPRで行い、lockfileだけを手編集しません。

## 開発・検証

```powershell
bun run start
bun run typecheck
bun run lint
bun run test
bun run security:audit
```

CIでは品質検査と`bun audit`を並列実行し、Bunのダウンロードキャッシュを `bun.lock` のハッシュで再利用します。最後にPRコメントとGitHub Actions Summaryへ集約結果を出します。横断のSecurity checks、CodeQL、Google OSV Scannerも同じPRで実行されます。

`bun audit` の未承認・期限切れ脆弱性はCIを失敗として扱います。修正版が未公開で到達不能なものだけは `scripts/verify-audit.ts` と `osv-scanner.toml` の両方に、理由・影響範囲・失効日を記録した期限付き例外を置けます。例外の期限を延長する場合は、上流の修正版と到達可能性を再調査してPRレビューを必須とします。

## Issue #1の認証導線

- `app/(auth)/login.tsx` と `register.tsx` からGoogle OAuthを開始し、Passkey完了後に通常sessionへ進みます。
- OAuth / Passkey handoff verifierはSecure Storageへ保存し、deep linkの一回限りコードと交換します。
- Access Tokenはメモリだけに置き、Secure Storageにはuser/session IDとRefresh Tokenだけを保存します。アプリ起動時とフォアグラウンド復帰時はsingle-flightでRefreshします。
- Refresh失敗、session handoff失敗、ログアウト時は一時verifierとsession情報を削除します。通信結果が不明なRefreshでは同じrequest IDを保持して再試行できます。
- Expo GoではWeb Passkeyをアプリ内ブラウザで実行します。pre-auth tokenやAccess TokenをURL queryへ置かず、Passkey用fragmentまたは短命なsession handoffだけを使います。

APIの開発上書きは `.env` の `EXPO_PUBLIC_API_BASE_URL` で指定できます。未指定時は `https://samurai-meet.disnana.com/api/v1` を使います。

詳細な受入手順は [docs/features/auth-client.md](../docs/features/auth-client.md) を参照してください。
