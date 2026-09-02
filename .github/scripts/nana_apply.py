from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from nana_common import (
    REPO,
    apply_actor_allowed,
    decode_plan,
    forbidden_path,
    gh,
    pages,
    patch_paths,
)

EVENT = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def comment(pr_number: int, body: str) -> None:
    gh("POST", f"/issues/{pr_number}/comments", json={"body": body})


def parse_apply() -> tuple[int, str, str, str]:
    issue = EVENT.get("issue", {})
    c = EVENT.get("comment", {})
    if "pull_request" not in issue or c.get("user", {}).get("type") == "Bot":
        raise SystemExit(0)
    m = re.search(r"(?i)@nana\b[\s,:：-]*apply\s+([a-f0-9]{10})\b", c.get("body", ""))
    if not m:
        raise SystemExit(0)
    return issue["number"], m.group(1), c.get("user", {}).get("login", ""), c.get("author_association", "")


def find_plan(pr_number: int, plan_id: str) -> dict:
    pat = re.compile(rf"<!-- nana:plan:{re.escape(plan_id)}:([A-Za-z0-9_-]+):([a-f0-9]{{64}}) -->")
    for c in reversed(pages(f"/issues/{pr_number}/comments", limit=10)):
        m = pat.search(c.get("body") or "")
        if not m:
            continue
        return decode_plan(m.group(1), m.group(2))
    fail(f"Nana plan `{plan_id}` が見つかりません。")


def prepare() -> None:
    pr_number, plan_id, actor, association = parse_apply()
    if not apply_actor_allowed(actor, association):
        comment(pr_number, "🌸 Nana: このアカウントにはNana Applyを実行する許可がありません。")
        fail("actor not allowed")

    pr = gh("GET", f"/pulls/{pr_number}")
    plan = find_plan(pr_number, plan_id)

    if plan.get("repo") != REPO or plan.get("pr") != pr_number:
        fail("plan repository/PR mismatch")
    if pr["head"]["repo"]["full_name"] != REPO:
        comment(pr_number, "🌸 Nana: 安全のためfork PRへの自動pushは行いません。Suggestionまたは手動適用を使ってください。")
        fail("fork PR apply is disabled")
    if pr["head"]["sha"] != plan.get("head_sha"):
        comment(pr_number, "🌸 Nana: PRのHEADがPlan作成後に更新されたため、このPlanは無効です。もう一度 `@nana fix` を実行してください。")
        fail("head moved")
    if pr["head"]["ref"] != plan.get("head_ref"):
        fail("head ref mismatch")
    if pr["head"]["ref"] == pr["base"]["ref"]:
        fail("refusing to write base branch directly")

    patch = str(plan.get("patch") or "")
    paths = patch_paths(patch)
    if paths != sorted(set(plan.get("paths") or [])):
        fail("plan path mismatch")
    if any(forbidden_path(p) for p in paths):
        fail("forbidden apply path")

    Path("/tmp/nana-plan.json").write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
    Path("/tmp/nana.patch").write_text(patch, encoding="utf-8")

    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as f:
            f.write(f"head_ref={pr['head']['ref']}\n")
            f.write(f"head_sha={pr['head']['sha']}\n")
            f.write(f"plan_id={plan_id}\n")
            f.write(f"pr_number={pr_number}\n")


def verify_worktree() -> None:
    plan = json.loads(Path("/tmp/nana-plan.json").read_text(encoding="utf-8"))
    expected = sorted(set(plan["paths"]))
    result = subprocess.run(
        ["git", "diff", "--name-only"],
        check=True,
        capture_output=True,
        text=True,
    )
    actual = sorted(x.strip() for x in result.stdout.splitlines() if x.strip())
    if actual != expected:
        fail(f"worktree path mismatch: expected={expected}, actual={actual}")


def complete() -> None:
    plan = json.loads(Path("/tmp/nana-plan.json").read_text(encoding="utf-8"))
    pr_number = int(plan["pr"])
    comment(
        pr_number,
        "🌸 Nana Apply: 署名済みPlanをPRブランチへコミットしました。\n\n"
        f"- Files: {', '.join(f'`{p}`' for p in plan['paths'])}\n"
        "- CI結果を確認してからマージしてください。",
    )


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "prepare"
    if mode == "prepare":
        prepare()
    elif mode == "verify":
        verify_worktree()
    elif mode == "complete":
        complete()
    else:
        fail(f"unknown mode: {mode}")
