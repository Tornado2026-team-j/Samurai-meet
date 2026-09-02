from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import urllib.parse
import zlib
from dataclasses import dataclass
from typing import Any

import requests

REPO = os.environ["GH_REPOSITORY"]
TOKEN = os.environ["GH_TOKEN"]
EVENT_NAME = os.environ["GH_EVENT_NAME"]

TRUSTED = {"OWNER", "MEMBER", "COLLABORATOR"}
MAX_DIFF = 420_000
MAX_PATCH = 16_000
MAX_CONTEXT = 140_000
MAX_FILE_CONTEXT = 10_000
MAX_SUGGESTIONS = 3
MAX_SUGGESTION_REPLACEMENT = 3_000
MAX_PLAN_PATCH = 50_000
MAX_PLAN_FILES = 5

FORBIDDEN_APPLY_PREFIXES = (
    ".github/workflows/",
    ".github/actions/",
    ".github/scripts/nana",
)
FORBIDDEN_APPLY_EXACT = {
    ".github/CODEOWNERS",
    "CODEOWNERS",
    ".gitmodules",
}

with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
    EVENT = json.load(f)

SESSION = requests.Session()
SESSION.headers.update(
    {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "nana-pr-agent",
    }
)


def api(repo: str, method: str, path: str, **kwargs: Any) -> Any:
    r = SESSION.request(
        method,
        f"https://api.github.com/repos/{repo}{path}",
        timeout=45,
        **kwargs,
    )
    r.raise_for_status()
    return r.json() if r.content else None


def gh(method: str, path: str, **kwargs: Any) -> Any:
    return api(REPO, method, path, **kwargs)


def pages(path: str, limit: int = 20, repo: str = REPO) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    sep = "&" if "?" in path else "?"
    for page in range(1, limit + 1):
        batch = api(repo, "GET", f"{path}{sep}per_page=100&page={page}")
        if not isinstance(batch, list):
            break
        out.extend(batch)
        if len(batch) < 100:
            break
    return out


def quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


@dataclass(frozen=True)
class NanaCommand:
    name: str
    args: str
    raw: str


ALIASES = {
    "ヘルプ": "help",
    "レビュー": "review",
    "再レビュー": "review",
    "セキュリティ": "security",
    "仕様": "spec",
    "提案": "suggest",
    "読む": "read",
    "比較": "compare",
    "ブランチ": "branch",
    "ブランチ一覧": "branches",
    "修正": "fix",
    "適用": "apply",
}

COMMANDS = {
    "help", "review", "security", "spec", "suggest", "read",
    "compare", "branch", "branches", "ci", "fix", "apply",
}


def parse_command(raw: str) -> NanaCommand:
    text = raw.strip()
    if not text:
        return NanaCommand("review", "", raw)

    first, _, rest = text.partition(" ")
    name = ALIASES.get(first.lower(), first.lower())
    if name in COMMANDS:
        return NanaCommand(name, rest.strip(), raw)

    low = text.lower()
    if re.search(r"(main.*比較|比較.*main)", low):
        return NanaCommand("compare", f"main HEAD {text}", raw)
    if re.search(r"(security|セキュリティ|脆弱|認証|認可)", low):
        return NanaCommand("security", text, raw)
    return NanaCommand("ask", text, raw)


def invocation() -> tuple[int, str, NanaCommand, int | None, str, str]:
    if EVENT_NAME == "pull_request_target":
        pr = EVENT["pull_request"]
        assoc = pr.get("author_association") or ""
        if assoc not in TRUSTED:
            raise SystemExit("Skip: automatic reviews are limited to trusted repository contributors.")
        return pr["number"], "auto", NanaCommand("review", "", ""), None, pr["user"]["login"], assoc

    issue = EVENT.get("issue", {})
    comment = EVENT.get("comment", {})
    if "pull_request" not in issue or comment.get("user", {}).get("type") == "Bot":
        raise SystemExit(0)

    assoc = comment.get("author_association") or ""
    if assoc not in TRUSTED:
        raise SystemExit("Skip: @nana is limited to trusted repository contributors.")

    m = re.search(r"(?i)@nana\b[\s,:：-]*(.*)", comment.get("body", ""), re.S)
    if not m:
        raise SystemExit(0)

    return (
        issue["number"],
        "mention",
        parse_command(m.group(1)),
        comment["id"],
        comment.get("user", {}).get("login", ""),
        assoc,
    )


