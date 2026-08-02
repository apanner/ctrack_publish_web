"""
Persistent engine tool settings (~/.ctrack-engine/engine-settings.json).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

SETTINGS_VERSION = 1
DEFAULT_EXR_ORDER = ["nuke", "oiio", "ffmpeg"]


def _settings_path() -> str:
    base = os.path.join(os.path.expanduser("~"), ".ctrack-engine")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "engine-settings.json")


def _templates_root() -> str:
    root = os.path.join(os.path.expanduser("~"), ".ctrack-engine", "templates")
    os.makedirs(root, exist_ok=True)
    return root


def _template_registry_path() -> str:
    return os.path.join(_templates_root(), "registry.json")


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def default_settings() -> Dict[str, Any]:
    return {
        "version": SETTINGS_VERSION,
        "nukeInstallations": [],
        "preferredNukeExe": None,
        "exrTranscodeOrder": list(DEFAULT_EXR_ORDER),
        "sampleNkTemplate": None,
        "lastToolScanAt": None,
        "nukeInteractive": True,
        "nukeSafeMode": True,
        "transcodeMode": "auto",
        "reviewMp4Preset": "1080p",
        "reviewMp4Width": 1920,
        "reviewMp4Height": 1080,
        "reviewTemplateId": "review_mp4",
    }


def load_settings() -> Dict[str, Any]:
    path = _settings_path()
    if not os.path.isfile(path):
        return default_settings()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return default_settings()
        base = default_settings()
        base.update(data)
        if not isinstance(base.get("nukeInstallations"), list):
            base["nukeInstallations"] = []
        order = base.get("exrTranscodeOrder")
        if not isinstance(order, list) or not order:
            base["exrTranscodeOrder"] = list(DEFAULT_EXR_ORDER)
        return base
    except (OSError, json.JSONDecodeError):
        return default_settings()


def save_settings(settings: Dict[str, Any]) -> None:
    settings = dict(settings)
    settings["version"] = SETTINGS_VERSION
    path = _settings_path()
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(settings, handle, indent=2)
        handle.write("\n")


def get_preferred_nuke_exe(settings: Optional[Dict[str, Any]] = None) -> Optional[str]:
    settings = settings or load_settings()
    preferred = settings.get("preferredNukeExe")
    if preferred and os.path.isfile(preferred):
        return preferred
    for item in settings.get("nukeInstallations") or []:
        exe = item.get("exePath") if isinstance(item, dict) else None
        if exe and os.path.isfile(exe):
            return exe
    return None


def get_review_template_path(settings: Optional[Dict[str, Any]] = None) -> Optional[str]:
    settings = settings or load_settings()
    template_id = str(settings.get("reviewTemplateId") or "").strip()
    if not template_id:
        return settings.get("sampleNkTemplate")
    registry_path = _template_registry_path()
    if not os.path.isfile(registry_path):
        return settings.get("sampleNkTemplate")
    try:
        with open(registry_path, "r", encoding="utf-8") as handle:
            registry = json.load(handle)
        templates = registry.get("templates") if isinstance(registry, dict) else []
        if not isinstance(templates, list):
            return settings.get("sampleNkTemplate")
        for item in templates:
            if not isinstance(item, dict):
                continue
            if str(item.get("id") or "").strip() != template_id:
                continue
            absolute_path = item.get("path")
            if isinstance(absolute_path, str) and os.path.isfile(absolute_path):
                return absolute_path
            relative_path = item.get("relativePath")
            if isinstance(relative_path, str) and relative_path.strip():
                resolved = os.path.join(_templates_root(), relative_path.replace("/", os.sep))
                if os.path.isfile(resolved):
                    return resolved
    except (OSError, json.JSONDecodeError):
        return settings.get("sampleNkTemplate")
    return settings.get("sampleNkTemplate")


def set_nuke_installations(installations: List[Dict[str, Any]]) -> Dict[str, Any]:
    from modules.nuke_detect import resolve_sample_nk_template

    settings = load_settings()
    settings["nukeInstallations"] = installations
    settings["lastToolScanAt"] = _utc_now()
    if installations and not settings.get("preferredNukeExe"):
        settings["preferredNukeExe"] = installations[0].get("exePath")
    tpl = resolve_sample_nk_template()
    if tpl:
        settings["sampleNkTemplate"] = tpl
    save_settings(settings)
    return settings
