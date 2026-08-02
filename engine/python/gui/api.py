"""HTTP client for engine settings and status API."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

DEFAULT_BASE = "http://127.0.0.1:7777"


class EngineApiError(Exception):
    pass


def _request(
    method: str,
    path: str,
    *,
    base: str = DEFAULT_BASE,
    body: Optional[Dict[str, Any]] = None,
    timeout: float = 12.0,
) -> Dict[str, Any]:
    url = f"{base.rstrip('/')}{path}"
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise EngineApiError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise EngineApiError(str(exc.reason)) from exc


def health_ok(base: str = DEFAULT_BASE) -> bool:
    try:
        data = _request("GET", "/health", base=base, timeout=3.0)
        return data.get("status") == "ok"
    except EngineApiError:
        return False


def get_settings(base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("GET", "/api/engine/settings", base=base)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Settings unavailable")
    return data


def patch_settings(engine_patch: Dict[str, Any], tray_patch: Dict[str, Any], base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request(
        "PATCH",
        "/api/engine/settings",
        base=base,
        body={"engine": engine_patch, "tray": tray_patch},
        timeout=20.0,
    )
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Save failed")
    return data


def rescan_tools(base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("POST", "/api/engine/rescan", base=base, body={}, timeout=45.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Rescan failed")
    return data


def get_status(base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("GET", "/api/engine/status", base=base, timeout=6.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Status unavailable")
    return data


def get_auth_status(base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("GET", "/api/auth/status", base=base, timeout=6.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Auth status unavailable")
    return data


def unpair_account(base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("POST", "/api/auth/unpair", base=base, body={}, timeout=10.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Failed to unlink account")
    return data


def get_logs_tail(limit: int = 200, base: str = DEFAULT_BASE) -> Dict[str, Any]:
    try:
        data = _request("GET", f"/api/logs/tail?limit={limit}", base=base, timeout=8.0)
        if data.get("ok"):
            return data
    except EngineApiError:
        pass
    return _read_local_logs_tail(limit)


def _read_local_logs_tail(limit: int) -> Dict[str, Any]:
    import os
    from pathlib import Path

    user_dir = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".ctrack-engine"
    names = ["engine.log", "tray.log", "server.log", "ctrack-engine.log"]
    lines: list[str] = []
    per_file = max(3, limit // len(names))
    for name in names:
        path = user_dir / name
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        tail = content[-per_file:]
        lines.extend(f"[{name}] {line}" for line in tail)
    if not lines:
        return {"ok": True, "lines": ["No local log files found. Restart engine from tray to refresh."]}
    return {"ok": True, "lines": lines[-limit:]}


def get_publish_jobs(limit: int = 20, base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("GET", f"/api/publish/jobs?limit={limit}", base=base, timeout=8.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Jobs unavailable")
    return data


def open_gui_panel(panel: str = "logs", base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("POST", "/api/gui/open", base=base, body={"panel": panel}, timeout=10.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Could not open GUI")
    return data


def get_login_url(base: str = DEFAULT_BASE, install_root: str | None = None) -> Dict[str, Any]:
    try:
        data = _request("GET", "/api/auth/login-url", base=base, timeout=4.0)
        if data.get("ok"):
            url = str(data.get("url") or "").strip()
            if url:
                return data
    except EngineApiError:
        pass
    from gui.env_config import resolve_login_url
    from gui.paths import resolve_install_root

    root = resolve_install_root(install_root) if install_root else None
    url = resolve_login_url(root)
    return {"ok": True, "url": url, "source": "local"}


def engine_supports_auth(base: str = DEFAULT_BASE) -> bool:
    try:
        data = _request("GET", "/api/auth/status", base=base, timeout=3.0)
        return "paired" in data
    except EngineApiError as exc:
        if "404" in str(exc):
            return False
    try:
        data = _request("GET", "/api", base=base, timeout=3.0)
        routes = data.get("routes")
        if isinstance(routes, list):
            return any(
                isinstance(route, dict) and route.get("path") == "/api/auth/status"
                for route in routes
            )
    except EngineApiError:
        return False
    return False


def check_for_update(base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("GET", "/api/update/check", base=base, timeout=20.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Update check failed")
    return data


def download_update(base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("POST", "/api/update/download", base=base, body={}, timeout=180.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Update download failed")
    return data


def apply_update(base: str = DEFAULT_BASE) -> Dict[str, Any]:
    data = _request("POST", "/api/update/apply", base=base, body={}, timeout=20.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Update apply failed")
    return data


def get_templates(base: str = DEFAULT_BASE) -> list[Dict[str, Any]]:
    data = _request("GET", "/api/templates", base=base, timeout=6.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Templates unavailable")
    templates = data.get("templates")
    if not isinstance(templates, list):
        return []
    return [item for item in templates if isinstance(item, dict)]


def import_template(
    *,
    file_name: str,
    file_content_base64: str,
    category: str = "review",
    base: str = DEFAULT_BASE,
) -> Dict[str, Any]:
    data = _request(
        "POST",
        "/api/templates/import",
        base=base,
        body={
            "fileName": file_name,
            "fileContentBase64": file_content_base64,
            "category": category,
        },
        timeout=20.0,
    )
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Template import failed")
    return data


def push_templates(
    *,
    target_dir: Optional[str] = None,
    source_dir: Optional[str] = None,
    mode: Optional[str] = None,
    base: str = DEFAULT_BASE,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {}
    if target_dir:
        body["targetDir"] = target_dir
    if source_dir:
        body["sourceDir"] = source_dir
    if mode:
        body["mode"] = mode
    data = _request("POST", "/api/templates/push", base=base, body=body, timeout=45.0)
    if not data.get("ok"):
        raise EngineApiError(data.get("error") or "Template sync failed")
    return data
