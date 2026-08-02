#!/usr/bin/env python3
"""
EXR sequence -> display-referred MP4 using PyOpenColorIO + OpenEXR (no Nuke license).

Requires: pip install opencolorio OpenEXR Imath numpy
Optional OCIO config via --ocio-config (defaults to test/ocio ACES cg-config if present).
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import Imath
import numpy as np
import OpenEXR


def _default_ocio_config() -> Optional[Path]:
    candidate = (
        Path(__file__).resolve().parent.parent.parent
        / "test"
        / "ocio"
        / "cg-config-v2.2.0_aces-v1.3_ocio-v2.4.ocio"
    )
    return candidate if candidate.is_file() else None


def _pattern_to_frame_path(pattern: str, frame: int) -> str:
    if "#" in pattern:
        width = len(re.findall(r"#+", pattern)[0])
        return re.sub(r"#+", lambda m: str(frame).zfill(len(m.group(0))), pattern, count=1)
    return pattern.replace("%04d", str(frame).zfill(4)).replace("%d", str(frame))


def _read_exr_rgb(path: str) -> np.ndarray:
    exr = OpenEXR.InputFile(path)
    header = exr.header()
    dw = header["dataWindow"]
    width = dw.max.x - dw.min.x + 1
    height = dw.max.y - dw.min.y + 1
    channels = header["channels"].keys()
    pt = Imath.PixelType(Imath.PixelType.HALF)
    if "R" in channels and "G" in channels and "B" in channels:
        r = np.frombuffer(exr.channel("R", pt), dtype=np.float16).reshape(height, width)
        g = np.frombuffer(exr.channel("G", pt), dtype=np.float16).reshape(height, width)
        b = np.frombuffer(exr.channel("B", pt), dtype=np.float16).reshape(height, width)
    elif "RGB" in channels:
        rgb = np.frombuffer(exr.channel("RGB", pt), dtype=np.float16).reshape(height, width, 3)
        return rgb.astype(np.float32)
    else:
        raise RuntimeError(f"No RGB channels in {path}: {list(channels)}")
    return np.stack([r, g, b], axis=-1).astype(np.float32)


def _build_processor(ocio_config: str, in_cs: str, out_cs: str):
    import PyOpenColorIO as OCIO

    os.environ["OCIO"] = ocio_config
    config = OCIO.Config.CreateFromFile(ocio_config)
    names = set(config.getColorSpaceNames())

    def pick(preferred: str, fallbacks: List[str]) -> str:
        for candidate in [preferred] + fallbacks:
            if candidate in names:
                return candidate
        raise RuntimeError(f"Colorspace not in config: {preferred} (have {len(names)} spaces)")

    in_name = pick(in_cs, ["ACEScg", "ACES - ACEScg", "scene_linear"])
    out_name = pick(out_cs, ["sRGB - Display", "Output - sRGB", "sRGB", "Gamma 2.2 Encoded Rec.709 (sRGB)"])
    processor = config.getProcessor(in_name, out_name)
    cpu = processor.getDefaultCPUProcessor()
    return cpu, in_name, out_name


def _apply_processor(cpu, rgb: np.ndarray) -> np.ndarray:
    flat = np.ascontiguousarray(rgb, dtype=np.float32).reshape(-1, 3)
    cpu.applyRGB(flat)
    out = flat.reshape(rgb.shape)
    return np.clip(out, 0.0, 1.0)


def _write_png_srgb(path: Path, rgb01: np.ndarray) -> None:
    try:
        import imageio.v3 as iio
    except ImportError:
        from PIL import Image

        u8 = (rgb01 * 255.0 + 0.5).astype(np.uint8)
        Image.fromarray(u8, mode="RGB").save(path)
        return
    u8 = (rgb01 * 255.0 + 0.5).astype(np.uint8)
    iio.imwrite(path, u8)


def _resolve_ffmpeg() -> str:
    engine_py = Path(__file__).resolve().parent.parent / "python"
    if str(engine_py) not in sys.path:
        sys.path.insert(0, str(engine_py))
    from modules.utils import get_ffmpeg_path  # noqa: E402

    return get_ffmpeg_path()


def transcode_exr_ocio_to_mp4(
    *,
    pattern: str,
    frame_start: int,
    frame_end: int,
    output_mp4: Path,
    ocio_config: str,
    in_cs: str,
    out_cs: str,
    fps: float,
    work_dir: Optional[Path],
    log: Optional[Callable[[str], None]] = None,
) -> Tuple[int, float]:
    ffmpeg = _resolve_ffmpeg()

    def _log(msg: str) -> None:
        if log:
            log(msg)

    cpu, in_name, out_name = _build_processor(ocio_config, in_cs, out_cs)
    _log(f"[pyocio] {Path(ocio_config).name}: {in_name} -> {out_name}")

    work = work_dir or (output_mp4.parent / "_pyocio_work")
    seq_dir = work / "srgb_png"
    if seq_dir.exists():
        shutil.rmtree(seq_dir)
    seq_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    for frame in range(frame_start, frame_end + 1):
        src = _pattern_to_frame_path(pattern, frame)
        if not os.path.isfile(src):
            raise FileNotFoundError(src)
        rgb = _read_exr_rgb(src)
        display = _apply_processor(cpu, rgb)
        _write_png_srgb(seq_dir / f"frame.{frame:04d}.png", display)
        if (frame - frame_start) % 5 == 0:
            _log(f"[pyocio] frame {frame}")

    ff_cmd = [
        ffmpeg,
        "-y",
        "-framerate",
        str(fps),
        "-start_number",
        str(frame_start),
        "-i",
        str(seq_dir / "frame.%04d.png"),
        "-c:v",
        "libx265",
        "-crf",
        "24",
        "-preset",
        "slow",
        "-pix_fmt",
        "yuv420p",
        "-tag:v",
        "hvc1",
        "-color_primaries",
        "bt709",
        "-colorspace",
        "bt709",
        "-color_trc",
        "iec61966-2-1",
        str(output_mp4),
    ]
    _log("[pyocio] ffmpeg: " + " ".join(ff_cmd))
    proc = subprocess.run(ff_cmd, capture_output=True, text=True)
    elapsed = time.perf_counter() - t0
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "ffmpeg failed")[-4000:])
    return 0, elapsed


def main() -> int:
    parser = argparse.ArgumentParser(description="PyOpenColorIO EXR->MP4 transcode.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ocio-config", default=None)
    parser.add_argument("--in-colorspace", default="ACEScg")
    parser.add_argument("--out-colorspace", default="sRGB - Display")
    parser.add_argument("--fps", type=float, default=24.0)
    args = parser.parse_args()

    ocio = args.ocio_config or str(_default_ocio_config() or "")
    if not ocio or not os.path.isfile(ocio):
        print("OCIO config required (--ocio-config)", file=sys.stderr)
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    code, elapsed = transcode_exr_ocio_to_mp4(
        pattern=args.input,
        frame_start=args.start,
        frame_end=args.end,
        output_mp4=args.output,
        ocio_config=ocio,
        in_cs=args.in_colorspace,
        out_cs=args.out_colorspace,
        fps=args.fps,
        work_dir=args.output.parent / "_pyocio_work",
        log=print,
    )
    print(f"[ok] {args.output} ({elapsed:.1f}s)")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
