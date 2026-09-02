from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("GH_REPOSITORY", "owner/repo")
os.environ.setdefault("GH_TOKEN", "test")
os.environ.setdefault("GH_EVENT_NAME", "issue_comment")
event = ROOT / "tests" / "event.json"
event.write_text("{}", encoding="utf-8")
os.environ.setdefault("GITHUB_EVENT_PATH", str(event))

spec = importlib.util.spec_from_file_location(
    "nana_common",
    ROOT / ".github" / "scripts" / "nana_common.py",
)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules["nana_common"] = mod
spec.loader.exec_module(mod)


def test_patch_paths_existing_file():
    patch = """diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new
"""
    assert mod.patch_paths(patch) == ["a.txt"]
    assert mod.validate_existing_file_patch(patch) == []


def test_reject_new_file():
    patch = """diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
"""
    errors = mod.validate_existing_file_patch(patch)
    assert errors


def test_reject_delete():
    patch = """diff --git a/a.txt b/a.txt
deleted file mode 100644
--- a/a.txt
+++ /dev/null
@@ -1 +0,0 @@
-old
"""
    errors = mod.validate_existing_file_patch(patch)
    assert errors


def test_reject_rename():
    patch = """diff --git a/a.txt b/b.txt
similarity index 100%
rename from a.txt
rename to b.txt
"""
    errors = mod.validate_existing_file_patch(patch)
    assert errors


def test_forbidden_paths():
    assert mod.forbidden_path(".github/workflows/x.yml")
    assert mod.forbidden_path(".github/scripts/nana.py")
    assert mod.forbidden_path("CODEOWNERS")
    assert not mod.forbidden_path("backend/auth.go")
