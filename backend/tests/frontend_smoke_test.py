"""フロントエンドからの接続を想定した、HTTP API のスモークテスト。"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


BACKEND_DIR = Path(__file__).resolve().parents[1]


def unused_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class FrontendSmokeTest(unittest.TestCase):
    """モバイルアプリが最初に利用する接続確認 API を検証する。"""

    @classmethod
    def setUpClass(cls) -> None:
        if os.environ.get("RUN_DATABASE_SMOKE_TEST") != "1":
            raise unittest.SkipTest("PostgreSQL を起動し RUN_DATABASE_SMOKE_TEST=1 を設定すると実行します")
        cls.port = unused_local_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        environment = os.environ.copy()
        environment["HTTP_ADDR"] = f"127.0.0.1:{cls.port}"
        cls.build_dir = tempfile.TemporaryDirectory()
        executable_name = "backend-server.exe" if os.name == "nt" else "backend-server"
        executable = Path(cls.build_dir.name) / executable_name
        subprocess.run(
            ["go", "build", "-o", str(executable), "./cmd/server"],
            cwd=BACKEND_DIR,
            env=environment,
            check=True,
        )
        cls.server = subprocess.Popen(
            [str(executable)],
            cwd=BACKEND_DIR,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if cls.server.poll() is not None:
                output = cls.server.stdout.read() if cls.server.stdout else ""
                raise RuntimeError(f"バックエンドの起動に失敗しました:\n{output}")
            try:
                with urlopen(f"{cls.base_url}/api/v1/healthz", timeout=1) as response:
                    if response.status == 200:
                        return
            except URLError:
                time.sleep(0.2)

        raise TimeoutError("バックエンドが 20 秒以内に起動しませんでした")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=5)
        cls.build_dir.cleanup()

    def get_json(self, path: str) -> tuple[int, str, dict[str, str]]:
        with urlopen(f"{self.base_url}{path}", timeout=3) as response:
            return response.status, response.headers["Content-Type"], json.load(response)

    def test_health_check_is_available_to_the_frontend(self) -> None:
        status, content_type, body = self.get_json("/api/v1/healthz")

        self.assertEqual(status, 200)
        self.assertIn("application/json", content_type)
        self.assertEqual(body, {"status": "ok"})

    def test_readiness_check_is_available_to_the_frontend(self) -> None:
        status, content_type, body = self.get_json("/api/v1/readyz")

        self.assertEqual(status, 200)
        self.assertIn("application/json", content_type)
        self.assertEqual(body, {"status": "ready"})


if __name__ == "__main__":
    sys.exit(unittest.main())
