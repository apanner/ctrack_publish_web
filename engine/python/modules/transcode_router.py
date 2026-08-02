"""
EXR transcode router: Nuke (sample.nk) → OpenImageIO → FFmpeg zscale.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, Dict, List, Optional

from modules.engine_settings import get_preferred_nuke_exe, get_review_template_path, load_settings
from modules.transcode import _is_exr_sequence_path, transcode_sequence as ffmpeg_transcode_sequence


def _log(log_callback: Optional[Callable[[str], None]], msg: str) -> None:
    if log_callback:
        log_callback(msg)


def _try_nuke(
    input_path: str,
    output_path: str,
    options: dict,
    log_callback: Optional[Callable[[str], None]],
) -> Optional[dict]:
    from modules.nuke_detect import resolve_sample_nk_template
    from modules.nuke_render import patch_nk_script, run_nuke_execute

    settings = load_settings()
    nuke_exe = options.get("nuke_exe") or get_preferred_nuke_exe(settings)
    if not nuke_exe or not os.path.isfile(nuke_exe):
        return None
    template = (
        options.get("nuke_template")
        or get_review_template_path(settings)
        or resolve_sample_nk_template()
    )
    if not template or not os.path.isfile(template):
        _log(log_callback, "[transcode] Nuke skipped: review_mp4.nk template missing")
        return None

    frame_start = int(options.get("frame_start") or options.get("start_frame") or 1001)
    frame_end = int(options.get("frame_end") or frame_start)
    from modules.review_output import get_review_mp4_dimensions

    width, height, _preset = get_review_mp4_dimensions(settings)
    if options.get("width"):
        width = int(options["width"])
    if options.get("height"):
        height = int(options["height"])

    work_dir = Path(output_path).parent
    work_dir.mkdir(parents=True, exist_ok=True)
    nk_path = work_dir / f"_nuke_render_{Path(output_path).stem}.nk"
    patched = patch_nk_script(
        Path(template).read_text(encoding="utf-8"),
        read_pattern=input_path,
        frame_start=frame_start,
        frame_end=frame_end,
        output_mp4=output_path,
        width=width,
        height=height,
    )
    nk_path.write_text(patched, encoding="utf-8")

    nuke_interactive = options.get("nuke_interactive")
    if nuke_interactive is None:
        nuke_interactive = settings.get("nukeInteractive", True)
    nuke_safe = options.get("nuke_safe_mode")
    if nuke_safe is None:
        nuke_safe = settings.get("nukeSafeMode", True)

    _log(log_callback, f"[transcode] Nuke render ({Path(nuke_exe).name}) {width}x{height} frames {frame_start}-{frame_end}")
    code, elapsed, log = run_nuke_execute(
        nuke_exe=Path(nuke_exe),
        nk_path=nk_path,
        frame_start=frame_start,
        frame_end=frame_end,
        interactive_license=bool(nuke_interactive),
        safe_mode=bool(nuke_safe),
        quiet=True,
    )
    if code != 0:
        _log(log_callback, f"[transcode] Nuke failed ({elapsed:.1f}s): {(log or '')[-500:]}")
        return None
    if not os.path.isfile(output_path):
        mov = str(Path(output_path).with_suffix(".mov"))
        if os.path.isfile(mov):
            os.replace(mov, output_path)
    if not os.path.isfile(output_path):
        return None
    return {
        "status": "success",
        "output": output_path,
        "method": "nuke",
        "elapsed_sec": elapsed,
    }


def _try_oiio(
    input_path: str,
    output_path: str,
    options: dict,
    log_callback: Optional[Callable[[str], None]],
) -> Optional[dict]:
    from modules.oiio_transcode import transcode_exr_oiio_to_mp4
    from modules.utils import get_oiiotool_path, get_ocio_config_path

    if not os.path.isfile(get_oiiotool_path()):
        return None
    if not get_ocio_config_path(options.get("ocio_config")):
        return None
    from modules.review_output import get_review_mp4_dimensions

    settings = load_settings()
    width, height, _preset = get_review_mp4_dimensions(settings)
    opts = dict(options or {})
    opts.setdefault("width", width)
    opts.setdefault("height", height)
    _log(log_callback, f"[transcode] OpenImageIO + OCIO ({width}x{height})")
    return transcode_exr_oiio_to_mp4(input_path, output_path, opts, log_callback=log_callback)


def transcode_exr_smart(
    input_path: str,
    output_path: str,
    options: Optional[dict] = None,
    log_callback: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Try backends in order from settings (default: nuke → oiio → ffmpeg).
    """
    if not _is_exr_sequence_path(input_path):
        return ffmpeg_transcode_sequence(input_path, output_path, options, log_callback)

    opts = dict(options or {})
    settings = load_settings()
    order: List[str] = list(opts.get("exr_transcode_order") or settings.get("exrTranscodeOrder") or ["nuke", "oiio", "ffmpeg"])

    errors: List[str] = []
    for backend in order:
        key = backend.strip().lower()
        if key == "nuke":
            result = _try_nuke(input_path, output_path, opts, log_callback)
        elif key == "oiio":
            result = _try_oiio(input_path, output_path, opts, log_callback)
        elif key == "ffmpeg":
            _log(log_callback, "[transcode] FFmpeg zscale fallback")
            result = ffmpeg_transcode_sequence(input_path, output_path, opts, log_callback)
        else:
            continue
        if result and result.get("status") == "success":
            result["backend"] = key
            return result
        if result and result.get("message"):
            errors.append(f"{key}: {result.get('message')}")
        elif result is None and key in ("nuke", "oiio"):
            errors.append(f"{key}: not available")

    return {
        "status": "error",
        "message": "All EXR transcode backends failed. " + "; ".join(errors[-3:]),
    }