def repo_info() -> dict[str, Any]:
    return gh("GET", "")


def default_branch() -> str:
    return repo_info().get("default_branch", "main")


def resolve_ref(ref: str, repo: str = REPO) -> str:
    return api(repo, "GET", f"/commits/{quote(ref)}")["sha"]


def tree_for_ref(ref: str, repo: str = REPO) -> list[dict[str, Any]]:
    sha = resolve_ref(ref, repo)
    commit = api(repo, "GET", f"/git/commits/{sha}")
    return list(api(repo, "GET", f"/git/trees/{commit['tree']['sha']}?recursive=1").get("tree", []))


def read_path(ref: str, path: str, limit: int = MAX_FILE_CONTEXT, repo: str = REPO) -> str | None:
    try:
        data = api(repo, "GET", f"/contents/{urllib.parse.quote(path, safe='/')}?ref={quote(ref)}")
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return None
        raise
    if not isinstance(data, dict) or data.get("type") != "file" or data.get("encoding") != "base64":
        return None
    try:
        text = base64.b64decode(data["content"]).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    if len(text) > limit:
        return text[:limit] + "\n...[file truncated]..."
    return text


def pr_files(number: int) -> list[dict[str, Any]]:
    return pages(f"/pulls/{number}/files")


def diff_context(files: list[dict[str, Any]]) -> tuple[str, str, bool]:
    summary = "\n".join(
        f"- {f.get('status', 'modified')} +{f.get('additions', 0)}/-{f.get('deletions', 0)} `{f['filename']}`"
        for f in files
    )
    chunks: list[str] = []
    used = 0
    truncated = False
    skip_suffixes = ("package-lock.json", "pnpm-lock.yaml", "yarn.lock", "go.sum", ".min.js", ".map")

    for f in files:
        name = f["filename"]
        patch = f.get("patch")
        if name.lower().endswith(skip_suffixes):
            continue
        if not patch:
            chunks.append(f"\n### {name}\n[patch unavailable: binary or very large file]\n")
            continue
        if len(patch) > MAX_PATCH:
            patch = patch[:MAX_PATCH] + "\n...[per-file patch truncated]..."
            truncated = True
        chunk = f"\n### {name}\n```diff\n{patch}\n```\n"
        if used + len(chunk) > MAX_DIFF:
            truncated = True
            break
        chunks.append(chunk)
        used += len(chunk)

    return summary, "".join(chunks), truncated


def recent_comments(number: int, current_id: int | None) -> str:
    out: list[str] = []
    for c in pages(f"/issues/{number}/comments", limit=5)[-20:]:
        body = (c.get("body") or "").strip()
        if not body:
            continue
        body = body[:3500] + ("\n...[truncated]" if len(body) > 3500 else "")
        here = " ← 今回の呼び出し" if c.get("id") == current_id else ""
        out.append(f"--- {c.get('user', {}).get('login', 'unknown')}{here}\n{body}")
    return "\n\n".join(out) or "(コメントなし)"


def related_paths(tree: list[dict[str, Any]], changed: list[str], limit: int = 18) -> list[str]:
    stems = {os.path.splitext(os.path.basename(p))[0].lower() for p in changed}
    dirs = {os.path.dirname(p) for p in changed}
    roots = {p.split("/", 1)[0] for p in changed if "/" in p}
    scored: list[tuple[int, str]] = []

    for e in tree:
        if e.get("type") != "blob":
            continue
        path = e.get("path", "")
        if path in changed:
            continue
        low = path.lower()
        stem = os.path.splitext(os.path.basename(path))[0].lower()
        score = 0
        if os.path.dirname(path) in dirs:
            score += 5
        if stem in stems:
            score += 6
        if any(s and s in stem for s in stems):
            score += 3
        if any(low.endswith(sfx) for sfx in ("_test.go", ".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")):
            if any(s and s in low for s in stems):
                score += 7
        if low.startswith("docs/ai/"):
            score += 2
        if low in {"readme.md", "backend/api_spec.md"}:
            score += 3
        if roots and path.split("/", 1)[0] in roots:
            score += 1
        if score:
            scored.append((score, path))

    scored.sort(key=lambda x: (-x[0], x[1]))
    return [p for _, p in scored[:limit]]


