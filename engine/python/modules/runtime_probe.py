"""Runtime dependency probe for engine status API."""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

from modules.engine_settings import _settings_path, get_preferred_nuke_exe, get_review_template_path, load_settings
from modules.nuke_detect import detect_nuke_installations, resolve_sample_nk_template
from modules.utils import get_ffmpeg_path, get_ocio_config_path, get_oiiotool_path


def _engine_root() -> str:
    from modules.utils import _engine_root as root

    return str(root())


def _file_ok(path: str) -> bool:
    return bool(path) and path != "ffmpeg" and path != "oiiotool" and os.path.isfile(path)


def probe_runtime() -> Dict[str, Any]:
    settings = load_settings()
    nuke_installs = detect_nuke_installations()
    if nuke_installs and not settings.get("nukeInstallations"):
        from modules.engine_settings import set_nuke_installations

        settings = set_nuke_installations(nuke_installs)

    ffmpeg = get_ffmpeg_path()
    oiiotool = get_oiiotool_path()
    ocio = get_ocio_config_path()
    nuke_exe = get_preferred_nuke_exe()
    template = get_review_template_path(settings) or resolve_sample_nk_template() or settings.get("sampleNkTemplate")

    bundled_python = os.path.join(_engine_root(), "runtime", "python", "python.exe")
    has_bundled_python = os.path.isfile(bundled_python)

    tools = {
        "ffmpeg": {"available": _file_ok(ffmpeg), "path": ffmpeg if _file_ok(ffmpeg) else None},
        "oiiotool": {"available": _file_ok(oiiotool), "path": oiiotool if _file_ok(oiiotool) else None},
        "ocio": {"available": bool(ocio), "path": ocio},
        "nuke": {"available": bool(nuke_exe and os.path.isfile(nuke_exe)), "path": nuke_exe},
        "nukeTemplate": {"available": bool(template and os.path.isfile(str(template))), "path": template},
        "python": {
            "available": has_bundled_python or bool(sys.executable),
            "path": bundled_python if has_bundled_python else sys.executable,
            "bundled": has_bundled_python,
        },
    }

    exr_order: List[str] = list(settings.get("exrTranscodeOrder") or ["nuke", "oiio", "ffmpeg"])
    active_backend = None
    for name in exr_order:
        if name == "nuke" and tools["nuke"]["available"] and tools["nukeTemplate"]["available"]:
            active_backend = "nuke"
            break
        if name == "oiio" and tools["oiiotool"]["available"] and tools["ocio"]["available"]:
            active_backend = "oiio"
            break
        if name == "ffmpeg" and tools["ffmpeg"]["available"]:
            active_backend = "ffmpeg"
            break

    missing: List[str] = []
    if not tools["ffmpeg"]["available"]:
        missing.append("ffmpeg")
    if not tools["python"]["available"]:
        missing.append("python")

    return {
        "engineRoot": _engine_root(),
        "settingsPath": _settings_path(),
        "tools": tools,
        "nukeInstallations": settings.get("nukeInstallations") or nuke_installs,
        "preferredNukeExe": nuke_exe,
        "exrTranscodeOrder": exr_order,
        "activeExrBackend": active_backend,
        "lastToolScanAt": settings.get("lastToolScanAt"),
        "missing": missing,
    }
