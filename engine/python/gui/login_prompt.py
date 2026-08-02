"""CTrack Engine sign-in card — slides from system tray."""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from pathlib import Path
from typing import Literal, Optional

import customtkinter as ctk

from gui import theme as T
from gui.api import EngineApiError, get_auth_status, get_login_url, health_ok
from gui.auth_local import consume_pair_complete_signal, get_credentials_path, is_locally_paired, read_local_auth_status
from gui.engine_bootstrap import ensure_engine_running
from gui.env_config import resolve_login_url
from gui.icons import apply_window_icon
from gui.instance_lock import InstanceLock, clear_stale_lock
from gui.paths import ensure_gui_path, get_engine_dir, resolve_install_root
from gui.tray_anim import CARD_H, CARD_W, open_browser_url, place_card, signal_tray_refresh, slide_down, slide_up

ctk.set_appearance_mode("dark")

Phase = Literal["idle", "waiting", "done", "error"]


class LoginPromptLock(InstanceLock):
    def __init__(self) -> None:
        super().__init__("login.lock")


class LoginPromptWindow(ctk.CTk):
    WIDTH = CARD_W
    HEIGHT = CARD_H

    def __init__(self, install_root: str | None = None) -> None:
        super().__init__()
        self.install_root = resolve_install_root(install_root)
        self.engine_dir = get_engine_dir(self.install_root)
        self._login_url = resolve_login_url(self.install_root)
        self._phase: Phase = "idle"
        self._closing = False
        self._waiting_since: float = 0.0
        self._cred_mtime: float = 0.0
        self._poll_ms = 200
        self._paired_detected = False

        self.title("CTrack Engine")
        self.resizable(False, False)
        self.configure(fg_color="#151D28")
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        if sys.platform == "win32":
            try:
                self.attributes("-toolwindow", True)
            except Exception:
                pass
        apply_window_icon(self, self.engine_dir)
        self._build_ui()
        self.protocol("WM_DELETE_WINDOW", self._minimize_to_tray)
        self.withdraw()
        threading.Thread(
            target=lambda: ensure_engine_running(self.install_root, self.engine_dir),
            daemon=True,
        ).start()
        self.after(40, lambda: slide_up(self, width=self.WIDTH, height=self.HEIGHT, on_done=self._on_shown))
        self.after(300, self._poll_auth)

    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        bar = ctk.CTkFrame(self, fg_color="#0F1720", corner_radius=0, height=40)
        bar.grid(row=0, column=0, sticky="ew")
        bar.grid_propagate(False)

        ctk.CTkLabel(bar, text="CTrack Engine", font=("Segoe UI", 12, "bold"), text_color="#E8EEF5").pack(
            side="left", padx=16, pady=10
        )
        self.btn_minimize = ctk.CTkButton(
            bar,
            text="−",
            width=34,
            height=28,
            corner_radius=4,
            fg_color="#243041",
            hover_color="#334155",
            text_color="#E8EEF5",
            font=("Segoe UI", 16, "bold"),
            command=self._minimize_to_tray,
        )
        self.btn_minimize.pack(side="right", padx=10, pady=6)

        self.bind("<Escape>", lambda _event: self._minimize_to_tray())
        if sys.platform == "win32":
            self.bind("<Alt-F4>", lambda _event: self._minimize_to_tray())

        body = ctk.CTkFrame(self, fg_color="#151D28", corner_radius=0)
        body.grid(row=1, column=0, sticky="nsew", padx=0, pady=0)
        body.grid_columnconfigure(0, weight=1)

        self.lbl_heading = ctk.CTkLabel(body, text="Sign in", font=("Segoe UI", 17, "bold"), text_color="#E8EEF5")
        self.lbl_heading.grid(row=0, column=0, padx=20, pady=(16, 4), sticky="w")

        self.lbl_status = ctk.CTkLabel(
            body,
            text="Link this workstation to your account",
            font=("Segoe UI", 12),
            text_color="#8FA0B3",
            wraplength=340,
            justify="left",
        )
        self.lbl_status.grid(row=1, column=0, padx=20, pady=(0, 16), sticky="w")

        self.btn_signin = ctk.CTkButton(
            body,
            text="Sign in",
            height=38,
            corner_radius=6,
            fg_color=T.ACCENT,
            hover_color=T.ACCENT_HOVER,
            text_color="#041812",
            font=("Segoe UI", 13, "bold"),
            command=self._sign_in,
        )
        self.btn_signin.grid(row=2, column=0, padx=20, pady=(0, 8), sticky="ew")

        self.btn_hide = ctk.CTkButton(
            body,
            text="Hide to tray",
            height=28,
            corner_radius=4,
            fg_color="transparent",
            hover_color="#1E2936",
            text_color="#8FA0B3",
            font=("Segoe UI", 11),
            command=self._minimize_to_tray,
        )
        self.btn_hide.grid(row=3, column=0, padx=20, pady=(0, 14), sticky="ew")

    def _on_shown(self) -> None:
        place_card(self, self.WIDTH, self.HEIGHT)
        self.lift()
        self.focus_force()

    def _set_phase(self, phase: Phase, message: str = "") -> None:
        self._phase = phase
        if phase == "idle":
            self.lbl_heading.configure(text="Sign in")
            self.lbl_status.configure(text="Link this workstation to your account", text_color="#8FA0B3")
            self.btn_signin.configure(state="normal", text="Sign in")
            return
        if phase == "waiting":
            self.lbl_status.configure(text=message or "Complete sign-in in your browser", text_color="#E8EEF5")
            self.btn_signin.configure(state="normal", text="Open browser again")
            return
        if phase == "done":
            email = read_local_auth_status().get("email")
            detail = f"Signed in as {email}" if email else "Account linked"
            self.lbl_heading.configure(text="Connected")
            self.lbl_status.configure(text=detail, text_color=T.ACCENT)
            self.btn_signin.configure(state="disabled", text="Sign in")
            self.btn_hide.configure(state="disabled")
            return
        if phase == "error":
            self.lbl_status.configure(text=message or "Sign-in failed", text_color=T.ERROR)
            self.btn_signin.configure(state="normal", text="Sign in")
        place_card(self, self.WIDTH, self.HEIGHT)

    def _resolve_url(self) -> str:
        if self._login_url:
            return self._login_url
        try:
            payload = get_login_url(install_root=str(self.install_root))
            url = str(payload.get("url") or "").strip()
            if url:
                self._login_url = url
                return url
        except EngineApiError:
            pass
        self._login_url = resolve_login_url(self.install_root)
        return self._login_url

    def _pairing_detected(self) -> bool:
        if self._paired_detected:
            return False
        if consume_pair_complete_signal():
            return True
        if is_locally_paired():
            return True
        try:
            return bool(get_auth_status().get("paired"))
        except EngineApiError:
            return False

    def _credentials_changed(self) -> bool:
        path = get_credentials_path()
        if not path.is_file():
            return False
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return False
        if mtime <= self._cred_mtime:
            return is_locally_paired() and self._phase in ("idle", "waiting", "error")
        self._cred_mtime = mtime
        return is_locally_paired()

    def _sign_in(self) -> None:
        if self._phase == "done" or self._closing:
            return
        if not ensure_engine_running(self.install_root, self.engine_dir):
            self._set_phase("error", "Engine is not running — restart tray")
            return
        url = self._resolve_url()
        if not url:
            self._set_phase("error", "Could not resolve sign-in URL")
            return
        if not open_browser_url(url):
            self._set_phase("error", "Could not open browser")
            return
        self._waiting_since = time.time()
        self._poll_ms = 150
        self._set_phase("waiting", "Finish sign-in in browser at 127.0.0.1 — linking this PC…")

    def _poll_auth(self) -> None:
        if self._closing:
            return
        try:
            if self._pairing_detected() or self._credentials_changed():
                self._on_paired()
                return
            if self._phase == "waiting":
                ensure_engine_running(self.install_root, self.engine_dir, timeout_sec=2.0)
                elapsed = time.time() - self._waiting_since if self._waiting_since else 0.0
                if elapsed > 60:
                    self._set_phase(
                        "error",
                        "Link failed — check browser tab for errors, then Sign in again",
                    )
                elif elapsed > 12 and not health_ok():
                    self._set_phase("waiting", "Starting engine — keep tray running")
        except Exception:
            pass
        self.after(self._poll_ms, self._poll_auth)

    def _on_paired(self) -> None:
        if self._phase == "done" or self._closing or self._paired_detected:
            return
        self._paired_detected = True
        self._set_phase("done")
        signal_tray_refresh()
        self.update_idletasks()
        self.after(700, self._finish)

    def _finish(self) -> None:
        if self._closing:
            return
        self._minimize_to_tray()

    def _minimize_to_tray(self) -> None:
        if self._closing:
            return
        self._closing = True
        w, h, _, _ = place_card(self, self.WIDTH, self.HEIGHT)
        destroyed = False

        def hide() -> None:
            nonlocal destroyed
            if destroyed:
                return
            destroyed = True
            try:
                self.destroy()
            except Exception:
                pass

        slide_down(self, width=w, height=h, on_done=hide)
        self.after(400, hide)


def main() -> None:
    ensure_gui_path()
    parser = argparse.ArgumentParser(description="CTrack Engine sign-in")
    parser.add_argument("--install-root", default=None)
    args = parser.parse_args()

    if is_locally_paired():
        raise SystemExit(0)

    lock = LoginPromptLock()
    clear_stale_lock("login.lock")
    if not lock.acquire():
        raise SystemExit(0)

    try:
        LoginPromptWindow(install_root=args.install_root).mainloop()
    finally:
        lock.release()


if __name__ == "__main__":
    main()