def automatic_repo_context(pr: dict[str, Any], files: list[dict[str, Any]]) -> str:
    base_sha = pr["base"]["sha"]
    changed = [f["filename"] for f in files]
    tree = tree_for_ref(base_sha)
    related = related_paths(tree, changed)
    default = default_branch()
    out: list[str] = []
    used = 0

    def add(label: str, ref: str, path: str, per_file: int = 5500, repo: str = REPO) -> None:
        nonlocal used
        if used >= MAX_CONTEXT:
            return
        text = read_path(ref, path, min(per_file, MAX_CONTEXT - used), repo)
        if text is None:
            return
        chunk = f"\n## {label}: `{path}` @ `{ref[:12]}`\n{text}\n"
        out.append(chunk)
        used += len(chunk)

    for path in changed[:12]:
        add("PR BASE", base_sha, path)

    if pr["base"]["ref"] != default:
        for path in changed[:8]:
            add("DEFAULT BRANCH", default, path, 4000)

    for path in ("docs/ai/README.md", "README.md", "backend/API_SPEC.md"):
        add("REFERENCE", base_sha, path, 5000)

    for path in related:
        add("RELATED", base_sha, path, 4500)

    if used >= MAX_CONTEXT:
        out.append("\n...[repository context truncated]...\n")
    return "".join(out) or "(関連するbase/mainコードを取得できませんでした)"


def explicit_read_context(pr: dict[str, Any], args: str) -> str:
    needle = args.strip()
    if not needle:
        return "対象を指定してください。例: `@nana read backend/internal/auth/session.go`"

    base_repo = pr["base"]["repo"]["full_name"]
    head_repo = pr["head"]["repo"]["full_name"]
    base = pr["base"]["sha"]
    head = pr["head"]["sha"]
    default = default_branch()

    if "/" in needle or "." in os.path.basename(needle):
        candidates = [needle]
    else:
        tree = tree_for_ref(base, base_repo)
        low = needle.lower()
        candidates = [e["path"] for e in tree if e.get("type") == "blob" and low in e.get("path", "").lower()][:8]

    if not candidates:
        return f"`{needle}` に一致するファイルを見つけられませんでした。"

    out: list[str] = []
    for path in candidates[:8]:
        for label, ref, repo in (
            ("PR HEAD", head, head_repo),
            ("PR BASE", base, base_repo),
            ("DEFAULT", default, REPO),
        ):
            text = read_path(ref, path, 7000, repo)
            if text is not None:
                out.append(f"\n## {label}: `{path}` @ `{ref[:12]}`\n{text}\n")
    return "".join(out)[:MAX_CONTEXT]


