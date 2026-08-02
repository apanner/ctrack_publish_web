"""Tray slide helpers — vertical slide only, no fade/scale."""

from __future__ import annotations

import os
import subprocess
import sys
import webbrowser
from pathlib import Path
from typing import Callable, Optional, Tuple

try:
    import ctypes
    from ctypes import wintypes
except ImportError:
    ctypes = None
    wintypes = None

CARD_W = 380
CARD_H = 240
CARD_MARGIN_X = 20
CARD_MARGIN_Y = 48
SLIDE_STEPS = 12
SLIDE_STEP_MS = 14


def get_work_area() -> Tuple[int, int, int, int]:
    if ctypes is None or sys.platform != "win32":
        return 0, 0, 1920, 1000
    rect = wintypes.RECT()
    ctypes.windll.user32.SystemParametersInfoW(48, 0, ctypes.byref(rect), 0)
    return rect.left, rect.top, rect.right, rect.bottom


def measure_window(window: object, width: int = CARD_W, height: int = CARD_H) -> Tuple[int, int]:
    try:
        window.update_idletasks()
        req_w = int(window.winfo_reqwidth())
        req_h = int(window.winfo_reqheight())
        return max(width, req_w + 8), max(height, req_h + 8)
    except Exception:
        return width, height


def card_xy(width: int, height: int) -> Tuple[int, int]:
    left, top, right, bottom = get_work_area()
    x = max(left + CARD_MARGIN_X, right - width - CARD_MARGIN_X)
    y = max(top + CARD_MARGIN_Y, bottom - height - CARD_MARGIN_Y)
    return x, y


def place_card(window: object, width: int = CARD_W, height: int = CARD_H) -> Tuple[int, int, int, int]:
    w, h = measure_window(window, width, height)
    x, y = card_xy(w, h)
    window.geometry(f"{w}x{h}+{x}+{y}")
    return w, h, x, y


def slide_up(
    window: object,
    *,
    width: int = CARD_W,
    height: int = CARD_H,
    on_done: Optional[Callable[[], None]] = None,
) -> None:
    window.update_idletasks()
    end_w, end_h = measure_window(window, width, height)
    end_x, end_y = card_xy(end_w, end_h)
    _, _, _, bottom = get_work_area()
    start_y = bottom + 8

    def step(i: int = 0) -> None:
        if i > SLIDE_STEPS:
            place_card(window, end_w, end_h)
            if on_done:
                on_done()
            return
        t = i / SLIDE_STEPS
        y = int(start_y + (end_y - start_y) * t)
        window.geometry(f"{end_w}x{end_h}+{end_x}+{y}")
        window.after(SLIDE_STEP_MS, lambda: step(i + 1))

    window.geometry(f"{end_w}x{end_h}+{end_x}+{start_y}")
    window.deiconify()
    step(0)


def slide_down(
    window: object,
    *,
    width: int = CARD_W,
    height: int = CARD_H,
    on_done: Optional[Callable[[], None]] = None,
) -> None:
    try:
        window.update_idletasks()
        parts = window.geometry().split("+")
        size = parts[0].split("x")
        start_w = int(size[0])
        start_h = int(size[1])
        start_x = int(parts[1]) if len(parts) > 1 else card_xy(width, height)[0]
        start_y = int(parts[2]) if len(parts) > 2 else card_xy(width, height)[1]
    except Exception:
        start_w, start_h = measure_window(window, width, height)
        start_x, start_y = card_xy(start_w, start_h)
    _, _, _, bottom = get_work_area()
    end_y = bottom + start_h + 16

    def step(i: int = 0) -> None:
        if i > SLIDE_STEPS:
            if on_done:
                on_done()
            return
        t = i / SLIDE_STEPS
        y = int(start_y + (end_y - start_y) * t)
        window.geometry(f"{start_w}x{start_h}+{start_x}+{y}")
        window.after(SLIDE_STEP_MS, lambda: step(i + 1))

    step(0)


def open_browser_url(url: str) -> bool:
    if not url:
        return False
    if sys.platform == "win32":
        try:
            os.startfile(url)
            return True
        except OSError:
            pass
    try:
        return bool(webbrowser.open(url, new=2))
    except Exception:
        return False


def launch_settings(
    install_root: Path,
    *,
    page: str = "Account",
    from_tray: bool = False,
    pythonw_exe: Optional[str] = None,
) -> None:
    engine_dir = install_root / "engine"
    if not (engine_dir / "python" / "engine.py").is_file():
        engine_dir = install_root
    python_dir = install_root / "runtime" / "python"
    if python_dir.is_dir() and (python_dir / "pythonw.exe").is_file():
        exe = str(python_dir / "pythonw.exe")
    elif pythonw_exe:
        exe = pythonw_exe
    else:
        exe = sys.executable
    args = [exe, "-m", "gui.settings_window", "--install-root", str(install_root), "--page", page]
    if from_tray:
        args.append("--from-tray")
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    subprocess.Popen(args, cwd=str(engine_dir / "python"), creationflags=flags)


def signal_tray_refresh() -> None:
    path = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".ctrack-engine" / "tray-refresh.touch"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("paired\n", encoding="utf-8")
