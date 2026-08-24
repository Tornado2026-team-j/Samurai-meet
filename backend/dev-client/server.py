"""Serve the backend dev client and proxy /api/* to the local backend.

The same-origin proxy is intentionally for development only. It lets an
existing Cloudflare Tunnel pointing at port 5173 exercise the local API without
exposing PostgreSQL or requiring a second public hostname.
"""

from __future__ import annotations

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class DevClientHandler(SimpleHTTPRequestHandler):
    backend_url = "http://127.0.0.1:8080"
    directory = str(Path(__file__).resolve().parent)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        self._handle_request()

    def do_POST(self) -> None:
        self._handle_request()

    def do_DELETE(self) -> None:
        self._handle_request()

    def do_OPTIONS(self) -> None:
        self._handle_request()

    def _handle_request(self) -> None:
        parsed = urlsplit(self.path)
        if not (parsed.path.startswith("/api/") or parsed.path == "/auth/callback"):
            super().do_GET()
            return

        target = f"{self.backend_url}{parsed.path}"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else None
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in {"host", "connection", "content-length"}
        }
        request = Request(target, data=body, headers=headers, method=self.command)

        try:
            with urlopen(request, timeout=10) as response:
                self._write_proxy_response(response.status, response.headers, response.read())
        except HTTPError as error:
            self._write_proxy_response(error.code, error.headers, error.read())
        except URLError as error:
            payload = json.dumps({"error": "backend_unavailable", "detail": str(error.reason)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def _write_proxy_response(self, status: int, headers: object, body: bytes) -> None:
        self.send_response(status)
        for key in ("Content-Type", "Location"):
            value = headers.get(key)  # type: ignore[union-attr]
            if value:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--backend-url", default="http://127.0.0.1:8080")
    args = parser.parse_args()

    DevClientHandler.backend_url = args.backend_url.rstrip("/")
    server = ThreadingHTTPServer((args.host, args.port), DevClientHandler)
    print(f"dev client listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
