"""Nuke -x render via patched sample.nk (shared by scripts and transcode router)."""

from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path
from typing import Tuple, Union

PathLike = Union[str, Path]


def patch_nk_script(
    template_text: str,
    *,
    read_pattern: str,
    frame_start: int,
    frame_end: int,
    output_mp4: str,
    width: int = 1920,
    height: int = 1080,
) -> str:
    read_pattern = read_pattern.replace("\\", "/")
    output_mp4 = output_mp4.replace("\\", "/")
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
    text = re.sub(
        r'format:"(\d+) (\d+) 1"',
        rf'format:"{width} {height} 1"',
        text,
        count=1,
    )
    text = re.sub(
        r'(Reformat \{[^}]*?format ")\d+ \d+ 0 0 \d+ \d+ 1[^"]*(")',
        rf"\g<1>{width} {height} 0 0 {width} {height} 1 HD_review\2",
        text,
        count=1,
        flags=re.DOTALL,
    )
    text = re.sub(
        r"(box \{0 0 )\d+ \d+(\})",
        rf"\g<1>{width} {height}\2",
        text,
        count=1,
    )
    return text


def run_nuke_execute(
    *,
    nuke_exe: PathLike,
    nk_path: PathLike,
    frame_start: int,
    frame_end: int,
    interactive_license: bool = True,
    safe_mode: bool = True,
    quiet: bool = True,
) -> Tuple[int, float, str]:
    cmd = [str(nuke_exe)]
    if safe_mode:
        cmd.append("--safe")
    if interactive_license:
        cmd.append("-i")
    cmd.extend(["-x", "-F", f"{frame_start}-{frame_end}", str(nk_path)])
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=quiet, text=True)
    elapsed = time.perf_counter() - t0
    log = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, elapsed, log
