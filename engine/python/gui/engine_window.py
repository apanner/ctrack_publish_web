"""Minimal engine console: live logs + recent publish jobs."""

from __future__ import annotations

import argparse
import sys
import tkinter as tk
from typing import Any, Dict, List, Optional

import customtkinter as ctk

from gui import theme as T
from gui.env_config import resolve_login_url
from gui.tray_anim import launch_settings, open_browser_url
from gui.api import EngineApiError, get_auth_status, get_logs_tail, get_publish_jobs, get_status, health_ok
from gui.auth_local import is_locally_paired
from gui.icons import apply_window_icon
from gui.paths import ensure_gui_path, get_engine_dir, resolve_install_root


class EngineWindow(ctk.CTk):
    def __init__(self, install_root: Optional[str] = None) -> None:
        super().__init__()
        self.install_root = resolve_install_root(install_root)
        self.engine_dir = get_engine_dir(self.install_root)
        self._poll_ms = 3000
        self._job_lines: List[str] = []

        self.title("CTrack Engine")
        self.geometry("820x520")
        self.minsize(640, 400)
        self.configure(fg_color=T.BG)

        apply_window_icon(self, self.engine_dir)
        self._build_ui()
        self._refresh()
        self.protocol("WM_DELETE_WINDOW", self.destroy)

    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, fg_color="#0F1720", corner_radius=0, height=52)
        header.grid(row=0, column=0, sticky="ew")
        header.grid_columnconfigure(0, weight=1)

        self.lbl_status = ctk.CTkLabel(header, text="Engine: checking...", font=T.FONT, text_color=T.TEXT)
        self.lbl_status.grid(row=0, column=0, padx=20, pady=14, sticky="w")

        btn_row = ctk.CTkFrame(header, fg_color="transparent")
        btn_row.grid(row=0, column=1, padx=16, pady=10)
        ctk.CTkButton(btn_row, text="Settings", width=88, fg_color="#182230", command=self._open_settings).pack(side="left", padx=4)
        ctk.CTkButton(btn_row, text="Refresh", width=88, fg_color=T.ACCENT, hover_color=T.ACCENT_HOVER, text_color="#062018", command=self._refresh_once).pack(side="left", padx=4)

        body = ctk.CTkFrame(self, fg_color=T.BG)
        body.grid(row=1, column=0, sticky="nsew", padx=16, pady=(8, 16))
        body.grid_columnconfigure(0, weight=1)
        body.grid_rowconfigure(2, weight=3)
        body.grid_rowconfigure(4, weight=1)

        self.auth_banner = ctk.CTkFrame(body, fg_color="#2A1A12", border_color="#7A4A2A", border_width=1)
        self.auth_banner.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        self.auth_banner.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(
            self.auth_banner,
            text="Sign in from the tray menu or click Sign in to open the browser pairing page.",
            font=T.FONT_SM,
            text_color="#F5D0A9",
        ).grid(row=0, column=0, padx=12, pady=10, sticky="w")
        ctk.CTkButton(
            self.auth_banner,
            text="Sign in",
            width=88,
            fg_color=T.ACCENT,
            hover_color=T.ACCENT_HOVER,
            text_color="#062018",
            command=self._open_login,
        ).grid(row=0, column=1, padx=12, pady=8)

        ctk.CTkLabel(body, text="Log", font=T.FONT_SM, text_color=T.MUTED).grid(row=1, column=0, sticky="w", pady=(0, 4))
        self.log_box = ctk.CTkTextbox(body, font=("Consolas", 11), fg_color="#0B1118", text_color="#C8D4E0")
        self.log_box.grid(row=2, column=0, sticky="nsew")
        self.log_box.configure(state="disabled")

        ctk.CTkLabel(body, text="Recent jobs", font=T.FONT_SM, text_color=T.MUTED).grid(row=3, column=0, sticky="w", pady=(12, 4))
        self.jobs_box = ctk.CTkTextbox(body, height=120, font=("Consolas", 11), fg_color="#0B1118", text_color="#9FB0C3")
        self.jobs_box.grid(row=4, column=0, sticky="nsew")
        self.jobs_box.configure(state="disabled")

    def _open_settings(self) -> None:
        from gui.tray_anim import launch_settings

        launch_settings(self.install_root, page="General", from_tray=True, pythonw_exe=self._pythonw_exe())

    def _open_login(self) -> None:
        url = resolve_login_url(self.install_root)
        if not open_browser_url(url):
            self.lbl_status.configure(text=f"Open in browser: {url}")

    def _refresh_once(self) -> None:
        self._refresh(force_continue=False)

    def _pythonw_exe(self) -> str:
        pyw = self.install_root / "runtime" / "python" / "pythonw.exe"
        if not pyw.is_file():
            pyw = self.engine_dir / "runtime" / "python" / "pythonw.exe"
        return str(pyw) if pyw.is_file() else sys.executable

    def _set_text(self, widget: ctk.CTkTextbox, text: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", tk.END)
        widget.insert("1.0", text)
        widget.configure(state="disabled")
        widget.see(tk.END)

    def _format_jobs(self, jobs: List[Dict[str, Any]]) -> str:
        if not jobs:
            return "No publish jobs yet."
        lines: List[str] = []
        for job in jobs[:12]:
            job_id = str(job.get("id") or "?")[:8]
            status = str(job.get("status") or "unknown")
            path = str(job.get("file_path") or job.get("input_path") or "")
            if len(path) > 72:
                path = "..." + path[-69:]
            lines.append(f"{job_id}  {status:10}  {path}")
        return "\n".join(lines)

    def _refresh(self, force_continue: bool = True) -> None:
        paired = is_locally_paired()
        if not paired:
            try:
                auth = get_auth_status()
                paired = bool(auth.get("paired"))
            except EngineApiError:
                paired = False
        if paired:
            self.auth_banner.grid_remove()
        else:
            self.auth_banner.grid()

        try:
            if health_ok():
                if paired:
                    st = get_status()
                    exr = st.get("activeExrBackend") or "auto"
                    self.lbl_status.configure(text=f"Ready  |  EXR: {exr}")
                else:
                    self.lbl_status.configure(text="Sign in required")
            else:
                self.lbl_status.configure(text="Engine offline  |  start tray or wait...")
        except EngineApiError:
            self.lbl_status.configure(text="Engine unreachable on 127.0.0.1:7777")

        try:
            tail = get_logs_tail(limit=200)
            lines = tail.get("lines") if isinstance(tail.get("lines"), list) else []
            self._set_text(self.log_box, "\n".join(str(line) for line in lines))
        except EngineApiError as exc:
            self._set_text(self.log_box, f"Could not load logs.\n{exc}")

        try:
            jobs_payload = get_publish_jobs(limit=20)
            jobs = jobs_payload.get("jobs") if isinstance(jobs_payload.get("jobs"), list) else []
            self._set_text(self.jobs_box, self._format_jobs(jobs))
        except EngineApiError:
            self._set_text(self.jobs_box, "Jobs unavailable.")

        if force_continue:
            self.after(self._poll_ms, self._refresh)


def main() -> None:
    ensure_gui_path()
    parser = argparse.ArgumentParser(description="CTrack Engine console")
    parser.add_argument("--install-root", default=None)
    args = parser.parse_args()
    app = EngineWindow(install_root=args.install_root)
    app.mainloop()


if __name__ == "__main__":
    main()
