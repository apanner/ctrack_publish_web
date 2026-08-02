"""Shared icon loading for tray and settings windows."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

from gui.paths import get_icon_ico, get_icon_png

if TYPE_CHECKING:
    from PIL import Image


def _ensure_unified_tray_icon(engine_dir: Path) -> Path:
    ico = get_icon_ico(engine_dir)
    if ico.is_file():
        return ico
    ico.parent.mkdir(parents=True, exist_ok=True)
    png = get_icon_png(engine_dir)
    try:
        from PIL import Image

        if png.is_file():
            source = Image.open(png).convert("RGBA")
        else:
            source = Image.new("RGBA", (64, 64), (36, 225, 177, 255))
        source.save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
        return ico
    except Exception:
        return ico


def load_tray_image(engine_dir: Path, size: int = 64) -> "Image.Image":
    from PIL import Image

    source = _ensure_unified_tray_icon(engine_dir)
    if source.is_file():
        img = Image.open(source).convert("RGBA")
        if img.size != (size, size):
            resample = getattr(Image, "Resampling", Image).LANCZOS
            img = img.resize((size, size), resample)
        return img
    return Image.new("RGBA", (size, size), (36, 225, 177, 255))


def apply_window_icon(window, engine_dir: Path) -> None:
    ico = _ensure_unified_tray_icon(engine_dir)
    if ico.is_file() and sys.platform == "win32":
        try:
            window.iconbitmap(default=str(ico))
            if hasattr(window, "_iconbitmap_method_called"):
                window._iconbitmap_method_called = True
            return
        except Exception:
            pass
    png = get_icon_png(engine_dir)
    if png.is_file():
        try:
            import tkinter as tk

            holder = tk.PhotoImage(file=str(png))
            window.iconphoto(True, holder)
            window._ctrack_icon_holder = holder
        except Exception:
            pass
