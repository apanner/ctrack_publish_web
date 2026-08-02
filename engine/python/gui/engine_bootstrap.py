"""Ensure the local Node engine is listening on 127.0.0.1:7777."""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

from gui.api import engine_supports_auth, health_ok


def _node_exe(install_root: Path, engine_dir: Path) -> str:
    bundled = install_root / "runtime" / "node.exe"
    if bundled.is_file():
        return str(bundled)
    alt = engine_dir / "runtime" / "node.exe"
    if alt.is_file():
        return str(alt)
    return "node"


def ensure_engine_running(install_root: Path, engine_dir: Path, *, timeout_sec: float = 12.0) -> bool:
    if health_ok() and engine_supports_auth():
        return True
    server_js = engine_dir / "dist" / "server.js"
    if not server_js.is_file():
        return health_ok()
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    subprocess.Popen(
        [_node_exe(install_root, engine_dir), "dist/server.js"],
        cwd=str(engine_dir),
        creationflags=flags,
    )
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if health_ok() and engine_supports_auth():
            return True
        time.sleep(0.25)
    return health_ok()
