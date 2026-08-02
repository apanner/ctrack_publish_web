#!/usr/bin/env python3
"""
Deprecated: use scripts/ensure-engine-runtime.ps1 (runs automatically on npm install / pack:release).

  powershell -File scripts/ensure-engine-runtime.ps1 -TargetRoot engine
"""

from __future__ import annotations

import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional


def _engine_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _oiio_runtime_dir() -> Path:
    return _engine_root() / "runtime" / "oiio"


def setup_ocio_from_nuke(force: bool = False) -> Optional[Path]:
    """Copy Nuke aces_1.2 OCIO tree into engine/runtime/ocio (large; not in git)."""
    runtime_ocio = _engine_root() / "runtime" / "ocio" / "aces_1.2"
    config = runtime_ocio / "config.ocio"
    if config.is_file() and not force:
        print(f"OCIO already installed: {config}")
        return config

    nuke_aces = Path(r"C:\Program Files\Nuke15.1v4\plugins\OCIOConfigs\configs\aces_1.2")
    if not nuke_aces.is_dir():
        for alt in (
            Path(r"C:\Program Files\Nuke13.2v5\plugins\OCIOConfigs\configs\aces_1.2"),
        ):
            if alt.is_dir():
                nuke_aces = alt
                break
    if not nuke_aces.is_dir():
        print("Nuke aces_1.2 not found; set CTRACK_OCIO_CONFIG manually.")
        return None

    if runtime_ocio.exists():
        shutil.rmtree(runtime_ocio)
    print(f"Copying OCIO from {nuke_aces} ...")
    shutil.copytree(nuke_aces, runtime_ocio)
    print(f"Installed OCIO: {config}")
    return config


def setup_oiio(force: bool = False) -> Path:
    runtime = _oiio_runtime_dir()
    existing = list(runtime.rglob("oiiotool.exe")) if runtime.exists() else []
    if existing and not force:
        print(f"oiiotool already installed: {existing[0]}")
        return existing[0]

    if runtime.exists():
        shutil.rmtree(runtime)
    runtime.mkdir(parents=True)

    zip_url = "https://github.com/pitvfx/OpenImageIO/releases/download/v1.0.0/OpenImageIO.zip"
    zip_path = runtime / "OpenImageIO.zip"
    print(f"Downloading {zip_url} ...")
    urllib.request.urlretrieve(zip_url, zip_path)

    print("Extracting...")
    extract_to = runtime / "_extract"
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(extract_to)

    found = next(extract_to.rglob("oiiotool.exe"), None)
    if not found:
        raise RuntimeError("oiiotool.exe not found in downloaded archive")

    oiio_root = found.parent
    if found.parent.name.lower() == "bin":
        oiio_root = found.parent.parent

    for item in oiio_root.iterdir():
        dest = runtime / item.name
        if item.is_dir():
            shutil.copytree(item, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(item, dest)

    shutil.rmtree(extract_to, ignore_errors=True)
    zip_path.unlink(missing_ok=True)

    oiiotool = next(runtime.rglob("oiiotool.exe"))
    print(f"Installed oiiotool: {oiiotool}")
    return oiiotool


def main() -> int:
    print("Use: powershell -File scripts/ensure-engine-runtime.ps1 -TargetRoot engine", file=sys.stderr)
    try:
        force = "--force" in sys.argv
        setup_oiio(force=force)
        setup_ocio_from_nuke(force=force)
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
