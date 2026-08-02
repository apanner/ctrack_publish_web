#!/usr/bin/env python3
"""Test bundled oiiotool EXR → MP4 (OCIO ACES / sRGB + 1080 fit)."""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path


def _engine_python() -> Path:
    return Path(__file__).resolve().parent.parent / "python"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        default=(
            r"Y:\cst\shows\108\STU108_005_0020\out\STU108_005_0020_comp_v002\render"
            r"\STU108_005_0020_comp_v002.%04d.exr"
        ),
    )
    parser.add_argument("--start", type=int, default=1001)
    parser.add_argument("--end", type=int, default=1005)
    parser.add_argument("--out-dir", type=Path, default=None)
    args = parser.parse_args()

    py = _engine_python()
    sys.path.insert(0, str(py))
    os.chdir(py)

    from modules.oiio_transcode import transcode_exr_oiio_to_mp4  # noqa: E402
    from modules.utils import get_oiiotool_path, get_ocio_config_path  # noqa: E402

    oiiotool = get_oiiotool_path()
    ocio = get_ocio_config_path()
    print(f"oiiotool: {oiiotool}")
    print(f"OCIO: {ocio}")
    if not os.path.isfile(oiiotool):
        print("Run: python engine/python/scripts/setup_oiio.py", file=sys.stderr)
        return 2
    if not ocio:
        print("OCIO missing. Run setup_oiio.py (copies aces_1.2 from Nuke if installed).", file=sys.stderr)
        return 2

    web = Path(__file__).resolve().parent.parent.parent
    out_dir = args.out_dir or (web / "test" / "folder")
    out_dir.mkdir(parents=True, exist_ok=True)
    tag = f"{args.start}-{args.end}"
    out_mp4 = out_dir / f"STU108_005_0020_comp_v002_oiio_aces_srgb_{tag}.mp4"

    t0 = time.perf_counter()
    result = transcode_exr_oiio_to_mp4(
        args.input,
        str(out_mp4),
        {
            "frame_start": args.start,
            "frame_end": args.end,
            "fps": 24,
        },
        log_callback=print,
    )
    elapsed = time.perf_counter() - t0

    if result.get("status") != "success":
        print(result.get("message", result), file=sys.stderr)
        return 1
    print(f"[ok] {out_mp4} ({elapsed:.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
