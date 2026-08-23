# GitHub CI と main ブランチ保護

最終更新: 2026-08-24

## CI

`Backend CI` は以下のタイミングで動きます。

- `main` への push
- `backend/**` または CI workflow を含む pull request
- GitHub Actions 画面からの手動実行

PR ごとに同じ CI が重複した場合は、古い実行を自動キャンセルします。CI は PostgreSQL 16 をサービスとして起動し、Go test、ビルド、HTTP スモークテスト、Python の鍵生成テストを実行します。

必須チェックとして指定する名前は次です。

```text
Backend CI / Go test and build
```

## main ブランチ保護（リポジトリ管理者が設定）

GitHub の **Settings → Branches → Branch protection rules → Add rule** で、対象を `main` にして次を有効にする。

- Require a pull request before merging
- Require approvals: 1 以上
- Dismiss stale pull request approvals when new commits are pushed
- Require review from Code Owners（CODEOWNERS を導入した場合）
- Require status checks to pass before merging
  - `Backend CI / Go test and build`
- Require branches to be up to date before merging
- Require conversation resolution before merging
- Do not allow bypassing the above settings
- Restrict force pushes
- Restrict deletions

直接 push を許可する必要がある緊急対応時も、後で必ず PR と監査記録を残す。

## 今後の追加

- フロントエンド CI を追加したら、同様に required check に登録する。
- 秘密情報は GitHub Actions Secrets / Environment に置き、`.env` を登録しない。
- 本番 deploy を追加する場合は `main` 保護とは別に production Environment の required reviewer を設定する。
