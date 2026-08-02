"""
Detect Foundry Nuke installations on Windows.
"""

from __future__ import annotations

import glob
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional


def _parse_version_from_path(exe_path: str) -> str:
    parent = Path(exe_path).parent.name
    match = re.search(r"Nuke(\d+(?:\.\d+)?)", parent, re.I)
    if match:
        return match.group(1)
    match = re.search(r"Nuke(\d+(?:\.\d+)?)", Path(exe_path).name, re.I)
    if match:
        return match.group(1)
    return "unknown"


def detect_nuke_installations() -> List[Dict[str, Any]]:
    """Return sorted list (newest first) of Nuke executables."""
    found: List[Dict[str, Any]] = []
    patterns = [
        r"C:\Program Files\Nuke*\Nuke*.exe",
        r"C:\Program Files (x86)\Nuke*\Nuke*.exe",
    ]
    env_exe = os.environ.get("NUKE_EXE") or os.environ.get("NUKE_PATH")
    if env_exe:
        p = Path(env_exe)
        if p.is_file():
            found.append(_entry(str(p)))
        elif (p / "Nuke15.1.exe").is_file():
            found.append(_entry(str(p / "Nuke15.1.exe")))

    seen = set()
    for pattern in patterns:
        for match in glob.glob(pattern):
            low = match.lower()
            if "crash" in low or "nukeassist" in low:
                continue
            if "nuke" not in Path(match).stem.lower():
                continue
            if match in seen:
                continue
            seen.add(match)
            found.append(_entry(match))

    found.sort(key=lambda x: x.get("sortKey", ""), reverse=True)
    return found


def _entry(exe_path: str) -> Dict[str, Any]:
    version = _parse_version_from_path(exe_path)
    label = f"Nuke {version} ({Path(exe_path).parent.name})"
    return {
        "exePath": exe_path.replace("\\", "/"),
        "version": version,
        "label": label,
        "sortKey": version,
    }


def resolve_sample_nk_template() -> Optional[str]:
    engine_root = Path(__file__).resolve().parent.parent.parent
    candidates = [
        engine_root / "python" / "templates" / "review_mp4.nk",
        engine_root.parent.parent / "sample.nk",
    ]
    for path in candidates:
        if path.is_file():
            return str(path)
    return None
