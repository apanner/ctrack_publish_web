#!/usr/bin/env python3
"""
Patch sample.nk-style script with paths/frame range, then run Nuke -x in the shell.

Usage:
  python engine/scripts/nuke_render_from_nk.py
  python engine/scripts/nuke_render_from_nk.py --template d:/dev/track/sample.nk --start 1001 --end 1005
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional, Tuple


def _nuke_path(p: str) -> str:
    return p.replace("\\", "/")


def _find_nuke_exe(explicit: Optional[str]) -> Optional[Path]:
    if explicit:
        p = Path(explicit)
        return p if p.is_file() else None
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


def _default_template() -> Path:
    candidates = [
        Path(__file__).resolve().parent.parent.parent.parent / "sample.nk",
        Path(__file__).resolve().parent / "templates" / "review_mp4.nk",
    ]
    for path in candidates:
        if path.is_file():
            return path
    raise FileNotFoundError("sample.nk not found (expected at repo root)")


def patch_nk_script(
    template_text: str,
    *,
    read_pattern: str,
    frame_start: int,
    frame_end: int,
    output_mp4: str,
) -> str:
    """Update Read / Write paths and frame range in a sample.nk-style script."""
    read_pattern = _nuke_path(read_pattern)
    output_mp4 = _nuke_path(output_mp4)

    text = template_text

    text = re.sub(
        r'(#write_info Write_MP4 file:)"[^"]*"',
        r'\1"{}"'.format(output_mp4),
        text,
        count=1,
    )

    text = re.sub(
        r"(Read \{[^}]*?file )[^\n]+",
        r"\g<1>" + read_pattern,
        text,
        count=1,
        flags=re.DOTALL,
    )

    for key, frame in (
        ("first", frame_start),
        ("last", frame_end),
        ("origfirst", frame_start),
        ("origlast", frame_end),
    ):
        text = re.sub(rf"({key} )\d+", rf"\g<1>{frame}", text, count=1)

    text = re.sub(
        r"(Write \{[^}]*?file )[^\n]+",
        r"\g<1>" + output_mp4,
        text,
        count=1,
        flags=re.DOTALL,
    )

    return text


def run_nuke_execute(
    *,
    nuke_exe: Path,
    nk_path: Path,
    frame_start: int,
    frame_end: int,
    interactive_license: bool,
    safe_mode: bool,
    quiet: bool,
) -> Tuple[int, float, str]:
    cmd = [str(nuke_exe)]
    if safe_mode:
        cmd.append("--safe")
    if interactive_license:
        cmd.append("-i")
    cmd.extend(
        [
            "-x",
            "-F",
            f"{frame_start}-{frame_end}",
            str(nk_path),
        ]
    )
    if not quiet:
        print("[run]", " ".join(cmd), flush=True)

    t0 = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=not quiet, text=True)
    elapsed = time.perf_counter() - t0
    log = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, elapsed, log


def main() -> int:
    parser = argparse.ArgumentParser(description="Render review MP4 via patched sample.nk + Nuke -x")
    parser.add_argument(
        "--template",
        type=Path,
        default=None,
        help="Path to sample.nk (default: repo root sample.nk)",
    )
    parser.add_argument(
        "--input",
        default=(
            r"Y:\cst\shows\108\STU108_005_0020\out\STU108_005_0020_comp_v002\render"
            r"\STU108_005_0020_comp_v002.%04d.exr"
        ),
    )
    parser.add_argument("--start", type=int, default=1001)
    parser.add_argument("--end", type=int, default=1005)
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="MP4 output (default: ctrack_publish_web/test/folder/...)",
    )
    parser.add_argument("--nk-out", type=Path, default=None, help="Save patched .nk here")
    parser.add_argument("--nuke-exe", default=None)
    parser.add_argument("--nuke-interactive", action="store_true", default=True)
    parser.add_argument("--no-nuke-interactive", action="store_false", dest="nuke_interactive")
    parser.add_argument(
        "--safe",
        action="store_true",
        default=True,
        help="Nuke --safe: skip ~/.nuke plugins (XMem2, iMatte, etc.)",
    )
    parser.add_argument(
        "--no-safe",
        action="store_false",
        dest="safe",
        help="load your normal Nuke user plugins",
    )
    parser.add_argument("-q", "--quiet", action="store_true")
    args = parser.parse_args()

    template_path = args.template or _default_template()
    web_root = Path(__file__).resolve().parent.parent.parent
    out_dir = web_root / "test" / "folder"
    out_dir.mkdir(parents=True, exist_ok=True)

    stem = "STU108_005_0020_comp_v002"
    output_mp4 = args.output or (out_dir / f"{stem}_nuke_review_{args.start}-{args.end}.mp4")
    output_mp4.parent.mkdir(parents=True, exist_ok=True)

    template_text = template_path.read_text(encoding="utf-8")
    patched = patch_nk_script(
        template_text,
        read_pattern=args.input,
        frame_start=args.start,
        frame_end=args.end,
        output_mp4=str(output_mp4),
    )

    if args.nk_out:
        nk_path = args.nk_out
        nk_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        fd, tmp = tempfile.mkstemp(suffix=".nk", prefix="ctrack_review_")
        os.close(fd)
        nk_path = Path(tmp)

    nk_path.write_text(patched.replace("\r\n", "\n"), encoding="utf-8")
    if not args.quiet:
        print(f"[patch] template: {template_path}", flush=True)
        print(f"[patch] nk script: {nk_path}", flush=True)
        print(f"[patch] read: {_nuke_path(args.input)}", flush=True)
        print(f"[patch] write: {_nuke_path(str(output_mp4))}", flush=True)
        print(f"[patch] frames: {args.start}-{args.end}", flush=True)

    nuke_exe = _find_nuke_exe(args.nuke_exe)
    if not nuke_exe:
        print("Nuke executable not found", file=sys.stderr)
        return 2

    code, elapsed, log = run_nuke_execute(
        nuke_exe=nuke_exe,
        nk_path=nk_path,
        frame_start=args.start,
        frame_end=args.end,
        interactive_license=args.nuke_interactive,
        safe_mode=args.safe,
        quiet=args.quiet,
    )

    if not args.quiet and log:
        tail = log[-6000:] if len(log) > 6000 else log
        print(tail)

    if code != 0:
        print(f"[fail] Nuke exit {code} ({elapsed:.1f}s)", file=sys.stderr)
        return code

    if not output_mp4.is_file():
        print(f"[fail] Output missing: {output_mp4}", file=sys.stderr)
        return 4

    print(f"[ok] {output_mp4} ({elapsed:.1f}s, {output_mp4.stat().st_size} bytes)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
