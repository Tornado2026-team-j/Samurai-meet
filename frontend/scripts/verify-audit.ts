type Advisory = {
  url: string;
  severity: string;
  title: string;
};

type AuditReport = Record<string, Advisory[]>;

const temporaryExceptions = new Map([
  [
    "GHSA-w3rx-r6r6-pgpr",
    {
      expiresOn: "2026-09-07",
      reason:
        "Expo / Metro の開発時依存 image-size@2.0.2。公開済みの修正版が存在しないため。",
    },
  ],
  [
    "GHSA-5p2g-fcmc-qvqq",
    {
      expiresOn: "2026-09-07",
      reason:
        "Expo / Metro の開発時依存 image-size@2.0.2。公開済みの修正版が存在しないため。",
    },
  ],
  [
    "GHSA-w5hq-g745-h8pq",
    {
      expiresOn: "2026-09-07",
      reason:
        "Expo の開発用 xcode が uuid.v4() のみを使用し、指摘対象の v3/v5/v6 と外部バッファ経路を使用しないため。",
    },
  ],
]);

const audit = Bun.spawnSync({
  cmd: ["bun", "audit", "--json"],
  stdout: "pipe",
  stderr: "inherit",
});
const output = new TextDecoder().decode(audit.stdout);
const jsonStart = output.indexOf("{");

if (jsonStart === -1) {
  console.error("bun audit のJSON結果を取得できませんでした。");
  process.exit(1);
}

let report: AuditReport;
try {
  report = JSON.parse(output.slice(jsonStart)) as AuditReport;
} catch {
  console.error("bun audit のJSON結果を解析できませんでした。");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const unexpected: string[] = [];
const accepted: string[] = [];

for (const [packageName, advisories] of Object.entries(report)) {
  for (const advisory of advisories) {
    const id = advisory.url.split("/").at(-1) ?? advisory.url;
    const exception = temporaryExceptions.get(id);
    if (!exception || exception.expiresOn < today) {
      unexpected.push(`${packageName}: ${id} (${advisory.severity})`);
      continue;
    }
    accepted.push(`${packageName}: ${id}（期限 ${exception.expiresOn}、${exception.reason}）`);
  }
}

console.log("# Bun dependency audit");
for (const entry of accepted) console.log(`期限付き例外: ${entry}`);

if (unexpected.length > 0) {
  console.error("未承認または期限切れの脆弱性が検出されました。");
  for (const entry of unexpected) console.error(`- ${entry}`);
  process.exit(1);
}

console.log("未承認の脆弱性はありません。");
