type Advisory = { url: string; severity: string };
type AuditReport = Record<string, Advisory[]>;

const exceptions = new Map([
  ["GHSA-w3rx-r6r6-pgpr", "2026-09-07"],
  ["GHSA-5p2g-fcmc-qvqq", "2026-09-07"],
]);
const reasons = new Map([
  ["GHSA-w3rx-r6r6-pgpr", "Expo / Metro の image-size@2.0.2。修正版公開までの期限付き例外"],
  ["GHSA-5p2g-fcmc-qvqq", "Expo / Metro の image-size@2.0.2。修正版公開までの期限付き例外"],
]);

const result = Bun.spawnSync({ cmd: ["bun", "audit", "--json"], stdout: "pipe", stderr: "inherit" });
const output = new TextDecoder().decode(result.stdout);
const jsonStart = output.indexOf("{");
if (jsonStart < 0) {
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
for (const [packageName, advisories] of Object.entries(report)) {
  for (const advisory of advisories) {
    const id = advisory.url.split("/").at(-1) ?? advisory.url;
    const expiresOn = exceptions.get(id);
    if (!expiresOn || expiresOn < today) {
      unexpected.push(`${packageName}: ${id} (${advisory.severity})`);
      continue;
    }
    console.log(`期限付き例外: ${packageName}: ${id}（期限 ${expiresOn}、${reasons.get(id)}）`);
  }
}
if (unexpected.length > 0) {
  console.error("未承認または期限切れの脆弱性が検出されました。");
  for (const issue of unexpected) console.error(`- ${issue}`);
  process.exit(1);
}
console.log("未承認の脆弱性はありません。");
