#!/usr/bin/env python3
"""
Compare EXR -> MP4 via Nuke terminal (OCIO display) vs engine FFmpeg path.

Usage:
  python engine/scripts/test_exr_nuke_ocio_mp4.py
  python engine/scripts/test_exr_nuke_ocio_mp4.py --start 1001 --end 1010
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import List, Optional, Tuple


def _scripts_dir() -> Path:
    return Path(__file__).resolve().parent


def _web_root() -> Path:
    return _scripts_dir().parent.parent


def _default_test_out() -> Path:
    return _web_root() / "test" / "folder"


def _find_nuke_exe(explicit: Optional[str]) -> Optional[Path]:
    if explicit:
        p = Path(explicit)
        return p if p.is_file() else None
    env = os.environ.get("NUKE_EXE") or os.environ.get("NUKE_PATH")
    if env:
        p = Path(env)
        if p.is_file():
            return p
        candidate = p / "Nuke15.1.exe"
        if candidate.is_file():
            return candidate
    for pattern in (
        r"C:\Program Files\Nuke15*\Nuke15*.exe",
        r"C:\Program Files\Nuke14*\Nuke14*.exe",
        r"C:\Program Files\Nuke13*\Nuke13*.exe",
    ):
        matches = sorted(glob.glob(pattern), reverse=True)
        for match in matches:
            name = Path(match).name.lower()
            if "nuke" in name and "crash" not in name:
                return Path(match)
    return None


def _find_oiiotool(explicit: Optional[str]) -> Optional[Path]:
    if explicit:
        p = Path(explicit)
        return p if p.is_file() else None
    which = shutil.which("oiiotool")
    if which:
        return Path(which)
    for pattern in (
        r"C:\Program Files\OpenImageIO*\bin\oiiotool.exe",
        r"C:\tools\oiiotool.exe",
    ):
        matches = glob.glob(pattern)
        if matches:
            return Path(matches[0])
    return None


def _default_nk_template() -> Path:
    root = _scripts_dir().parent.parent.parent
    path = root / "sample.nk"
    if path.is_file():
        return path
    return _scripts_dir() / "templates" / "review_mp4.nk"


def _run_nuke_render(
    *,
    nuke_exe: Path,
    template_nk: Path,
    pattern: str,
    frame_start: int,
    frame_end: int,
    output_mp4: Path,
    ocio_config: Optional[str],
    in_cs: str,
    out_cs: str,
    fps: float,
    interactive_license: bool,
    safe_mode: bool,
    quiet: bool,
) -> Tuple[int, float, str]:
    del ocio_config, in_cs, out_cs, fps  # colorspace handled in sample.nk

    sys.path.insert(0, str(_scripts_dir()))
    from nuke_render_from_nk import patch_nk_script, run_nuke_execute  # noqa: E402

    patched = patch_nk_script(
        template_nk.read_text(encoding="utf-8"),
        read_pattern=pattern,
        frame_start=frame_start,
        frame_end=frame_end,
        output_mp4=str(output_mp4),
    )
    nk_path = output_mp4.parent / f"_patched_{output_mp4.stem}.nk"
    nk_path.write_text(patched.replace("\r\n", "\n"), encoding="utf-8")

    if not quiet:
        print("[run] Nuke -x (sample.nk)", flush=True)
        print("[run] patched:", nk_path, flush=True)
        print("[run] out:", output_mp4, flush=True)

    return run_nuke_execute(
        nuke_exe=nuke_exe,
        nk_path=nk_path,
        frame_start=frame_start,
        frame_end=frame_end,
        interactive_license=interactive_license,
        safe_mode=safe_mode,
        quiet=quiet,
    )


def _run_oiiotool_pipeline(
    *,
    oiiotool: Path,
    pattern: str,
    frame_start: int,
    frame_end: int,
    output_mp4: Path,
    work_dir: Path,
    ocio_config: Optional[str],
    in_cs: str,
    out_cs: str,
    fps: float,
    quiet: bool,
) -> Tuple[int, float, str]:
    """EXR -> display-referred PNG sequence via OCIO, then ffmpeg -> MP4."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return 1, 0.0, "ffmpeg not on PATH (needed after oiiotool colorconvert)"

    work_dir.mkdir(parents=True, exist_ok=True)
    seq_dir = work_dir / "oiio_srgb"
    seq_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    if ocio_config:
        env["OCIO"] = ocio_config

    # oiiotool accepts printf paths; colorconvert uses OCIO when OCIO is set.
    out_pattern = str(seq_dir / "frame.%04d.png")
    cmd = [
        str(oiiotool),
        pattern,
        "--frames",
        f"{frame_start}-{frame_end}",
        "--colorconvert",
        in_cs,
        out_cs,
        "-o",
        out_pattern,
    ]
    if not quiet:
        print("[run] OIIO:", " ".join(cmd), flush=True)

    t0 = time.perf_counter()
    p1 = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if p1.returncode != 0:
        return p1.returncode, time.perf_counter() - t0, (p1.stdout or "") + (p1.stderr or "")

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
        "-pix_fmt",
        "yuv420p",
        "-tag:v",
        "hvc1",
        str(output_mp4),
    ]
    if not quiet:
        print("[run] ffmpeg:", " ".join(ff_cmd), flush=True)
    p2 = subprocess.run(ff_cmd, capture_output=True, text=True)
    elapsed = time.perf_counter() - t0
    log = (p1.stdout or "") + (p1.stderr or "") + (p2.stdout or "") + (p2.stderr or "")
    return p2.returncode, elapsed, log


