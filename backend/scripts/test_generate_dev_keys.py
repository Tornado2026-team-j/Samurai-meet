from __future__ import annotations

import base64
import subprocess
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("generate_dev_keys.py")


def decode_base64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class GenerateDevKeysTest(unittest.TestCase):
    def test_default_output_contains_three_256_bit_values(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT)], text=True, capture_output=True, check=True
        )
        values = {
            line.split("=", 1)[0]: line.split("=", 1)[1]
            for line in result.stdout.splitlines()
            if line.startswith(("JWS_SIGNING_KEY=", "DEV_TEST_KEY_A=", "DEV_TEST_RECOVERY_KEY="))
        }

        self.assertEqual(set(values), {"JWS_SIGNING_KEY", "DEV_TEST_KEY_A", "DEV_TEST_RECOVERY_KEY"})
        for value in values.values():
            self.assertEqual(len(decode_base64url(value)), 32)

    def test_server_only_output_excludes_client_fixture_values(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--server-only"], text=True, capture_output=True, check=True
        )

        self.assertIn("JWS_SIGNING_KEY=", result.stdout)
        self.assertNotIn("DEV_TEST_KEY_A=", result.stdout)
        self.assertNotIn("DEV_TEST_RECOVERY_KEY=", result.stdout)
