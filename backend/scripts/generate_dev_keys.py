#!/usr/bin/env python3
"""開発環境の認証・鍵フロー確認用シークレットを生成する。"""

from __future__ import annotations

import argparse
import base64
import secrets


def random_base64url(byte_length: int = 32) -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(byte_length)).rstrip(b"=").decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="開発用 JWS 署名鍵と端末側の鍵フロー確認値を生成します。"
    )
    parser.add_argument(
        "--server-only",
        action="store_true",
        help="JWS 署名鍵だけを出力します。",
    )
    args = parser.parse_args()

    print("# backend/.env に設定する開発用サーバー鍵")
    print(f"JWS_SIGNING_KEY={random_base64url()}")

    if args.server_only:
        return

    print()
    print("# 端末側の鍵フローを手動確認するための値（backend/.env や DB には保存しない）")
    print(f"DEV_TEST_KEY_A={random_base64url()}")
    print(f"DEV_TEST_RECOVERY_KEY={random_base64url()}")
    print()
    print("# 注記: 本番用鍵の生成・保管には使用せず、Secret Manager / KMS を利用すること。")


if __name__ == "__main__":
    main()