def _run_engine_ffmpeg(
    *,
    pattern: str,
    frame_start: int,
    frame_end: int,
    output_mp4: Path,
    exr_colorspace: str,
    quiet: bool,
) -> Tuple[int, float, str]:
    engine_py = _scripts_dir().parent / "python"
    sys.path.insert(0, str(engine_py))
    os.chdir(engine_py)
    from modules.transcode import transcode_sequence  # noqa: E402

    logs: List[str] = []

    def log_cb(msg: str) -> None:
        if not quiet:
            print(msg, flush=True)
        logs.append(msg)

    opts = {
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
        "exr_colorspace": exr_colorspace,
    }
    t0 = time.perf_counter()
    result = transcode_sequence(str(pattern), str(output_mp4), opts, log_callback=log_cb)
    elapsed = time.perf_counter() - t0
    if result.get("status") != "success":
        return 1, elapsed, result.get("message", str(result))
    return 0, elapsed, "\n".join(logs)


def main() -> int:
    parser = argparse.ArgumentParser(description="Nuke/OIIO/FFmpeg EXR→MP4 comparison test.")
    parser.add_argument(
        "--input",
        default=(
            r"Y:\cst\shows\108\STU108_005_0020\out\STU108_005_0020_comp_v002\render"
            r"\STU108_005_0020_comp_v002.%04d.exr"
        ),
    )
    parser.add_argument("--start", type=int, default=1001)
    parser.add_argument("--end", type=int, default=1010)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--nuke-exe", default=None)
    parser.add_argument("--oiiotool", default=None)
    parser.add_argument("--ocio-config", default=os.environ.get("OCIO"))
    parser.add_argument("--in-colorspace", default="ACES - ACEScg")
    parser.add_argument("--out-colorspace", default="Output - sRGB")
    parser.add_argument(
        "--ocio-default",
        action="store_true",
        help="use bundled test/ocio ACES cg-config when --ocio-config unset",
    )
    parser.add_argument("--fps", type=float, default=24.0)
    parser.add_argument(
        "--nuke-interactive",
        action="store_true",
        help="pass -i to Nuke (-t defaults to render-only license)",
    )
    parser.add_argument(
        "--nuke-safe",
        action="store_true",
        default=True,
        help="pass --safe (skip ~/.nuke custom plugins)",
    )
    parser.add_argument("--no-nuke-safe", action="store_false", dest="nuke_safe")
    parser.add_argument("--skip-nuke", action="store_true")
    parser.add_argument("--skip-oiio", action="store_true")
    parser.add_argument("--skip-ffmpeg", action="store_true")
    parser.add_argument("-q", "--quiet", action="store_true")
    args = parser.parse_args()

    ocio_config = args.ocio_config
    if not ocio_config and args.ocio_default:
        default_ocio = _scripts_dir().parent.parent / "test" / "ocio" / "cg-config-v2.2.0_aces-v1.3_ocio-v2.4.ocio"
        if default_ocio.is_file():
            ocio_config = str(default_ocio)

    out_dir = args.out_dir or _default_test_out()
    out_dir.mkdir(parents=True, exist_ok=True)
    tag = f"{args.start}-{args.end}"
    stem = Path(args.input.replace("%04d", "0000").replace("####", "0000")).stem.split(".")[0]

    template_nk = _default_nk_template()
    timings: List[Tuple[str, float, int]] = []

    if not args.skip_nuke:
        nuke_exe = _find_nuke_exe(args.nuke_exe)
        if not nuke_exe:
            print("[skip] Nuke executable not found", file=sys.stderr)
        elif not template_nk.is_file():
            print(f"[skip] Nuke template not found: {template_nk}", file=sys.stderr)
        else:
            out_mp4 = out_dir / f"{stem}_nuke_review_{tag}.mp4"
            code, elapsed, log = _run_nuke_render(
                nuke_exe=nuke_exe,
                template_nk=template_nk,
                pattern=args.input,
                frame_start=args.start,
                frame_end=args.end,
                output_mp4=out_mp4,
                ocio_config=ocio_config,
                in_cs=args.in_colorspace,
                out_cs=args.out_colorspace,
                fps=args.fps,
                interactive_license=args.nuke_interactive,
                safe_mode=args.nuke_safe,
                quiet=args.quiet,
            )
            timings.append(("nuke_ocio", elapsed, code))
            if not args.quiet and log:
                print(log[-8000:] if len(log) > 8000 else log)
            if code == 0:
                print(f"[ok] Nuke -> {out_mp4} ({elapsed:.1f}s)", flush=True)
            else:
                print(f"[fail] Nuke exit {code} ({elapsed:.1f}s)", file=sys.stderr)

    if not args.skip_oiio:
        oiiotool = _find_oiiotool(args.oiiotool)
        if not oiiotool:
            if ocio_config:
                out_mp4 = out_dir / f"{stem}_pyocio_srgb_{tag}.mp4"
                try:
                    from python_ocio_exr_to_mp4 import transcode_exr_ocio_to_mp4  # noqa: E402
                except ImportError:
                    sys.path.insert(0, str(_scripts_dir()))
                    from python_ocio_exr_to_mp4 import transcode_exr_ocio_to_mp4  # noqa: E402

                if not args.quiet:
                    print("[run] PyOpenColorIO (OIIO fallback)", flush=True)
                t0 = time.perf_counter()
                try:
                    code, elapsed = transcode_exr_ocio_to_mp4(
                        pattern=args.input,
                        frame_start=args.start,
                        frame_end=args.end,
                        output_mp4=out_mp4,
                        ocio_config=ocio_config,
                        in_cs=args.in_colorspace,
                        out_cs=args.out_colorspace,
                        fps=args.fps,
                        work_dir=out_dir / "_pyocio_work",
                        log=None if args.quiet else print,
                    )
                except Exception as exc:
                    code, elapsed = 1, time.perf_counter() - t0
                    print(f"[fail] PyOCIO: {exc}", file=sys.stderr)
                else:
                    timings.append(("pyocio", elapsed, code))
                    if code == 0:
                        print(f"[ok] PyOCIO -> {out_mp4} ({elapsed:.1f}s)", flush=True)
            else:
                print("[skip] oiiotool not found; pass --ocio-default for PyOpenColorIO path", file=sys.stderr)
        else:
            out_mp4 = out_dir / f"{stem}_oiio_ocio_srgb_{tag}.mp4"
            work = out_dir / "_oiio_work"
            code, elapsed, log = _run_oiiotool_pipeline(
                oiiotool=oiiotool,
                pattern=args.input,
                frame_start=args.start,
                frame_end=args.end,
                output_mp4=out_mp4,
                work_dir=work,
                ocio_config=ocio_config,
                in_cs=args.in_colorspace,
                out_cs=args.out_colorspace,
                fps=args.fps,
                quiet=args.quiet,
            )
            timings.append(("oiio_ocio", elapsed, code))
            if not args.quiet and log:
                print(log[-4000:] if len(log) > 4000 else log)
            if code == 0:
                print(f"[ok] OIIO -> {out_mp4} ({elapsed:.1f}s)", flush=True)
            else:
                print(f"[fail] OIIO exit {code} ({elapsed:.1f}s)", file=sys.stderr)

    if not args.skip_ffmpeg:
        out_mp4 = out_dir / f"{stem}_ffmpeg_zscale_{tag}.mp4"
        code, elapsed, log = _run_engine_ffmpeg(
            pattern=args.input,
            frame_start=args.start,
            frame_end=args.end,
            output_mp4=out_mp4,
            exr_colorspace="rec709_linear",
            quiet=args.quiet,
        )
        timings.append(("ffmpeg_zscale", elapsed, code))
        if code == 0:
            print(f"[ok] FFmpeg engine -> {out_mp4} ({elapsed:.1f}s)", flush=True)
        else:
            print(f"[fail] FFmpeg engine exit {code} ({elapsed:.1f}s)", file=sys.stderr)
            if log:
                print(log, file=sys.stderr)

    if timings:
        print("\n--- timing ---", flush=True)
        for name, sec, code in timings:
            status = "ok" if code == 0 else f"exit {code}"
            print(f"  {name}: {sec:.1f}s ({status})", flush=True)
    print(f"\nOutput folder: {out_dir}", flush=True)
    return 0 if any(c == 0 for _, _, c in timings) else 1


if __name__ == "__main__":
    raise SystemExit(main())
