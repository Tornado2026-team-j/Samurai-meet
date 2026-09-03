from __future__ import annotations

import json
import re
import time
from typing import Any

import requests

from nana_common import (
    MAX_CONTEXT,
    MAX_PATCH,
    REPO,
    default_branch,
    gh,
    list_branches,
    pages,
    pr_files,
    quote,
    read_path,
    resolve_ref,
    tree_for_ref,
)

MAX_TOOL_OUTPUT = 24_000

# Every model-callable tool is read-only. There is deliberately no generic HTTP or shell tool.
TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_pr_state",
        "description": (
            "Fetch authoritative current pull-request state from GitHub, including mergeable and "
            "mergeable_state. Use this before making any claim about conflicts or mergeability."
        ),
        "parameters": {
            "type": "object",
            "properties": {"pr_number": {"type": "integer", "minimum": 1}},
            "required": ["pr_number"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_ci_state",
        "description": (
            "Fetch authoritative current commit statuses, check-runs, and GitHub Actions workflow "
            "runs. Use this before claiming CI/security checks passed or failed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pr_number": {"type": "integer", "minimum": 1},
                "ref": {
                    "type": ["string", "null"],
                    "description": "Optional branch/ref/SHA. null means current PR head.",
                },
            },
            "required": ["pr_number", "ref"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_pr_file_patch",
        "description": "Fetch the current GitHub patch for one file changed by this PR.",
        "parameters": {
            "type": "object",
            "properties": {
                "pr_number": {"type": "integer", "minimum": 1},
                "path": {"type": "string", "minLength": 1},
            },
            "required": ["pr_number", "path"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "read_repo_file",
        "description": (
            "Read one UTF-8 repository file from PR head, PR base, default branch, or an explicit ref. "
            "Use this to inspect related code instead of guessing."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pr_number": {"type": "integer", "minimum": 1},
                "path": {"type": "string", "minLength": 1},
                "source": {"type": "string", "enum": ["head", "base", "default", "ref"]},
                "ref": {
                    "type": ["string", "null"],
                    "description": "Required only when source=ref; otherwise null.",
                },
            },
            "required": ["pr_number", "path", "source", "ref"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "compare_refs",
        "description": (
            "Compare two refs/SHAs in the repository using GitHub's compare API. "
            "Returns commit relationship and per-file patch snippets."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "base": {"type": "string", "minLength": 1},
                "head": {"type": "string", "minLength": 1},
                "path_prefix": {"type": ["string", "null"]},
            },
            "required": ["base", "head", "path_prefix"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_conflict_candidates",
        "description": (
            "For a PR, fetch authoritative mergeability and compute files changed on both the base "
            "side and head side since their merge base. These are conflict candidates, not guaranteed "
            "conflict files. Use when investigating a merge conflict."
        ),
        "parameters": {
            "type": "object",
            "properties": {"pr_number": {"type": "integer", "minimum": 1}},
            "required": ["pr_number"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "list_repo_branches",
        "description": "List repository branches, optionally filtered by a case-insensitive substring.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": ["string", "null"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "required": ["query", "limit"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "search_repo_paths",
        "description": (
            "Search file paths (not file contents) in a ref. Useful for finding related tests, "
            "implementations, docs, or symbols whose name appears in a path."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1},
                "ref": {"type": ["string", "null"], "description": "null means default branch"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 30},
            },
            "required": ["query", "ref", "limit"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_commit_history",
        "description": "Fetch recent commits for a ref and optional file path.",
        "parameters": {
            "type": "object",
            "properties": {
                "ref": {"type": ["string", "null"], "description": "null means default branch"},
                "path": {"type": ["string", "null"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["ref", "path", "limit"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]


def _trim(value: Any, limit: int = MAX_TOOL_OUTPUT) -> Any:
    text = json.dumps(value, ensure_ascii=False)
    if len(text) <= limit:
        return value
    return {
        "truncated": True,
        "original_chars": len(text),
        "preview": text[:limit],
    }


def _refresh_pr(pr_number: int) -> dict[str, Any]:
    pr = gh("GET", f"/pulls/{pr_number}")
    # GitHub can temporarily return null while mergeability is being computed.
    for _ in range(2):
        if pr.get("mergeable") is not None:
            break
        time.sleep(1)
        pr = gh("GET", f"/pulls/{pr_number}")
    return pr


def get_pr_state(pr_number: int) -> dict[str, Any]:
    pr = _refresh_pr(pr_number)
    return {
        "source": "GitHub REST pull request (authoritative current state)",
        "number": pr.get("number"),
        "state": pr.get("state"),
        "draft": pr.get("draft"),
        "mergeable": pr.get("mergeable"),
        "mergeable_state": pr.get("mergeable_state"),
        "rebaseable": pr.get("rebaseable"),
        "base": {
            "ref": pr.get("base", {}).get("ref"),
            "sha": pr.get("base", {}).get("sha"),
        },
        "head": {
            "ref": pr.get("head", {}).get("ref"),
            "sha": pr.get("head", {}).get("sha"),
            "repo": pr.get("head", {}).get("repo", {}).get("full_name"),
        },
        "changed_files": pr.get("changed_files"),
        "commits": pr.get("commits"),
        "additions": pr.get("additions"),
        "deletions": pr.get("deletions"),
    }


def get_ci_state(pr_number: int, ref: str | None) -> dict[str, Any]:
    if ref:
        sha = resolve_ref(ref)
    else:
        sha = _refresh_pr(pr_number)["head"]["sha"]

    status = gh("GET", f"/commits/{sha}/status")
    try:
        checks = gh("GET", f"/commits/{sha}/check-runs?per_page=100")
    except requests.HTTPError as exc:
        checks = {"error": f"check-runs unavailable: HTTP {exc.response.status_code if exc.response else '?'}", "check_runs": []}
    try:
        runs = gh("GET", f"/actions/runs?head_sha={quote(sha)}&per_page=100")
    except requests.HTTPError as exc:
        runs = {"error": f"workflow-runs unavailable: HTTP {exc.response.status_code if exc.response else '?'}", "workflow_runs": []}

    return _trim(
        {
            "source": "GitHub REST statuses/check-runs/actions (authoritative current state)",
            "sha": sha,
            "combined_status": status.get("state"),
            "statuses": [
                {
                    "context": s.get("context"),
                    "state": s.get("state"),
                    "description": s.get("description"),
                    "target_url": s.get("target_url"),
                }
                for s in status.get("statuses", [])[:100]
            ],
            "checks": [
                {
                    "name": c.get("name"),
                    "status": c.get("status"),
                    "conclusion": c.get("conclusion"),
                    "details_url": c.get("details_url"),
                }
                for c in checks.get("check_runs", [])[:100]
            ],
            "workflow_runs": [
                {
                    "name": r.get("name"),
                    "event": r.get("event"),
                    "status": r.get("status"),
                    "conclusion": r.get("conclusion"),
                    "html_url": r.get("html_url"),
                }
                for r in runs.get("workflow_runs", [])[:100]
            ],
        }
    )


def get_pr_file_patch(pr_number: int, path: str) -> dict[str, Any]:
    for f in pr_files(pr_number):
        if f.get("filename") == path:
            return _trim(
                {
                    "source": "GitHub REST PR files",
                    "path": path,
                    "status": f.get("status"),
                    "additions": f.get("additions"),
                    "deletions": f.get("deletions"),
                    "changes": f.get("changes"),
                    "patch": f.get("patch") or "[patch unavailable: binary or too large]",
                }
            )
    return {"error": "path is not changed by this PR", "path": path}


def read_repo_file(pr_number: int, path: str, source: str, ref: str | None) -> dict[str, Any]:
    pr = _refresh_pr(pr_number)
    repo = REPO
    if source == "head":
        actual_ref = pr["head"]["sha"]
        repo = pr["head"]["repo"]["full_name"]
    elif source == "base":
        actual_ref = pr["base"]["sha"]
        repo = pr["base"]["repo"]["full_name"]
    elif source == "default":
        actual_ref = default_branch()
    elif source == "ref":
        if not ref:
            return {"error": "ref is required when source=ref"}
        actual_ref = ref
    else:
        return {"error": f"invalid source: {source}"}

    text = read_path(actual_ref, path, MAX_TOOL_OUTPUT - 1000, repo)
    if text is None:
        return {"error": "file not found or not UTF-8 text", "path": path, "ref": actual_ref, "repo": repo}
    return {
        "source": "GitHub REST contents",
        "repo": repo,
        "ref": actual_ref,
        "path": path,
        "content": text,
    }


def compare_refs(base: str, head: str, path_prefix: str | None) -> dict[str, Any]:
    data = gh("GET", f"/compare/{quote(base)}...{quote(head)}")
    files = []
    for f in data.get("files", []):
        path = f.get("filename", "")
        if path_prefix and not path.startswith(path_prefix):
            continue
        patch = f.get("patch") or "[patch unavailable]"
        files.append(
            {
                "path": path,
                "status": f.get("status"),
                "additions": f.get("additions"),
                "deletions": f.get("deletions"),
                "patch": patch[:MAX_PATCH],
            }
        )
    return _trim(
        {
            "source": "GitHub REST compare",
            "base": base,
            "head": head,
            "status": data.get("status"),
            "ahead_by": data.get("ahead_by"),
            "behind_by": data.get("behind_by"),
            "total_commits": data.get("total_commits"),
            "merge_base_sha": data.get("merge_base_commit", {}).get("sha"),
            "files": files,
        }
    )


def get_conflict_candidates(pr_number: int) -> dict[str, Any]:
    pr = _refresh_pr(pr_number)
    base_sha = pr["base"]["sha"]
    head_sha = pr["head"]["sha"]
    relation = gh("GET", f"/compare/{quote(base_sha)}...{quote(head_sha)}")
    merge_base = relation.get("merge_base_commit", {}).get("sha")

    result: dict[str, Any] = {
        "source": "GitHub REST PR + compare",
        "mergeable": pr.get("mergeable"),
        "mergeable_state": pr.get("mergeable_state"),
        "base_sha": base_sha,
        "head_sha": head_sha,
        "merge_base_sha": merge_base,
        "note": (
            "candidate_files are paths modified on both sides since the merge base. "
            "They are conflict candidates, not proof that each file conflicts."
        ),
        "candidate_files": [],
    }
    if not merge_base:
        result["error"] = "merge base unavailable"
        return result

    base_side = gh("GET", f"/compare/{quote(merge_base)}...{quote(base_sha)}")
    head_side = gh("GET", f"/compare/{quote(merge_base)}...{quote(head_sha)}")
    base_files = {f.get("filename"): f for f in base_side.get("files", []) if f.get("filename")}
    head_files = {f.get("filename"): f for f in head_side.get("files", []) if f.get("filename")}

    candidates = []
    for path in sorted(set(base_files) & set(head_files)):
        candidates.append(
            {
                "path": path,
                "base_status": base_files[path].get("status"),
                "head_status": head_files[path].get("status"),
                "base_patch": (base_files[path].get("patch") or "[unavailable]")[:6000],
                "head_patch": (head_files[path].get("patch") or "[unavailable]")[:6000],
            }
        )
    result["candidate_files"] = candidates
    return _trim(result)


def list_repo_branches(query: str | None, limit: int) -> dict[str, Any]:
    q = (query or "").lower()
    rows = []
    for b in list_branches(100):
        name = b.get("name", "")
        if q and q not in name.lower():
            continue
        rows.append({"name": name, "sha": b.get("commit", {}).get("sha")})
        if len(rows) >= limit:
            break
    return {"source": "GitHub REST branches", "branches": rows}


def search_repo_paths(query: str, ref: str | None, limit: int) -> dict[str, Any]:
    actual_ref = ref or default_branch()
    q = query.lower()
    matches = []
    for e in tree_for_ref(actual_ref):
        if e.get("type") != "blob":
            continue
        path = e.get("path", "")
        if q in path.lower():
            matches.append({"path": path, "size": e.get("size"), "sha": e.get("sha")})
            if len(matches) >= limit:
                break
    return {"source": "GitHub REST git tree path search", "ref": actual_ref, "matches": matches}


def get_commit_history(ref: str | None, path: str | None, limit: int) -> dict[str, Any]:
    actual_ref = ref or default_branch()
    params = [f"sha={quote(actual_ref)}", f"per_page={limit}"]
    if path:
        params.append(f"path={quote(path)}")
    commits = gh("GET", "/commits?" + "&".join(params))
    return {
        "source": "GitHub REST commits",
        "ref": actual_ref,
        "path": path,
        "commits": [
            {
                "sha": c.get("sha"),
                "message": c.get("commit", {}).get("message"),
                "author": c.get("author", {}).get("login") or c.get("commit", {}).get("author", {}).get("name"),
                "date": c.get("commit", {}).get("author", {}).get("date"),
            }
            for c in commits[:limit]
        ],
    }


def execute_tool(name: str, args: dict[str, Any], default_pr_number: int) -> Any:
    # Keep PR-scoped tools anchored to the PR that invoked Nana. The model cannot inspect another PR
    # by silently changing pr_number in a tool call.
    if "pr_number" in args and args["pr_number"] != default_pr_number:
        return {"error": "tool is restricted to the current PR", "current_pr": default_pr_number}

    try:
        if name == "get_pr_state":
            return get_pr_state(default_pr_number)
        if name == "get_ci_state":
            return get_ci_state(default_pr_number, args.get("ref"))
        if name == "get_pr_file_patch":
            return get_pr_file_patch(default_pr_number, str(args["path"]))
        if name == "read_repo_file":
            return read_repo_file(
                default_pr_number,
                str(args["path"]),
                str(args["source"]),
                args.get("ref"),
            )
        if name == "compare_refs":
            return compare_refs(str(args["base"]), str(args["head"]), args.get("path_prefix"))
        if name == "get_conflict_candidates":
            return get_conflict_candidates(default_pr_number)
        if name == "list_repo_branches":
            return list_repo_branches(args.get("query"), int(args["limit"]))
        if name == "search_repo_paths":
            return search_repo_paths(str(args["query"]), args.get("ref"), int(args["limit"]))
        if name == "get_commit_history":
            return get_commit_history(args.get("ref"), args.get("path"), int(args["limit"]))
        return {"error": f"unknown tool: {name}"}
    except requests.HTTPError as exc:
        return {
            "error": "GitHub API request failed",
            "status": exc.response.status_code if exc.response is not None else None,
            "tool": name,
        }
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}", "tool": name}
