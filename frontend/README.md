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
bun audit --audit-level=moderate
```

CIでは品質検査と`bun audit`を並列実行し、Bunのダウンロードキャッシュを `bun.lock` のハッシュで再利用します。最後にPRコメントとGitHub Actions Summaryへ集約結果を出します。横断のSecurity checks、CodeQL、Google OSV Scannerも同じPRで実行されます。

`bun audit` の未承認・期限切れ脆弱性はCIを失敗として扱います。修正版が未公開で到達不能なものだけは `scripts/verify-audit.ts` と `osv-scanner.toml` の両方に、理由・影響範囲・失効日を記録した期限付き例外を置けます。例外の期限を延長する場合は、上流の修正版と到達可能性を再調査してPRレビューを必須とします。