def list_branches(limit: int = 100) -> list[dict[str, Any]]:
    return pages("/branches", limit=max(1, (limit + 99) // 100))[:limit]


def branches_text() -> str:
    branches = list_branches()
    return "\n".join(f"- `{b['name']}` — `{b.get('commit', {}).get('sha', '')[:12]}`" for b in branches) or "(ブランチなし)"


def compare_context(base: str, head: str, path_filter: str = "") -> str:
    data = gh("GET", f"/compare/{quote(base)}...{quote(head)}")
    out = [
        f"Compare `{base}` → `{head}`",
        f"status={data.get('status')} ahead={data.get('ahead_by')} behind={data.get('behind_by')} commits={data.get('total_commits')}",
    ]
    used = sum(len(x) for x in out)
    for f in data.get("files", []):
        path = f.get("filename", "")
        if path_filter and not path.startswith(path_filter):
            continue
        patch = f.get("patch") or "[patch unavailable]"
        patch = patch[:MAX_PATCH]
        chunk = f"\n## {path} +{f.get('additions',0)}/-{f.get('deletions',0)}\n```diff\n{patch}\n```\n"
        if used + len(chunk) > MAX_CONTEXT:
            out.append("\n...[compare truncated]...")
            break
        out.append(chunk)
        used += len(chunk)
    return "\n".join(out)


def branch_context(pr: dict[str, Any], args: str, files: list[dict[str, Any]]) -> str:
    branch, _, question = args.strip().partition(" ")
    if not branch:
        return "ブランチ名を指定してください。例: `@nana branch testing 認証実装を比較して`"
    changed = [f["filename"] for f in files]
    out = [f"Branch reference: `{branch}`", f"Question: {question or '(PRとの関連を確認)'}"]
    for path in changed[:12]:
        text = read_path(branch, path, 7000)
        if text is not None:
            out.append(f"\n## OTHER BRANCH: `{path}` @ `{branch}`\n{text}\n")
    if len(out) == 2:
        out.append(compare_context(pr["base"]["ref"], branch))
    return "\n".join(out)[:MAX_CONTEXT]


def right_diff_lines(patch: str) -> set[int]:
    lines: set[int] = set()
    new_line = 0
    for raw in patch.splitlines():
        if raw.startswith("@@"):
            m = re.search(r"\+(\d+)(?:,(\d+))?", raw)
            if m:
                new_line = int(m.group(1))
            continue
        if not raw or raw.startswith("\\"):
            continue
        prefix = raw[0]
        if prefix == "+":
            lines.add(new_line)
            new_line += 1
        elif prefix == " ":
            lines.add(new_line)
            new_line += 1
        elif prefix == "-":
            pass
    return lines


def valid_suggestion_lines(files: list[dict[str, Any]]) -> dict[str, set[int]]:
    return {f["filename"]: right_diff_lines(f.get("patch") or "") for f in files if f.get("patch")}


def post_review_with_suggestions(
    number: int,
    commit_id: str,
    summary: str,
    suggestions: list[dict[str, Any]],
    files: list[dict[str, Any]],
) -> int:
    allowed = valid_suggestion_lines(files)
    comments = []
    for s in suggestions[:MAX_SUGGESTIONS]:
        path = str(s.get("path") or "")
        try:
            line = int(s.get("line"))
        except (TypeError, ValueError):
            continue
        replacement = str(s.get("replacement") or "")
        message = str(s.get("message") or "この形にすると安全・明確です。").strip()
        if path not in allowed or line not in allowed[path]:
            continue
        if not replacement or len(replacement) > MAX_SUGGESTION_REPLACEMENT or "```" in replacement:
            continue
        comments.append(
            {
                "path": path,
                "line": line,
                "side": "RIGHT",
                "body": f"{message}\n\n```suggestion\n{replacement}\n```",
            }
        )

    if not comments:
        return 0

    gh(
        "POST",
        f"/pulls/{number}/reviews",
        json={
            "commit_id": commit_id,
            "body": "🌸 Nanaから小規模な修正提案です。適用するかは人間が判断してください。",
            "event": "COMMENT",
            "comments": comments,
        },
    )
    return len(comments)


def ci_context(pr: dict[str, Any]) -> str:
    sha = pr["head"]["sha"]
    status = gh("GET", f"/commits/{sha}/status")
    try:
        checks = gh("GET", f"/commits/{sha}/check-runs")
    except requests.HTTPError:
        checks = {"check_runs": []}
    try:
        runs = gh("GET", f"/actions/runs?head_sha={sha}&per_page=30")
    except requests.HTTPError:
        runs = {"workflow_runs": []}

    payload = {
        "combined_status": status.get("state"),
        "statuses": [
            {"context": s.get("context"), "state": s.get("state"), "description": s.get("description")}
            for s in status.get("statuses", [])[:30]
        ],
        "checks": [
            {"name": c.get("name"), "status": c.get("status"), "conclusion": c.get("conclusion")}
            for c in checks.get("check_runs", [])[:30]
        ],
        "workflow_runs": [
            {"name": r.get("name"), "status": r.get("status"), "conclusion": r.get("conclusion")}
            for r in runs.get("workflow_runs", [])[:30]
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def help_text() -> str:
    return """## 🌸 Nana Help

PRのレビュー、コードリード、比較、CI確認、修正提案を手伝えます。

### レビュー
- `@nana` / `@nana review` — PR全体をレビュー
- `@nana security` — セキュリティ・認証/認可を重点確認
- `@nana spec` — base/mainの仕様・docsとの整合性を確認
- `@nana suggest` — 小規模ならFiles changedへGitHub Suggestionを提示

### コードリード / 比較
- `@nana read <path|keyword>` — PR head / base / default branchを横断して読む
- `@nana branches` — ブランチ一覧
- `@nana branch <branch> [質問]` — 別ブランチの関連実装も確認
- `@nana compare <base> <head> [path-prefix]` — 2 refを比較
- `@nana mainと比較して` — 自然言語でもOK

### CI
- `@nana ci` — status / checks / workflow runsを確認

### 修正
- `@nana fix [依頼]` — 現在のPR HEAD向け修正Planを生成（この時点では変更しません）
- `@nana apply <plan-id>` — 別のNana Executorが署名済みPlanをPRへ適用
  - 同一repository内のPRのみ
  - PR HEAD一致必須
  - `.github/workflows/**` 等は自動変更禁止
  - `NANA_PLAN_SECRET` の設定が必要

### 自然言語
`@nana この処理nullにならない？` のような普通の質問にも答えます。

> 小規模修正はcommitよりSuggestionを優先し、大きな変更だけ`fix → apply`へ回します。
"""


def upsert(number: int, marker: str, text: str, footer: str = "") -> None:
    comments = pages(f"/issues/{number}/comments", limit=10)
    existing = next((c for c in comments if marker in (c.get("body") or "")), None)
    body = f"{marker}\n\n{text}"
    if footer:
        body += f"\n\n---\n{footer}"
    if existing:
        gh("PATCH", f"/issues/comments/{existing['id']}", json={"body": body})
    else:
        gh("POST", f"/issues/{number}/comments", json={"body": body})


def eyes(comment_id: int) -> None:
    try:
        gh("POST", f"/issues/comments/{comment_id}/reactions", json={"content": "eyes"})
    except requests.HTTPError:
        pass


def plan_secret() -> bytes | None:
    secret = os.getenv("NANA_PLAN_SECRET", "")
    return secret.encode() if secret else None


def encode_plan(plan: dict[str, Any]) -> tuple[str, str]:
    secret = plan_secret()
    if not secret:
        raise RuntimeError("NANA_PLAN_SECRET is not configured")
    raw = json.dumps(plan, ensure_ascii=False, separators=(",", ":")).encode()
    packed = base64.urlsafe_b64encode(zlib.compress(raw, 9)).decode().rstrip("=")
    sig = hmac.new(secret, packed.encode(), hashlib.sha256).hexdigest()
    return packed, sig


def decode_plan(packed: str, sig: str) -> dict[str, Any]:
    secret = plan_secret()
    if not secret:
        raise RuntimeError("NANA_PLAN_SECRET is not configured")
    expected = hmac.new(secret, packed.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise RuntimeError("invalid Nana plan signature")
    padded = packed + "=" * (-len(packed) % 4)
    raw = zlib.decompress(base64.urlsafe_b64decode(padded))
    return json.loads(raw)


def patch_paths(patch: str) -> list[str]:
    paths = []
    for line in patch.splitlines():
        if line.startswith("+++ b/"):
            p = line[6:].strip()
            if p != "/dev/null":
                paths.append(p)
    return sorted(set(paths))


def forbidden_path(path: str) -> bool:
    return path in FORBIDDEN_APPLY_EXACT or any(path.startswith(p) for p in FORBIDDEN_APPLY_PREFIXES)


def apply_actor_allowed(actor: str, association: str) -> bool:
    if association not in TRUSTED:
        return False
    raw = os.getenv("NANA_APPLY_ACTORS", "").strip()
    if not raw:
        return True
    allowed = {x.strip() for x in raw.split(",") if x.strip()}
    return actor in allowed
