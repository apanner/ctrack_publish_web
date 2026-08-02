"""Single-instance file locks with stale PID recovery."""

from __future__ import annotations

import msvcrt
import os
from pathlib import Path
from typing import Optional


def _lock_dir() -> Path:
    path = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".ctrack-engine"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _read_lock_pid(lock_path: Path) -> Optional[int]:
    if not lock_path.is_file():
        return None
    try:
        raw = lock_path.read_text(encoding="ascii", errors="ignore").strip()
        return int(raw) if raw.isdigit() else None
    except OSError:
        return None


def clear_stale_lock(name: str) -> bool:
    lock_path = _lock_dir() / name
    if not lock_path.is_file():
        return False
    pid = _read_lock_pid(lock_path)
    if pid is not None and _pid_alive(pid):
        return False
    try:
        lock_path.unlink(missing_ok=True)
        return True
    except OSError:
        return False


class InstanceLock:
    def __init__(self, name: str) -> None:
        self.lock_path = _lock_dir() / name
        self._handle: Optional[object] = None
        self._locked = False

    def acquire(self) -> bool:
        clear_stale_lock(self.lock_path.name)
        try:
            self._handle = open(self.lock_path, "a+b")
        except OSError:
            return False
        self._handle.seek(0)
        try:
            msvcrt.locking(self._handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            pid = _read_lock_pid(self.lock_path)
            if pid is not None and not _pid_alive(pid):
                try:
                    self._handle.close()
                except OSError:
                    pass
                self._handle = None
                try:
                    self.lock_path.unlink(missing_ok=True)
                except OSError:
                    pass
                return self.acquire()
            try:
                self._handle.close()
            except OSError:
                pass
            self._handle = None
            return False
        self._handle.seek(0)
        self._handle.truncate()
        self._handle.write(str(os.getpid()).encode("ascii", errors="ignore"))
        self._handle.flush()
        self._locked = True
        return True

    def release(self) -> None:
        if self._handle is None:
            return
        if self._locked:
            try:
                self._handle.seek(0)
                msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
            self._locked = False
        try:
            self._handle.close()
        except OSError:
            pass
        self._handle = None
