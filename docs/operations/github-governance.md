# GitHub CI と main ブランチ保護

最終更新: 2026-08-24

## CI

CI は責務ごとに独立して実行する。依存関係・静的解析を通常テストの後に直列化しないため、待ち時間を抑えつつ失敗原因を分離できる。

| ワークフロー | PR 時の主な検査 | 集約結果 |
| --- | --- | --- |
| `Backend CI` | Go format / vet / unit test / build、PostgreSQL 統合・HTTPスモーク・鍵生成 | `Backend CI / CI report` |
| `Frontend CI` | Bun install・型検査・Expo lint・Bun test、`bun audit` | `Frontend CI / Frontend CI report` |
| `Security checks` | Dependency Review、Google OSV Scanner、`govulncheck`、`gosec`、TruffleHog、zizmor | `Security checks / Security report` |
| `CodeQL` | Go と TypeScript のセマンティック静的解析 | `CodeQL / Analyze (go)`、`CodeQL / Analyze (javascript-typescript)` |
| `Supply-chain security` | OpenSSF Scorecard | push・定期実行（PRの必須対象外） |
| `PR CI report` | 完了済み必須チェックを1コメントに集約 | PRのCI完了後（必須対象外） |

`Backend CI`、`Frontend CI`、`Security checks`、`CodeQL` は以下のタイミングで動きます。

- `main` への push
- すべての pull request（必須チェックが常に作られるようパス除外をしない）
- GitHub Actions 画面からの手動実行

PR ごとに同じ CI が重複した場合は、古い実行を自動キャンセルします。通常 CI は PostgreSQL 16 をサービスとして起動し、Go test、ビルド、HTTP スモークテスト、Python の鍵生成テストを実行します。Security checks は Google OSV Scanner による依存脆弱性検査、Go の公式 `govulncheck`、`gosec`、TruffleHog、zizmorを並列に実行します。OpenSSF Scorecard は main への push と毎週の定期実行で供給網を監査します。

各ワークフローは最後の集約ジョブで `$GITHUB_STEP_SUMMARY` にMarkdown表を出力する。PRへの通知は `PR CI report` が1件だけ作成・更新するため、Backend・Frontend・Securityの完了ごとにコメントが増えない。`workflow_run` はデフォルトブランチ上の定義で起動するため、この集約は本ワークフローが `main` にマージされた後のPRから有効になる。fork由来のコードをチェックアウトせず、チェック結果だけを読んでコメントする。

必須チェックとして指定する名前は次です。

```text
Backend CI / CI report
Frontend CI / Frontend CI report
Security checks / Security report
CodeQL / Analyze (go)
CodeQL / Analyze (javascript-typescript)
```

## main ブランチ保護（リポジトリ管理者が設定）

GitHub の **Settings → Branches → Branch protection rules → Add rule** で、対象を `main` にして次を有効にする。

- Require a pull request before merging
- Require approvals: 1 以上
- Dismiss stale pull request approvals when new commits are pushed
- Require review from Code Owners（CODEOWNERS を導入した場合）
- Require status checks to pass before merging
  - `Backend CI / CI report`
  - `Frontend CI / Frontend CI report`
  - `Security checks / Security report`
  - `CodeQL / Analyze (go)`
  - `CodeQL / Analyze (javascript-typescript)`
- Require branches to be up to date before merging
- Require conversation resolution before merging
- Do not allow bypassing the above settings
- Restrict force pushes
- Restrict deletions

直接 push を許可する必要がある緊急対応時も、後で必ず PR と監査記録を残す。

Dependency Review を必須にする前に、**Settings → Advanced Security → Dependency graph** を有効にする。無効な状態ではDependency Reviewは実行できず、PRを失敗として扱う。

### ライセンス方針

Dependency Review は許可リスト方式で、MIT・Apache-2.0・BSD系などを許可する。Go公式依存に付随する`LicenseRef-scancode-google-patent-license-golang`はBSD-3-Clauseと組になるため明示許可する。AGPL-3.0はアプリの依存としては許可しない。例外はTruffleHogの固定コミットのみで、未改変のCI秘密情報スキャンとして実行し、製品へ組み込み・配布しないことを条件とする。例外の追加は、用途・固定バージョン・ライセンス影響をPRに記録してレビューする。

### OSV の期限付き例外

各依存ファイルと同じディレクトリの`osv-scanner.toml`は、修正版が存在せず到達不能性を別の検査で保証できる通知だけを期限付きで除外する。`backend/osv-scanner.toml`の`GO-2026-5932`は`golang.org/x/crypto/openpgp`専用であり、バックエンドではOpenPGPのimportを禁止し、`govulncheck`でも到達可能な脆弱性を検査する。期限前に修正状況・利用経路を再確認し、延長はPRで理由を記録する。

## 今後の追加

- Dependabot Alerts、Dependabot Security Updates、Secret Scanning、Push Protection を GitHub の Security 設定で有効にする。Dependabotは`.github/dependabot.yml`でGo module、GitHub Actions、Bunを週次更新する。
- 秘密情報は GitHub Actions Secrets / Environment に置き、`.env` を登録しない。
- 本番 deploy を追加する場合は `main` 保護とは別に production Environment の required reviewer を設定する。
