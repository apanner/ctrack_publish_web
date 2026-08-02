"""Resolve install paths for tray and settings."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def resolve_install_root(explicit: str | None = None) -> Path:
    if explicit:
        root = Path(explicit).resolve()
    else:
        root = Path(__file__).resolve().parents[2]
    if (root / "engine" / "dist" / "server.js").is_file():
        return root
    parent = root.parent
    if (parent / "engine" / "dist" / "server.js").is_file():
        return parent
    if (root / "dist" / "server.js").is_file():
        return root.parent
    return root


def get_engine_dir(install_root: Path | None = None) -> Path:
    root = install_root or resolve_install_root()
    engine = root / "engine"
    if (engine / "python" / "engine.py").is_file():
        return engine
    return root


def get_python_dir(install_root: Path | None = None) -> Path:
    root = install_root or resolve_install_root()
    for candidate in (
        root / "runtime" / "python",
        root / "engine" / "runtime" / "python",
    ):
        exe = candidate / "python.exe"
        if exe.is_file():
            return candidate
    return root / "runtime" / "python"


def get_icon_png(engine_dir: Path) -> Path:
    return engine_dir / "assets" / "ctrack-engine-icon.png"


def get_icon_ico(engine_dir: Path) -> Path:
    return engine_dir / "assets" / "ctrack-tray.ico"


def get_tray_bat(install_root: Path) -> Path:
    for candidate in (
        install_root / "start-engine-tray.bat",
        install_root / "scripts" / "start-engine-tray.bat",
    ):
        if candidate.is_file():
            return candidate
    return install_root / "start-engine-tray.bat"


def ensure_gui_path() -> None:
    python_dir = Path(__file__).resolve().parents[1]
    if str(python_dir) not in sys.path:
        sys.path.insert(0, str(python_dir))
