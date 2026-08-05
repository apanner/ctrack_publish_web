"""Minimal system tray host using embedded Python + pystray."""

from __future__ import annotations

import argparse
import ctypes
import os
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Optional

from gui.api import EngineApiError, apply_update, check_for_update, download_update, engine_supports_auth, get_auth_status, get_status, health_ok
from gui.auth_local import is_locally_paired, read_local_auth_status
from gui.instance_lock import InstanceLock, clear_stale_lock
from gui.icons import load_tray_image
from gui.paths import ensure_gui_path, get_engine_dir, get_python_dir, get_tray_bat, resolve_install_root
from gui.startup import is_launch_at_login, set_launch_at_login
from gui.env_config import resolve_login_url
from gui.tray_anim import launch_settings, open_browser_url

try:
    import pystray
    from PIL import Image
except ImportError as exc:
    print("GUI dependencies missing. Run: scripts/provision-gui-python.ps1", file=sys.stderr)
    raise SystemExit(1) from exc


class TrayHost:
    def __init__(self, install_root: Path, tray_lock: "SingleInstanceLock | None" = None) -> None:
        self.install_root = install_root
        self.engine_dir = get_engine_dir(install_root)
        self.tray_bat = get_tray_bat(install_root)
        self.engine_process: Optional[subprocess.Popen] = None
        self.web_url = os.environ.get("CTRACK_WEB_URL", "https://ctrackpublishweb.vercel.app/")
        self._icon: Optional[pystray.Icon] = None
        self._stop = threading.Event()
        self._tray_lock = tray_lock
        self._pending_update: Optional[dict] = None
        self._update_lock = threading.Lock()
        self._is_installing_update = False

    def _node_exe(self) -> str:
        bundled = self.install_root / "runtime" / "node.exe"
        if bundled.is_file():
            return str(bundled)
        return "node"

    def _start_engine(self) -> None:
        if self.engine_process and self.engine_process.poll() is None:
            return
        server_js = self.engine_dir / "dist" / "server.js"
        if not server_js.is_file():
            return
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.engine_process = subprocess.Popen(
            [self._node_exe(), "dist/server.js"],
            cwd=str(self.engine_dir),
            creationflags=creationflags,
        )

    def _stop_engine(self) -> None:
        if self.engine_process and self.engine_process.poll() is None:
            self.engine_process.terminate()
            try:
                self.engine_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.engine_process.kill()
        self.engine_process = None

    def _kill_process_on_port(self, port: int) -> None:
        if os.name != "nt":
            return
        try:
            result = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, check=False)
            pids: set[str] = set()
            for line in result.stdout.splitlines():
                if f":{port}" not in line or "LISTENING" not in line.upper():
                    continue
                parts = line.split()
                if parts:
                    pids.add(parts[-1])
            for pid in pids:
                if pid.isdigit() and int(pid) != os.getpid():
                    subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True, check=False)
        except Exception:
            pass

    def _ensure_fresh_engine(self) -> None:
        if health_ok() and engine_supports_auth():
            return
        if health_ok() and not engine_supports_auth():
            self._stop_engine()
            self._kill_process_on_port(7777)
            time.sleep(0.8)
        self._start_engine()
        for _ in range(30):
            if health_ok() and engine_supports_auth():
                return
            time.sleep(0.5)

    def _load_icon_image(self) -> Image.Image:
        return load_tray_image(self.engine_dir, size=64)

    def _pythonw_exe(self) -> str:
        pyw = get_python_dir(self.install_root) / "pythonw.exe"
        if pyw.is_file():
            return str(pyw)
        return sys.executable

    def _hidden_flags(self) -> int:
        return subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

    def _tooltip(self) -> str:
        if is_locally_paired():
            account = self._account_display_name()
            if health_ok():
                try:
                    st = get_status()
                    exr = st.get("activeExrBackend") or "none"
                    if account and account != "Signed in":
                        return f"CTrack Engine - {account} | EXR:{exr}"
                    return f"CTrack Engine - Ready | EXR:{exr}"
                except Exception:
                    if account and account != "Signed in":
                        return f"CTrack Engine - {account}"
                    return "CTrack Engine - Ready"
            return "CTrack Engine - starting..."
        if health_ok():
            return "CTrack Engine - Sign in required"
        return "CTrack Engine - starting..."

    def _open_engine(self) -> None:
        subprocess.Popen(
            [self._pythonw_exe(), "-m", "gui.engine_window", "--install-root", str(self.install_root)],
            cwd=str(self.engine_dir / "python"),
            creationflags=self._hidden_flags(),
        )

    def _open_settings(self) -> None:
        launch_settings(self.install_root, page="General", from_tray=True, pythonw_exe=self._pythonw_exe())

    def _open_login(self) -> None:
        if is_locally_paired():
            launch_settings(self.install_root, page="Account", from_tray=True, pythonw_exe=self._pythonw_exe())
            return
        self._open_link_engine_in_browser()

    def _open_link_engine_in_browser(self) -> None:
        """Browser-only sign-in — avoids CustomTkinter borderless card click bugs on Windows."""
        for _ in range(20):
            if health_ok():
                break
            time.sleep(0.25)
        url = resolve_login_url(self.install_root)
        if not open_browser_url(url):
            self._notify("CTrack Engine", f"Open this URL to sign in:\n{url}")

    def _open_web(self) -> None:
        webbrowser.open(self.web_url)

    def _restart(self) -> None:
        self._stop_engine()
        time.sleep(0.8)
        self._start_engine()

    def _quit(self) -> None:
        self._stop_engine()
        if self._icon:
            self._icon.stop()
        if self._tray_lock:
            self._tray_lock.release()
        self._stop.set()

    def _notify(self, title: str, message: str) -> None:
        if not self._icon:
            return
        try:
            self._icon.notify(message, title)
        except Exception:
            pass

    def _refresh_menu(self) -> None:
        if not self._icon:
            return
        try:
            self._icon.menu = self._build_menu()
            self._icon.update_menu()
        except Exception:
            pass

    def _maybe_prompt_login(self) -> None:
        if is_locally_paired():
            return
        clear_stale_lock("login.lock")
        for _ in range(30):
            if health_ok():
                break
            time.sleep(0.5)
        if is_locally_paired():
            return
        try:
            auth = get_auth_status()
            if auth.get("paired"):
                return
        except EngineApiError:
            pass
        self._open_login()

    def _is_paired(self) -> bool:
        if is_locally_paired():
            return True
        try:
            return bool(get_auth_status().get("paired"))
        except EngineApiError:
            return False

    def _account_display_name(self) -> str:
        local = read_local_auth_status()
        email = str(local.get("email") or "").strip()
        if email:
            return email
        try:
            auth = get_auth_status()
            email = str(auth.get("email") or "").strip()
            if email:
                return email
        except EngineApiError:
            pass
        return "Signed in"

    def _build_menu(self) -> pystray.Menu:
        items = []
        if not self._is_paired():
            items.append(pystray.MenuItem("Sign in to CTrack...", lambda _i, _m: self._open_login(), default=True))
            items.append(pystray.Menu.SEPARATOR)
        else:
            items.append(pystray.MenuItem(self._account_display_name(), None, enabled=False))
            items.append(pystray.MenuItem("Account settings...", lambda _i, _m: self._open_login()))
            items.append(pystray.Menu.SEPARATOR)
        items.extend(
            [
                pystray.MenuItem("Open Engine", lambda _i, _m: self._open_engine()),
                pystray.MenuItem("Settings...", lambda _i, _m: self._open_settings()),
                pystray.MenuItem("Open web UI", lambda _i, _m: self._open_web()),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Start at Windows login", self._toggle_startup_login, checked=self._startup_login_checked),
                pystray.MenuItem("Restart engine", lambda _i, _m: self._restart()),
                pystray.MenuItem("Check for updates", lambda _i, _m: self._start_check_updates()),
                pystray.MenuItem(
                    "Install update",
                    lambda _i, _m: self._start_install_update(),
                    enabled=self._is_install_enabled,
                ),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quit", lambda _i, _m: self._quit()),
            ]
        )
        return pystray.Menu(*items)

    def _startup_login_checked(self, _item: object) -> bool:
        return is_launch_at_login(self.tray_bat)

    def _toggle_startup_login(self, _icon: object, _item: object) -> None:
        enabled = not is_launch_at_login(self.tray_bat)
        set_launch_at_login(enabled, self.tray_bat)
        self._notify("CTrack Engine", "Start at login enabled." if enabled else "Start at login disabled.")
        self._refresh_menu()

    def _set_pending_update(self, payload: Optional[dict]) -> None:
        with self._update_lock:
            self._pending_update = payload
        self._refresh_menu()

    def _get_pending_update(self) -> Optional[dict]:
        with self._update_lock:
            return self._pending_update

    def _is_install_enabled(self, _item: object) -> bool:
        if self._is_installing_update:
            return False
        return self._get_pending_update() is not None

    def _check_for_updates(self, manual: bool = False) -> None:
        try:
            result = check_for_update()
        except EngineApiError as exc:
            if manual:
                self._notify("CTrack Engine", f"Update check failed: {exc}")
            return
        if result.get("updateAvailable"):
            pending = result.get("pendingUpdate")
            if isinstance(pending, dict):
                self._set_pending_update(pending)
            version = str(result.get("remoteVersion") or "new")
            self._notify("CTrack update available", f"Version {version} is ready.")
            return
        self._set_pending_update(None)
        if manual:
            self._notify("CTrack Engine", "Engine is up to date.")

    def _download_and_apply_update(self) -> None:
        if self._is_installing_update:
            return
        self._is_installing_update = True
        self._refresh_menu()
        try:
            result = download_update()
            pending = result.get("pendingUpdate")
            if not isinstance(pending, dict):
                self._notify("CTrack Engine", "No update package was downloaded.")
                return
            self._set_pending_update(pending)
            apply_result = apply_update()
            if bool(apply_result.get("launched")):
                self._notify("CTrack update", "Installer launched. Engine will update silently.")
            else:
                self._notify("CTrack update", "No downloaded installer was ready.")
        except EngineApiError as exc:
            self._notify("CTrack update", f"Install failed: {exc}")
        finally:
            self._is_installing_update = False
            self._refresh_menu()

    def _start_check_updates(self) -> None:
        threading.Thread(target=lambda: self._check_for_updates(manual=True), daemon=True).start()

    def _start_install_update(self) -> None:
        threading.Thread(target=self._download_and_apply_update, daemon=True).start()

    def _poll_updates(self) -> None:
        # Check once at startup, then every 24 hours.
        update_poll_seconds = 24 * 60 * 60
        self._check_for_updates(manual=False)
        while not self._stop.wait(update_poll_seconds):
            self._check_for_updates(manual=False)

    def _poll_status(self) -> None:
        was_paired = self._is_paired()
        last_account_label = ""
        refresh_touch = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".ctrack-engine" / "tray-refresh.touch"
        while not self._stop.is_set():
            if refresh_touch.is_file():
                try:
                    refresh_touch.unlink()
                except OSError:
                    pass
                self._refresh_menu()
                self._notify("CTrack Engine", "Account linked.")
            if self._icon:
                self._icon.title = self._tooltip()
                now_paired = self._is_paired()
                if now_paired != was_paired:
                    if now_paired:
                        self._notify("CTrack Engine", "Account linked.")
                    was_paired = now_paired
                    last_account_label = self._account_display_name() if now_paired else ""
                    self._refresh_menu()
                elif now_paired:
                    label = self._account_display_name()
                    if label != last_account_label:
                        last_account_label = label
                        self._refresh_menu()
            time.sleep(3)

    def run(self) -> None:
        self._ensure_fresh_engine()
        for _ in range(15):
            if health_ok():
                break
            time.sleep(0.4)

        menu = self._build_menu()
        self._icon = pystray.Icon("CTrackEngine", self._load_icon_image(), "CTrack Publish Engine", menu)
        threading.Thread(target=self._poll_status, daemon=True).start()
        threading.Thread(target=self._poll_updates, daemon=True).start()
        threading.Thread(target=self._maybe_prompt_login, daemon=True).start()
        self._icon.run()


