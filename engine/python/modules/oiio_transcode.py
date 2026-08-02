"""
EXR sequence → review MP4 via bundled oiiotool (OCIO) + ffmpeg.

Matches sample.nk intent: ACEScg comp → fit 1080 → ACES display / sRGB view → H.264 MP4.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Callable, Optional

from modules.utils import get_ocio_config_path, run_ffmpeg, run_oiiotool


def _uses_aces12_display(ocio_config: str) -> bool:
    low = ocio_config.replace("\\", "/").lower()
    return "aces_1.2" in low or low.endswith("/config.ocio")


def _pattern_for_oiiotool(pattern: str) -> str:
    return pattern.replace("\\", "/")


def transcode_exr_oiio_to_mp4(
    input_pattern: str,
    output_mp4: str,
    options: Optional[dict] = None,
    log_callback: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Transcode EXR sequence to MP4 using oiiotool + ffmpeg.

    options:
      frame_start, frame_end (or start_frame)
      fps (default 24)
      ocio_config (optional path)
      in_colorspace (default 'ACES - ACEScg')
      display (default 'ACES')
      view (default 'sRGB')
      width, height (default 1920, 1080) — fit like sample.nk Reformat
      video_bitrate (default 15000k, matches sample Write)
    """
    opts = options or {}
    frame_start = int(opts.get("frame_start") or opts.get("start_frame") or 1001)
    frame_end = int(opts.get("frame_end") or frame_start)
    fps = float(opts.get("fps") or 24)
    width = int(opts.get("width") or 1920)
    height = int(opts.get("height") or 1080)
    in_cs = str(opts.get("in_colorspace") or "ACES - ACEScg")
    display = str(opts.get("display") or "ACES")
    view = str(opts.get("view") or "sRGB")
    bitrate = str(opts.get("video_bitrate") or "15000k")
    ocio_config = get_ocio_config_path(opts.get("ocio_config"))

    if not ocio_config:
        return {
            "status": "error",
            "message": "OCIO config not found. Run engine/python/scripts/setup_oiio.py or set CTRACK_OCIO_CONFIG.",
        }

    output_mp4 = os.path.abspath(output_mp4)
    os.makedirs(os.path.dirname(output_mp4) or ".", exist_ok=True)
    work_dir = Path(output_mp4).parent / "_oiio_srgb"
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    seq_pattern = str(work_dir / "frame.%04d.png")
    input_pattern = _pattern_for_oiiotool(input_pattern)

    if log_callback:
        log_callback(f"[oiio] OCIO: {ocio_config}")
        log_callback(f"[oiio] {frame_start}-{frame_end} {input_pattern}")

    oiiotool_cmd = [
        input_pattern,
        "--frames",
        f"{frame_start}-{frame_end}",
        "--colorconfig",
        ocio_config.replace("\\", "/"),
        "--fit",
        f"{width}x{height}",
    ]
    if _uses_aces12_display(ocio_config):
        oiiotool_cmd.append(f"--ociodisplay:from={in_cs}")
        oiiotool_cmd.extend([display, view])
    else:
        oiiotool_cmd.extend(["--colorconvert", in_cs, "sRGB - Display"])
    oiiotool_cmd.extend(["-o", seq_pattern.replace("\\", "/")])
    if log_callback:
        log_callback("[oiio] " + " ".join(oiiotool_cmd[:6]) + " ...")

    code, _, err = run_oiiotool(oiiotool_cmd, log_callback=log_callback, ocio_config=ocio_config)
    if code != 0:
        return {"status": "error", "message": err[-4000:] or "oiiotool failed"}

    ff_cmd = [
        "-y",
        "-framerate",
        str(fps),
        "-start_number",
        str(frame_start),
        "-i",
        str(work_dir / "frame.%04d.png").replace("\\", "/"),
        "-c:v",
        "libx264",
        "-b:v",
        bitrate,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-color_primaries",
        "bt709",
        "-colorspace",
        "bt709",
        "-color_trc",
        "iec61966-2-1",
        output_mp4.replace("\\", "/"),
    ]
    if log_callback:
        log_callback("[ffmpeg] encode MP4")
    ret, _, ff_err = run_ffmpeg(ff_cmd, log_callback=log_callback)
    if ret != 0:
        return {"status": "error", "message": ff_err[-4000:] or "ffmpeg failed"}

    if not os.path.isfile(output_mp4):
        return {"status": "error", "message": f"Output missing: {output_mp4}"}

    return {
        "status": "success",
        "output": output_mp4,
        "method": "oiio_ocio",
        "ocio_config": ocio_config,
    }
