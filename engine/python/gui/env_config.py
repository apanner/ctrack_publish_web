"""Read engine/web env values from local files (no HTTP required)."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional

DEFAULT_WEB_BASE = "https://ctrackpublishweb.vercel.app"


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    try:
        raw = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def _candidate_env_paths(install_root: Path | None = None) -> list[Path]:
    home = Path(os.environ.get("USERPROFILE", str(Path.home())))
    paths: list[Path] = []
    if install_root is not None:
        root = Path(install_root)
        paths.extend([root / "engine" / ".env", root / ".env"])
    paths.append(home / ".ctrack-engine" / ".env")
    return paths


def read_env_value(key: str, install_root: Path | None = None, default: str = "") -> str:
    direct = os.environ.get(key, "").strip()
    if direct:
        return direct
    for path in _candidate_env_paths(install_root):
        value = _read_env_file(path).get(key, "").strip()
        if value:
            return value
    alias_keys = {
        "CTRACK_WEB_URL": ["VITE_APP_URL", "WEB_URL"],
        "SUPABASE_URL": ["VITE_SUPABASE_URL"],
    }
    for alias in alias_keys.get(key, []):
        alias_value = read_env_value(alias, install_root, default="")
        if alias_value:
            return alias_value
    return default


def resolve_web_base(install_root: Path | None = None) -> str:
    raw = read_env_value("CTRACK_WEB_URL", install_root, DEFAULT_WEB_BASE)
    return raw.rstrip("/") or DEFAULT_WEB_BASE


def resolve_login_url(install_root: Path | None = None) -> str:
    """Browser pairing URL on the hosted web app (replaces CustomTkinter sign-in card)."""
    return f"{resolve_web_base(install_root)}/link-engine"


def resolve_local_auth_link_url(install_root: Path | None = None) -> str:
    """Legacy local engine pairing page (fallback when web is unreachable)."""
    return "http://127.0.0.1:7777/auth/link"