class SingleInstanceLock(InstanceLock):
    def __init__(self) -> None:
        super().__init__("tray.lock")


def _spawn_login(install_root: Path) -> None:
    """Open browser pairing instead of the legacy CustomTkinter sign-in card."""
    clear_stale_lock("login.lock")
    for _ in range(20):
        if health_ok():
            break
        time.sleep(0.25)
    url = resolve_login_url(install_root)
    if not open_browser_url(url):
        print(f"Open this URL to sign in: {url}", file=sys.stderr)


def _show_already_running_notice() -> None:
    try:
        ctypes.windll.user32.MessageBoxW(0, "CTrack tray is already running.", "CTrack Publish Engine", 0x40 | 0x0)
    except Exception:
        print("CTrack tray is already running.", file=sys.stderr)


def main() -> None:
    ensure_gui_path()
    parser = argparse.ArgumentParser(description="CTrack Engine tray")
    parser.add_argument("--install-root", default=None)
    args = parser.parse_args()
    root = resolve_install_root(args.install_root)
    tray_lock = SingleInstanceLock()
    if not tray_lock.acquire():
        if not is_locally_paired():
            clear_stale_lock("login.lock")
            _spawn_login(root)
            raise SystemExit(0)
        _show_already_running_notice()
        raise SystemExit(0)
    try:
        TrayHost(root, tray_lock=tray_lock).run()
    finally:
        tray_lock.release()


if __name__ == "__main__":
    main()
