const ROUTES: { method: string; path: string; purpose: string; policy: string }[] = [
  { method: "POST", path: "/api/requests/classify", purpose: "keyword extraction + category", policy: "fail-closed" },
  { method: "POST", path: "/api/translate", purpose: "chat translation (+ cache)", policy: "fail-open" },
  { method: "POST", path: "/api/profile/assist", purpose: "profile text polish / translate", policy: "fail-open" },
  { method: "POST", path: "/api/moderation", purpose: "inappropriate-content check", policy: "chat: closed · else: open" },
  { method: "POST", path: "/api/monster", purpose: "monster image generation", policy: "fail-closed" },
  { method: "GET", path: "/api/location/name", purpose: "current-location display name (Google Maps)", policy: "fail-open" },
  { method: "GET", path: "/api/health", purpose: "liveness + configured integrations", policy: "—" },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: 4 }}>Samurai Meet — AI service</h1>
      <p style={{ color: "#74757f", marginTop: 0 }}>
        Internal API routes. External calls (OpenAI, Google Maps) live in{" "}
        <code>lib/ai.ts</code> / <code>lib/geo.ts</code> and are stubbed — those routes return{" "}
        <code>501</code> until the AI owner implements them.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24, fontSize: ".9rem" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #d3cfc4" }}>
            <th style={{ padding: "8px 10px" }}>Method</th>
            <th style={{ padding: "8px 10px" }}>Path</th>
            <th style={{ padding: "8px 10px" }}>Purpose</th>
            <th style={{ padding: "8px 10px" }}>Failure policy</th>
          </tr>
        </thead>
        <tbody>
          {ROUTES.map((r) => (
            <tr key={r.path} style={{ borderBottom: "1px solid #e4e1d9" }}>
              <td style={{ padding: "8px 10px", fontFamily: "ui-monospace, monospace" }}>{r.method}</td>
              <td style={{ padding: "8px 10px", fontFamily: "ui-monospace, monospace" }}>{r.path}</td>
              <td style={{ padding: "8px 10px" }}>{r.purpose}</td>
              <td style={{ padding: "8px 10px", color: "#74757f" }}>{r.policy}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "#74757f", fontSize: ".85rem", marginTop: 24 }}>
        Every <code>/api/*</code> route (except <code>/api/health</code>) needs the{" "}
        <code>x-ai-secret</code> header when <code>AI_SERVICE_SHARED_SECRET</code> is set.
      </p>
    </main>
  );
}
