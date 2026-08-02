#!/usr/bin/env python3
"""
Encode a short EXR slice through the same transcode path as the CTrack engine (colorspace + zscale).
Output goes to <track>/ctrack_publish_test_output/ for side-by-side review.

Usage (from repo root or engine):
  python engine/scripts/test_exr_colorspace_engine.py
  python engine/scripts/test_exr_colorspace_engine.py --input "D:\\\\seq\\\\shot.%04d.exr" --start 1001 --end 1010
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Optional


def _engine_python_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "python"


def _track_root() -> Path:
    # engine -> ctrack_publish_web -> track
    return Path(__file__).resolve().parent.parent.parent.parent


def _default_output_dir() -> Path:
    return _track_root() / "ctrack_publish_test_output"


def _transcode(
    *,
    input_pattern: str,
    output_path: Path,
    frame_start: int,
    frame_end: int,
    exr_colorspace: Optional[str],
    log: bool,
) -> int:
    py = _engine_python_dir()
    sys.path.insert(0, str(py))
    os.chdir(py)
    from modules.transcode import transcode_sequence  # noqa: E402

    def log_cb(msg: str) -> None:
        if log:
            print(msg, flush=True)

    opts: dict = {
        "frame_start": frame_start,
        "frame_end": frame_end,
        "start_frame": frame_start,
        "fps": 24,
        "codec": "libx265",
        "crf": 24,
        "preset": "slow",
        "pixel_format": "yuv420p",
        "threads": max(1, (os.cpu_count() or 4) // 2),
        "chunked_enabled": False,
    }
    if exr_colorspace is not None:
        opts["exr_colorspace"] = exr_colorspace

    result = transcode_sequence(
        input_pattern,
        str(output_path),
        opts,
        log_callback=log_cb if log else None,
    )
    if result.get("status") != "success":
        print(result.get("message", result), file=sys.stderr)
        return 1
    print(f"[ok] Wrote {output_path}", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Test engine EXR→MP4 colorspace path.")
    parser.add_argument(
        "--input",
        default=r"Y:\cst\shows\108\STU108_005_0020\out\STU108_005_0020_comp_v001\render\STU108_005_0020_comp_v001.%04d.exr",
        help="printf-style EXR sequence path",
    )
    parser.add_argument("--start", type=int, default=1001)
    parser.add_argument("--end", type=int, default=1010)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="default: <track>/ctrack_publish_test_output",
    )
    parser.add_argument(
        "--no-baseline",
        action="store_true",
        help="do not also write a no-zscale baseline MP4 for comparison",
    )
    parser.add_argument("-q", "--quiet", action="store_true")
    args = parser.parse_args()

    out_dir = args.out_dir or _default_output_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    stem = "STU108_005_0020_comp_v001"
    tag = f"{args.start}-{args.end}"
    path_with_zscale = out_dir / f"{stem}_engine_rec709_linear_{tag}.mp4"
    path_baseline = out_dir / f"{stem}_engine_no_zscale_{tag}.mp4"

    log = not args.quiet
    if log:
        print(f"Output directory: {out_dir}", flush=True)
        print(f"Input pattern: {args.input}", flush=True)
        print(f"Frames: {args.start}–{args.end}", flush=True)

    code = _transcode(
        input_pattern=args.input,
        output_path=path_with_zscale,
        frame_start=args.start,
        frame_end=args.end,
        exr_colorspace="rec709_linear",
        log=log,
    )
    if code != 0:
        return code

    if not args.no_baseline:
        if log:
            print("--- Baseline (exr_colorspace=none) ---", flush=True)
        code = _transcode(
            input_pattern=args.input,
            output_path=path_baseline,
            frame_start=args.start,
            frame_end=args.end,
            exr_colorspace="none",
            log=log,
        )
        if code != 0:
            return code

    if log:
        print("Done. Open both MP4s in a player to compare colors.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
