# Samurai Meet - Official Website

Astro で構築されたSamurai Meetの公式Webサイトです。

## 開発

```bash
cd site
node --version  # v18.17.1以上が必要
npm install
npm run dev
```

`http://localhost:3000` でプレビュー可能です。

## ビルド

```bash
npm run build
npm run preview
```

## 自動デプロイ

mainブランチへのpushまたはgh-pagesへの直接pushで自動的にGitHub Pagesへデプロイされます。

詳細は [../.github/workflows/deploy-site.yml](../.github/workflows/deploy-site.yml) を参照してください。
