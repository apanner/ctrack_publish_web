"""Windows startup (Run registry) helpers for CTrack tray."""

from __future__ import annotations

import os
from pathlib import Path

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE_NAME = "CTrackPublishEngine"


def is_launch_at_login(tray_bat: Path) -> bool:
    try:
        import winreg

        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ)
        try:
            value, _ = winreg.QueryValueEx(key, RUN_VALUE_NAME)
            return os.path.normcase(str(value)) == os.path.normcase(f'"{tray_bat}"')
        except FileNotFoundError:
            return False
        finally:
            winreg.CloseKey(key)
    except OSError:
        return False


def set_launch_at_login(enabled: bool, tray_bat: Path) -> None:
    try:
        import winreg

        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE)
        try:
            if enabled:
                winreg.SetValueEx(key, RUN_VALUE_NAME, 0, winreg.REG_SZ, f'"{tray_bat}"')
            else:
                try:
                    winreg.DeleteValue(key, RUN_VALUE_NAME)
                except FileNotFoundError:
                    pass
        finally:
            winreg.CloseKey(key)
    except OSError:
        pass
