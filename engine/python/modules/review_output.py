"""Review MP4 output dimensions from engine settings."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

PRESETS: Dict[str, Tuple[int, int]] = {
    "1080p": (1920, 1080),
    "720p": (1280, 720),
    "4k": (3840, 2160),
}


def normalize_review_preset(value: Optional[str]) -> str:
    key = str(value or "1080p").strip().lower()
    if key in PRESETS:
        return key
    if key == "4k" or key == "2160p":
        return "4k"
    if key == "custom":
        return "custom"
    return "1080p"


def get_review_mp4_dimensions(settings: Optional[Dict[str, Any]] = None) -> Tuple[int, int, str]:
    from modules.engine_settings import load_settings

    settings = settings or load_settings()
    preset = normalize_review_preset(settings.get("reviewMp4Preset"))
    if preset == "custom":
        width = int(settings.get("reviewMp4Width") or 1920)
        height = int(settings.get("reviewMp4Height") or 1080)
        width = max(320, min(width, 7680))
        height = max(240, min(height, 4320))
        return width, height, preset
    width, height = PRESETS[preset]
    return width, height, preset
