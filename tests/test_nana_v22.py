from __future__ import annotations

import importlib
import inspect
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / ".github" / "scripts"
sys.path.insert(0, str(SCRIPTS))

os.environ.setdefault("GH_REPOSITORY", "owner/repo")
os.environ.setdefault("GH_TOKEN", "test")
os.environ.setdefault("GH_EVENT_NAME", "issue_comment")
event = ROOT / "tests" / "event-v22.json"
event.write_text("{}", encoding="utf-8")
os.environ.setdefault("GITHUB_EVENT_PATH", str(event))

common = importlib.import_module("nana_common")
agent = importlib.import_module("nana_agent")


def test_suggestion_function_signature_matches_nana_call():
    params = list(inspect.signature(common.post_review_with_suggestions).parameters)
    assert params == ["number", "commit_id", "suggestions", "files"]


def test_agent_exposes_read_only_tools_only():
    names = {tool["name"] for tool in agent.TOOLS}
    assert {
        "get_pr_state",
        "get_ci_state",
        "get_pr_file_patch",
        "read_repo_file",
        "compare_refs",
        "get_conflict_candidates",
        "list_repo_branches",
        "search_repo_paths",
        "get_commit_history",
    } <= names
    assert not any(
        word in name
        for name in names
        for word in ("write", "update", "delete", "push", "merge_pr", "shell", "exec")
    )


def test_tool_cannot_switch_to_another_pr():
    result = agent.execute_tool("get_pr_state", {"pr_number": 999}, default_pr_number=47)
    assert result["error"] == "tool is restricted to the current PR"


def test_conflict_candidates_are_overlap_not_asserted_conflicts(monkeypatch):
    def fake_gh(method, path, **kwargs):
        if path == "/pulls/47":
            return {
                "number": 47,
                "mergeable": False,
                "mergeable_state": "dirty",
                "base": {"sha": "base", "ref": "main"},
                "head": {"sha": "head", "ref": "feature", "repo": {"full_name": "owner/repo"}},
            }
        if path == "/compare/base...head":
            return {"merge_base_commit": {"sha": "mb"}}
        if path == "/compare/mb...base":
            return {
                "files": [
                    {"filename": "same.txt", "status": "modified", "patch": "base change"},
                    {"filename": "base-only.txt", "status": "modified", "patch": "x"},
                ]
            }
        if path == "/compare/mb...head":
            return {
                "files": [
                    {"filename": "same.txt", "status": "modified", "patch": "head change"},
                    {"filename": "head-only.txt", "status": "modified", "patch": "y"},
                ]
            }
        raise AssertionError(path)

    monkeypatch.setattr(agent, "gh", fake_gh)
    result = agent.get_conflict_candidates(47)
    assert result["mergeable"] is False
    assert result["mergeable_state"] == "dirty"
    assert [x["path"] for x in result["candidate_files"]] == ["same.txt"]
    assert "not proof" in result["note"]


def test_recent_comments_can_filter_nana(monkeypatch):
    rows = [
        {"id": 1, "body": "<!-- nana:reply:1 --> old guess", "user": {"login": "github-actions[bot]"}},
        {"id": 2, "body": "Please check this", "user": {"login": "human"}},
    ]
    monkeypatch.setattr(common, "pages", lambda *args, **kwargs: rows)
    text = common.recent_comments(47, 2)
    assert "old guess" not in text
    assert "Please check this" in text
    assert "UNTRUSTED CONVERSATION" in text


def test_apply_parser_requires_unambiguous_workflow_syntax(monkeypatch):
    event = {
        "issue": {"number": 47, "pull_request": {"url": "x"}},
        "comment": {
            "id": 123,
            "body": "@nana: apply abcdef1234",
            "author_association": "MEMBER",
            "user": {"type": "User", "login": "member"},
        },
    }
    monkeypatch.setattr(common, "EVENT_NAME", "issue_comment")
    monkeypatch.setattr(common, "EVENT", event)
    number, mode, command, comment_id, actor, association = common.invocation()
    assert number == 47
    assert command.name == "ask"
    assert "@nana apply" in command.args
