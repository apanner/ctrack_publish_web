"""Read pairing state from local credentials file (no HTTP required)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict


def get_credentials_path() -> Path:
    return Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".ctrack-engine" / "credentials.json"


def get_engine_data_dir() -> Path:
    return get_credentials_path().parent


def consume_pair_complete_signal() -> bool:
    path = get_engine_data_dir() / "login-complete.touch"
    if not path.is_file():
        return False
    try:
        path.unlink()
    except OSError:
        pass
    return True


def read_local_auth_status() -> Dict[str, Any]:
    path = get_credentials_path()
    if not path.is_file():
        return {"paired": False}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"paired": False}
    device_id = str(data.get("deviceId") or "").strip()
    user_id = str(data.get("userId") or "").strip()
    refresh = str(data.get("refreshToken") or data.get("deviceToken") or "").strip()
    paired_at = str(data.get("pairedAt") or "").strip()
    paired = bool(device_id and user_id and refresh and paired_at)
    return {
        "paired": paired,
        "email": str(data.get("email") or "").strip() or None,
        "deviceId": device_id or None,
        "userId": user_id or None,
    }


def is_locally_paired() -> bool:
    return bool(read_local_auth_status().get("paired"))
