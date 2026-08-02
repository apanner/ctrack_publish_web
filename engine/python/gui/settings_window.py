"""CustomTkinter settings window for CTrack Engine."""

from __future__ import annotations

import argparse
import base64
import os
import subprocess
import sys
import tkinter as tk
from tkinter import filedialog, messagebox
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import customtkinter as ctk

from gui import theme as T
from gui.api import (
    EngineApiError,
    get_auth_status,
    get_settings,
    get_templates,
    import_template,
    patch_settings,
    push_templates,
    rescan_tools,
    unpair_account,
)
from gui.icons import apply_window_icon
from gui.paths import ensure_gui_path, get_engine_dir, get_tray_bat, resolve_install_root
from gui.startup import set_launch_at_login

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("dark-blue")


class SettingsWindow(ctk.CTk):
    def __init__(
        self,
        install_root: Optional[str] = None,
        *,
        initial_page: str = "General",
        animate_from_tray: bool = False,
    ) -> None:
        super().__init__()
        self.install_root = resolve_install_root(install_root)
        self.engine_dir = get_engine_dir(self.install_root)
        self._initial_page = initial_page
        self._animate_from_tray = animate_from_tray
        self.bundle: Optional[Dict[str, Any]] = None
        self.custom_nuke: Optional[str] = None
        self.selected_preset = "1080p"
        self.templates: List[Dict[str, Any]] = []
        self.template_ids: List[str] = []
        self.selected_template_id: Optional[str] = None
        self.auth_status: Dict[str, Any] = {"paired": False}
        self._nav_buttons: Dict[str, ctk.CTkButton] = {}
        self._pages: Dict[str, ctk.CTkFrame] = {}

        self.title("CTrack Publish Engine")
        self.geometry("980x720")
        self.minsize(900, 660)
        self.configure(fg_color=T.BG)

        apply_window_icon(self, self.engine_dir)
        self._build_shell()
        self._load_data()
        self.after(300, lambda: apply_window_icon(self, self.engine_dir))
        self.protocol("WM_DELETE_WINDOW", self.destroy)

    def _build_shell(self) -> None:
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        sidebar = ctk.CTkFrame(self, width=248, fg_color=T.SIDEBAR, corner_radius=0)
        sidebar.grid(row=0, column=0, sticky="nsew")
        sidebar.grid_propagate(False)

        logo_frame = ctk.CTkFrame(sidebar, fg_color="transparent")
        logo_frame.pack(fill="x", padx=20, pady=(24, 16))
        ctk.CTkLabel(logo_frame, text="CTrack Engine", font=T.FONT_TITLE, text_color=T.TEXT).pack(anchor="w")
        ctk.CTkLabel(logo_frame, text="Publish pipeline", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(2, 0))

        nav_items = ("General", "Account", "Review & MP4", "Nuke", "Tools")
        for name in nav_items:
            btn = ctk.CTkButton(
                sidebar,
                text=name,
                anchor="w",
                height=40,
                fg_color="transparent",
                hover_color="#182230",
                text_color=T.MUTED,
                font=T.FONT,
                command=lambda n=name: self._show_page(n),
            )
            btn.pack(fill="x", padx=12, pady=2)
            self._nav_buttons[name] = btn

        self.status_card = ctk.CTkFrame(sidebar, fg_color="#121A24", border_color=T.CARD_BORDER, border_width=1)
        self.status_card.pack(side="bottom", fill="x", padx=12, pady=16)
        self.lbl_backend = ctk.CTkLabel(self.status_card, text="EXR backend: --", font=T.FONT_SM, text_color=T.ACCENT)
        self.lbl_backend.pack(anchor="w", padx=14, pady=(12, 0))
        self.lbl_nuke_count = ctk.CTkLabel(self.status_card, text="Nuke installs: 0", font=("Segoe UI", 11), text_color=T.MUTED)
        self.lbl_nuke_count.pack(anchor="w", padx=14, pady=(4, 12))

        body = ctk.CTkFrame(self, fg_color=T.BG, corner_radius=0)
        body.grid(row=0, column=1, sticky="nsew")
        body.grid_rowconfigure(0, weight=1)
        body.grid_columnconfigure(0, weight=1)

        self.content = ctk.CTkFrame(body, fg_color=T.BG)
        self.content.grid(row=0, column=0, sticky="nsew", padx=28, pady=24)

        footer = ctk.CTkFrame(body, fg_color="#0F1720", height=56, corner_radius=0)
        footer.grid(row=1, column=0, sticky="ew")
        footer.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(footer, text="Saved to %USERPROFILE%\\.ctrack-engine\\", font=T.FONT_SM, text_color=T.MUTED).grid(
            row=0, column=0, padx=24, pady=16, sticky="w"
        )
        btn_row = ctk.CTkFrame(footer, fg_color="transparent")
        btn_row.grid(row=0, column=1, padx=24, pady=12)
        ctk.CTkButton(btn_row, text="Cancel", width=96, fg_color="#182230", hover_color="#243041", text_color=T.TEXT, command=self.destroy).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(
            btn_row,
            text="Save settings",
            width=128,
            fg_color=T.ACCENT,
            hover_color=T.ACCENT_HOVER,
            text_color="#062018",
            font=("Segoe UI", 13, "bold"),
            command=self._save,
        ).pack(side="left")

        self._build_page_general()
        self._build_page_account()
        self._build_page_review()
        self._build_page_nuke()
        self._build_page_tools()
        self._show_page(self._initial_page if self._initial_page in self._pages else "General")

    def _card(self, parent: ctk.CTkFrame) -> ctk.CTkFrame:
        frame = ctk.CTkFrame(parent, fg_color=T.CARD, border_color=T.CARD_BORDER, border_width=1, corner_radius=12)
        frame.pack(fill="x", pady=(0, 14))
        inner = ctk.CTkFrame(frame, fg_color="transparent")
        inner.pack(fill="x", padx=20, pady=18)
        return inner

    def _build_page_general(self) -> None:
        page = ctk.CTkFrame(self.content, fg_color="transparent")
        self._pages["General"] = page
        ctk.CTkLabel(page, text="General", font=T.FONT_LG, text_color=T.TEXT).pack(anchor="w")
        ctk.CTkLabel(page, text="Connection and startup", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(0, 16))

        c1 = self._card(page)
        ctk.CTkLabel(c1, text="Hosted web UI URL", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w")
        self.txt_web = ctk.CTkEntry(c1, height=38, fg_color=T.INPUT_BG, border_color=T.INPUT_BORDER)
        self.txt_web.pack(fill="x", pady=(6, 0))
        self.chk_login = ctk.CTkCheckBox(c1, text="Start engine when Windows starts", font=T.FONT)
        self.chk_login.pack(anchor="w", pady=(14, 4))
        self.chk_notify = ctk.CTkCheckBox(c1, text="Notify when tools are missing", font=T.FONT)
        self.chk_notify.pack(anchor="w")

        c2 = self._card(page)
        ctk.CTkLabel(c2, text="Engine status", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w")
        self.lbl_engine_status = ctk.CTkLabel(c2, text="", font=T.FONT, text_color=T.TEXT, justify="left")
        self.lbl_engine_status.pack(anchor="w", pady=(6, 0))
        row = ctk.CTkFrame(c2, fg_color="transparent")
        row.pack(anchor="w", pady=(14, 0))
        ctk.CTkButton(row, text="Open config folder", fg_color="#182230", command=self._open_config).pack(side="left", padx=(0, 8))
        ctk.CTkButton(row, text="Open web setup", fg_color="#182230", command=self._open_setup).pack(side="left")

    def _build_page_review(self) -> None:
        page = ctk.CTkFrame(self.content, fg_color="transparent")
        self._pages["Review & MP4"] = page
        ctk.CTkLabel(page, text="Review & MP4", font=T.FONT_LG, text_color=T.TEXT).pack(anchor="w")
        ctk.CTkLabel(page, text="Transcode pipeline and output scale", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(0, 16))

        c1 = self._card(page)
        ctk.CTkLabel(c1, text="Transcode mode", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w")
        self.cmb_mode = ctk.CTkComboBox(c1, values=["auto", "nuke", "oiio", "ffmpeg"], width=200, fg_color=T.INPUT_BG)
        self.cmb_mode.pack(anchor="w", pady=(6, 0))
        ctk.CTkLabel(c1, text="Fallback order (auto mode)", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(14, 6))
        order_row = ctk.CTkFrame(c1, fg_color="transparent")
        order_row.pack(fill="x")
        self.lst_order = tk.Listbox(
            order_row,
            height=4,
            bg=T.INPUT_BG,
            fg=T.TEXT,
            selectbackground="#243041",
            highlightthickness=1,
            highlightbackground=T.INPUT_BORDER,
            borderwidth=0,
            font=("Segoe UI", 12),
        )
        self.lst_order.pack(side="left", fill="x", expand=True)
        btns = ctk.CTkFrame(order_row, fg_color="transparent")
        btns.pack(side="left", padx=(10, 0))
        ctk.CTkButton(btns, text="Up", width=64, fg_color="#182230", command=lambda: self._move_order(-1)).pack(pady=(0, 6))
        ctk.CTkButton(btns, text="Down", width=64, fg_color="#182230", command=lambda: self._move_order(1)).pack()
        self.lbl_active = ctk.CTkLabel(c1, text="", font=T.FONT_SM, text_color=T.MUTED)
        self.lbl_active.pack(anchor="w", pady=(10, 0))

        c2 = self._card(page)
        ctk.CTkLabel(c2, text="MP4 review scale", font=("Segoe UI", 15, "bold"), text_color=T.TEXT).pack(anchor="w")
        ctk.CTkLabel(c2, text="Nuke Reformat, OIIO fit, FFmpeg scale", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(0, 10))
        ctk.CTkLabel(c2, text="Preset", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w")
        self.cmb_preset = ctk.CTkComboBox(
            c2,
            values=list(T.MP4_PRESETS.keys()),
            width=280,
            fg_color=T.INPUT_BG,
            command=self._on_preset_change,
        )
        self.cmb_preset.pack(anchor="w", pady=(6, 0))
        dim_row = ctk.CTkFrame(c2, fg_color="transparent")
        dim_row.pack(fill="x", pady=(14, 0))
        dim_row.grid_columnconfigure(0, weight=1)
        dim_row.grid_columnconfigure(2, weight=1)
        left = ctk.CTkFrame(dim_row, fg_color="transparent")
        left.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        ctk.CTkLabel(left, text="Width (px)", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w")
        self.txt_width = ctk.CTkEntry(left, height=38, fg_color=T.INPUT_BG, border_color=T.INPUT_BORDER)
        self.txt_width.pack(fill="x", pady=(4, 0))
        right = ctk.CTkFrame(dim_row, fg_color="transparent")
        right.grid(row=0, column=2, sticky="ew")
        ctk.CTkLabel(right, text="Height (px)", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w")
        self.txt_height = ctk.CTkEntry(right, height=38, fg_color=T.INPUT_BG, border_color=T.INPUT_BORDER)
        self.txt_height.pack(fill="x", pady=(4, 0))

        c3 = self._card(page)
        ctk.CTkLabel(c3, text="Templates", font=("Segoe UI", 15, "bold"), text_color=T.TEXT).pack(anchor="w")
        ctk.CTkLabel(c3, text="Default Nuke review template", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(0, 10))
        row = ctk.CTkFrame(c3, fg_color="transparent")
        row.pack(fill="x")
        row.grid_columnconfigure(0, weight=1)
        self.cmb_template = ctk.CTkComboBox(
            row,
            values=["review_mp4"],
            fg_color=T.INPUT_BG,
            command=self._on_template_change,
        )
        self.cmb_template.grid(row=0, column=0, sticky="ew")
        ctk.CTkButton(row, text="Refresh", width=84, fg_color="#182230", command=self._refresh_templates).grid(row=0, column=1, padx=(8, 0))
        self.txt_template_path = ctk.CTkTextbox(c3, height=64, fg_color=T.INPUT_BG, border_color=T.INPUT_BORDER)
        self.txt_template_path.pack(fill="x", pady=(10, 0))
        action_row = ctk.CTkFrame(c3, fg_color="transparent")
        action_row.pack(fill="x", pady=(10, 0))
        ctk.CTkButton(action_row, text="Import .nk...", fg_color="#182230", command=self._import_template_file).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(action_row, text="Open templates folder", fg_color="#182230", command=self._open_templates_folder).pack(
            side="left"
        )
        ctk.CTkLabel(c3, text="Push to studio folder (optional)", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(14, 4))
        push_row = ctk.CTkFrame(c3, fg_color="transparent")
        push_row.pack(fill="x")
        push_row.grid_columnconfigure(0, weight=1)
        self.txt_push_templates_dir = ctk.CTkEntry(push_row, height=36, fg_color=T.INPUT_BG, border_color=T.INPUT_BORDER)
        self.txt_push_templates_dir.grid(row=0, column=0, sticky="ew")
        ctk.CTkButton(push_row, text="Push", width=84, fg_color="#182230", command=self._push_templates_to_studio).grid(
            row=0, column=1, padx=(8, 0)
        )

    def _build_page_account(self) -> None:
        page = ctk.CTkFrame(self.content, fg_color="transparent")
        self._pages["Account"] = page
        ctk.CTkLabel(page, text="Account", font=T.FONT_LG, text_color=T.TEXT).pack(anchor="w")
        ctk.CTkLabel(page, text="Pairing and update authorization", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(0, 16))
        card = self._card(page)
        self.lbl_account_state = ctk.CTkLabel(card, text="Loading account status...", font=T.FONT, text_color=T.TEXT, justify="left")
        self.lbl_account_state.pack(anchor="w")
        self.lbl_account_hint = ctk.CTkLabel(card, text="", font=T.FONT_SM, text_color=T.MUTED, justify="left")
        self.lbl_account_hint.pack(anchor="w", pady=(8, 0))
        actions = ctk.CTkFrame(card, fg_color="transparent")
        actions.pack(anchor="w", pady=(14, 0))
        ctk.CTkButton(actions, text="Refresh status", fg_color="#182230", command=self._refresh_auth_status).pack(
            side="left", padx=(0, 8)
        )
        self.btn_unlink = ctk.CTkButton(actions, text="Unlink", fg_color="#182230", command=self._unlink_account)
        self.btn_unlink.pack(side="left", padx=(0, 8))
        ctk.CTkButton(actions, text="Open web setup", fg_color="#182230", command=self._open_setup).pack(side="left")

    def _build_page_nuke(self) -> None:
        page = ctk.CTkFrame(self.content, fg_color="transparent")
        self._pages["Nuke"] = page
        ctk.CTkLabel(page, text="Nuke", font=T.FONT_LG, text_color=T.TEXT).pack(anchor="w")
        ctk.CTkLabel(page, text="OCIO-accurate batch review MP4", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(0, 16))

        c1 = self._card(page)
        ctk.CTkLabel(c1, text="Preferred Nuke executable", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w")
        row = ctk.CTkFrame(c1, fg_color="transparent")
        row.pack(fill="x", pady=(6, 0))
        row.grid_columnconfigure(0, weight=1)
        self.cmb_nuke = ctk.CTkComboBox(row, values=["(scan on Tools tab)"], fg_color=T.INPUT_BG)
        self.cmb_nuke.grid(row=0, column=0, sticky="ew")
        ctk.CTkButton(row, text="Browse", width=80, fg_color="#182230", command=self._browse_nuke).grid(row=0, column=1, padx=(8, 0))
        self.chk_interactive = ctk.CTkCheckBox(c1, text="Interactive license (-i)", font=T.FONT)
        self.chk_interactive.pack(anchor="w", pady=(14, 4))
        self.chk_safe = ctk.CTkCheckBox(c1, text="Safe mode (--safe)", font=T.FONT)
        self.chk_safe.pack(anchor="w")
        ctk.CTkLabel(c1, text="Review template (.nk)", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(12, 4))
        self.txt_template = ctk.CTkTextbox(c1, height=64, fg_color=T.INPUT_BG, border_color=T.INPUT_BORDER)
        self.txt_template.pack(fill="x")

    def _build_page_tools(self) -> None:
        page = ctk.CTkFrame(self.content, fg_color="transparent")
        self._pages["Tools"] = page
        ctk.CTkLabel(page, text="Runtime tools", font=T.FONT_LG, text_color=T.TEXT).pack(anchor="w")
        ctk.CTkLabel(page, text="Bundled with the engine installer", font=T.FONT_SM, text_color=T.MUTED).pack(anchor="w", pady=(0, 16))

        self.tools_scroll = ctk.CTkScrollableFrame(page, fg_color=T.CARD, border_color=T.CARD_BORDER, border_width=1, height=300)
        self.tools_scroll.pack(fill="both", expand=True, pady=(0, 10))
        header = ctk.CTkFrame(self.tools_scroll, fg_color="transparent")
        header.pack(fill="x", padx=8, pady=(8, 4))
        header.grid_columnconfigure(0, weight=0)
        header.grid_columnconfigure(1, weight=0)
        header.grid_columnconfigure(2, weight=1)
        for i, (text, w) in enumerate((("Tool", 100), ("Status", 72), ("Path", 400))):
            ctk.CTkLabel(header, text=text, font=("Segoe UI", 12, "bold"), text_color=T.MUTED, width=w).grid(
                row=0, column=i, sticky="w", padx=4
            )
        self.tools_rows = ctk.CTkFrame(self.tools_scroll, fg_color="transparent")
        self.tools_rows.pack(fill="both", expand=True)

        row = ctk.CTkFrame(page, fg_color="transparent")
        row.pack(fill="x")
        ctk.CTkButton(row, text="Rescan tools", fg_color="#182230", command=self._rescan).pack(side="left")
        self.lbl_scan = ctk.CTkLabel(row, text="", font=T.FONT_SM, text_color=T.MUTED)
        self.lbl_scan.pack(side="left", padx=12)

    def _show_page(self, name: str) -> None:
        for page in self._pages.values():
            page.pack_forget()
        self._pages[name].pack(fill="both", expand=True)
        for nav, btn in self._nav_buttons.items():
            if nav == name:
                btn.configure(fg_color="#152028", text_color=T.ACCENT, border_width=1, border_color=T.ACCENT)
            else:
                btn.configure(fg_color="transparent", text_color=T.MUTED, border_width=0)

    def _load_data(self) -> None:
        try:
            self.bundle = get_settings()
        except EngineApiError as exc:
            messagebox.showerror("CTrack Engine", f"Engine not reachable on port 7777.\n\n{exc}")
            self.after(100, self.destroy)
            return
        try:
            self.templates = get_templates()
        except EngineApiError:
            self.templates = []
        try:
            self.auth_status = get_auth_status()
        except EngineApiError:
            self.auth_status = {"paired": False}
        self._apply_bundle(self.bundle)
        self._render_auth_status()

    def _apply_bundle(self, bundle: Dict[str, Any]) -> None:
        tray = bundle.get("tray") or {}
        engine = bundle.get("engine") or {}
        runtime = bundle.get("runtime") or {}

        self.txt_web.delete(0, "end")
        self.txt_web.insert(0, tray.get("webUrl") or "")
        self.chk_login.select() if tray.get("launchAtLogin") else self.chk_login.deselect()
        if tray.get("notifyOnMissingTools") is False:
            self.chk_notify.deselect()
        else:
            self.chk_notify.select()

        setup = "Ready" if bundle.get("setupComplete") else "Needs configuration"
        paths = bundle.get("paths") or {}
        self.lbl_engine_status.configure(
            text=f"API: http://127.0.0.1:7777\nSetup: {setup}\nConfig: {paths.get('userDataDir', '')}"
        )

        active = runtime.get("activeExrBackend") or "none"
        nuke_n = len(engine.get("nukeInstallations") or [])
        self.lbl_backend.configure(text=f"EXR backend: {active}")
        self.lbl_nuke_count.configure(text=f"Nuke installs: {nuke_n}")
        self.lbl_active.configure(text=f"Active backend: {active}")

        self.cmb_mode.set(engine.get("transcodeMode") or "auto")
        self.lst_order.delete(0, "end")
        for item in engine.get("exrTranscodeOrder") or ["nuke", "oiio", "ffmpeg"]:
            self.lst_order.insert("end", item)

        self.selected_preset = engine.get("reviewMp4Preset") or "1080p"
        preset_label = next((k for k, v in T.MP4_PRESETS.items() if v == self.selected_preset), list(T.MP4_PRESETS.keys())[0])
        self.cmb_preset.set(preset_label)
        self.txt_width.delete(0, "end")
        self.txt_width.insert(0, str(engine.get("reviewMp4Width") or 1920))
        self.txt_height.delete(0, "end")
        self.txt_height.insert(0, str(engine.get("reviewMp4Height") or 1080))
        self._update_preset_fields()

        installs = engine.get("nukeInstallations") or []
        labels = [i.get("label") or i.get("exePath") for i in installs]
        if labels:
            self.cmb_nuke.configure(values=labels)
            preferred = engine.get("preferredNukeExe")
            idx = next((i for i, n in enumerate(installs) if n.get("exePath") == preferred), 0)
            self.cmb_nuke.set(labels[idx])
        else:
            self.cmb_nuke.configure(values=["(No Nuke found — rescan on Tools tab)"])
            self.cmb_nuke.set("(No Nuke found — rescan on Tools tab)")

        self.chk_interactive.select() if engine.get("nukeInteractive", True) else self.chk_interactive.deselect()
        self.chk_safe.select() if engine.get("nukeSafeMode", True) else self.chk_safe.deselect()
        self._apply_templates(engine)
        self.txt_template.delete("1.0", "end")
        self.txt_template.insert("1.0", self.txt_template_path.get("1.0", "end").strip() or engine.get("sampleNkTemplate") or "(not found)")

        self._render_tools(runtime)
        self.lbl_scan.configure(text=f"Last scan: {engine.get('lastToolScanAt') or 'never'}")

    def _render_tools(self, runtime: Dict[str, Any]) -> None:
        for child in self.tools_rows.winfo_children():
            child.destroy()
        tools = (runtime or {}).get("tools") or {}
        mapping = (
            ("Python", tools.get("python")),
            ("FFmpeg", tools.get("ffmpeg")),
            ("OpenImageIO", tools.get("oiiotool")),
            ("OCIO", tools.get("ocio")),
            ("Nuke", tools.get("nuke")),
            ("Template", tools.get("nukeTemplate")),
        )
        for r, (name, tool) in enumerate(mapping):
            ok = bool(tool and tool.get("available"))
            row = ctk.CTkFrame(self.tools_rows, fg_color="#121820" if r % 2 else "transparent")
            row.pack(fill="x", pady=1)
            row.grid_columnconfigure(2, weight=1)
            ctk.CTkLabel(row, text=name, width=100, anchor="w", font=T.FONT).grid(row=0, column=0, padx=8, pady=8, sticky="w")
            color = T.SUCCESS if ok else T.ERROR
            ctk.CTkLabel(row, text="Ready" if ok else "Missing", width=72, text_color=color, font=T.FONT).grid(
                row=0, column=1, padx=4, sticky="w"
            )
            path = (tool or {}).get("path") or ""
            ctk.CTkLabel(row, text=path, anchor="w", font=("Segoe UI", 11), text_color=T.MUTED).grid(
                row=0, column=2, padx=4, sticky="ew"
            )

    def _apply_templates(self, engine: Dict[str, Any]) -> None:
        template_values: List[str] = []
        template_ids: List[str] = []
        for item in self.templates:
            template_id = str(item.get("id") or "").strip()
            if not template_id:
                continue
            template_name = str(item.get("name") or template_id).strip()
            template_values.append(f"{template_name} ({template_id})")
            template_ids.append(template_id)
        if not template_values:
            template_values = ["Review MP4 (review_mp4)"]
            template_ids = ["review_mp4"]
        self.template_ids = template_ids
        self.cmb_template.configure(values=template_values)
        selected = str(engine.get("reviewTemplateId") or template_ids[0]).strip()
        if selected not in template_ids:
            selected = template_ids[0]
        self.selected_template_id = selected
        selected_idx = template_ids.index(selected)
        self.cmb_template.set(template_values[selected_idx])
        self._on_template_change(template_values[selected_idx])

    def _refresh_templates(self) -> None:
        try:
            self.templates = get_templates()
            engine = (self.bundle or {}).get("engine") or {}
            self._apply_templates(engine)
        except EngineApiError as exc:
            messagebox.showerror("CTrack Engine", str(exc))

    def _get_user_templates_dir(self) -> Optional[str]:
        user_data_dir = (self.bundle or {}).get("paths", {}).get("userDataDir")
        if not user_data_dir:
            return None
        return str(Path(user_data_dir) / "templates")

    def _import_template_file(self) -> None:
        selected_path = filedialog.askopenfilename(title="Import Nuke template", filetypes=[("Nuke Template", "*.nk")])
        if not selected_path:
            return
        try:
            with open(selected_path, "rb") as handle:
                encoded = base64.b64encode(handle.read()).decode("ascii")
            import_template(file_name=Path(selected_path).name, file_content_base64=encoded, category="review")
            self._refresh_templates()
            messagebox.showinfo("CTrack Engine", "Template imported.")
        except (OSError, EngineApiError) as exc:
            messagebox.showerror("CTrack Engine", f"Template import failed.\n\n{exc}")

    def _open_templates_folder(self) -> None:
        templates_dir = self._get_user_templates_dir()
        if not templates_dir:
            messagebox.showwarning("CTrack Engine", "Templates folder is not available yet.")
            return
        try:
            os.makedirs(templates_dir, exist_ok=True)
            os.startfile(templates_dir)
        except OSError as exc:
            messagebox.showerror("CTrack Engine", f"Unable to open templates folder.\n\n{exc}")

    def _push_templates_to_studio(self) -> None:
        target_dir = self.txt_push_templates_dir.get().strip()
        if not target_dir:
            messagebox.showwarning("CTrack Engine", "Enter a studio target folder first.")
            return
        try:
            result = push_templates(target_dir=target_dir)
            copied = int(result.get("copiedNkFiles") or 0)
            merged = int(result.get("mergedTemplates") or 0)
            messagebox.showinfo(
                "CTrack Engine",
                f"Templates pushed.\n\nCopied .nk files: {copied}\nRegistry templates: {merged}",
            )
        except EngineApiError as exc:
            messagebox.showerror("CTrack Engine", f"Template push failed.\n\n{exc}")

    def _on_template_change(self, choice: str) -> None:
        if not self.template_ids:
            self.selected_template_id = "review_mp4"
            return
        selected_id = None
        for index, template_id in enumerate(self.template_ids):
            if index < len(self.cmb_template.cget("values")) and self.cmb_template.cget("values")[index] == choice:
                selected_id = template_id
                break
        self.selected_template_id = selected_id or self.template_ids[0]
        selected_template = next((item for item in self.templates if item.get("id") == self.selected_template_id), None)
        selected_path = ""
        if isinstance(selected_template, dict):
            selected_path = str(selected_template.get("path") or "")
        self.txt_template_path.delete("1.0", "end")
        self.txt_template_path.insert("1.0", selected_path or "(not found)")

    def _on_preset_change(self, choice: str) -> None:
        self.selected_preset = T.MP4_PRESETS.get(choice, "1080p")
        self._update_preset_fields()

    def _update_preset_fields(self) -> None:
        custom = self.selected_preset == "custom"
        state = "normal" if custom else "disabled"
        self.txt_width.configure(state=state)
        self.txt_height.configure(state=state)
        if not custom and self.selected_preset in T.PRESET_DIMS:
            w, h = T.PRESET_DIMS[self.selected_preset]
            self.txt_width.delete(0, "end")
            self.txt_width.insert(0, str(w))
            self.txt_height.delete(0, "end")
            self.txt_height.insert(0, str(h))

    def _move_order(self, delta: int) -> None:
        sel = self.lst_order.curselection()
        if not sel:
            return
        i = sel[0]
        j = i + delta
        if j < 0 or j >= self.lst_order.size():
            return
        items = list(self.lst_order.get(0, "end"))
        items[i], items[j] = items[j], items[i]
        self.lst_order.delete(0, "end")
        for item in items:
            self.lst_order.insert("end", item)
        self.lst_order.selection_set(j)

    def _browse_nuke(self) -> None:
        path = filedialog.askopenfilename(title="Select Nuke executable", filetypes=[("Nuke", "Nuke*.exe"), ("EXE", "*.exe")])
        if path:
            self.custom_nuke = path
            label = f"(Custom) {Path(path).name}"
            self.cmb_nuke.configure(values=[label])
            self.cmb_nuke.set(label)

    def _open_config(self) -> None:
        path = (self.bundle or {}).get("paths", {}).get("userDataDir")
        if not path:
            messagebox.showwarning("CTrack Engine", "Config folder is not available yet.")
            return
        try:
            os.startfile(path)
        except OSError as exc:
            messagebox.showerror("CTrack Engine", f"Unable to open config folder.\n\n{exc}")

    def _open_setup(self) -> None:
        base_url = self.txt_web.get().strip().rstrip("/")
        if not base_url:
            base_url = "https://ctrackpublishweb.vercel.app"
        url = base_url + "/setup"
        import webbrowser

        webbrowser.open(url)

    def _rescan(self) -> None:
        try:
            rescan_tools()
            self.bundle = get_settings()
            self._apply_bundle(self.bundle)
            messagebox.showinfo("CTrack Engine", "Rescan complete.")
        except EngineApiError as exc:
            messagebox.showerror("CTrack Engine", str(exc))

    def _save(self) -> None:
        if not self.bundle:
            return
        try:
            width = int(self.txt_width.get() or 1920)
            height = int(self.txt_height.get() or 1080)
        except ValueError:
            messagebox.showerror("CTrack Engine", "MP4 width and height must be valid integers.")
            return
        if width <= 0 or height <= 0:
            messagebox.showerror("CTrack Engine", "MP4 width and height must be greater than zero.")
            return
        order = list(self.lst_order.get(0, "end"))
        preferred = self.custom_nuke
        if not preferred:
            installs = (self.bundle.get("engine") or {}).get("nukeInstallations") or []
            labels = [i.get("label") or i.get("exePath") for i in installs]
            sel = self.cmb_nuke.get()
            if sel in labels:
                preferred = installs[labels.index(sel)].get("exePath")

        engine_patch = {
            "preferredNukeExe": preferred,
            "exrTranscodeOrder": order,
            "nukeInteractive": bool(self.chk_interactive.get()),
            "nukeSafeMode": bool(self.chk_safe.get()),
            "transcodeMode": self.cmb_mode.get(),
            "reviewMp4Preset": self.selected_preset,
            "reviewMp4Width": width,
            "reviewMp4Height": height,
            "reviewTemplateId": self.selected_template_id or "review_mp4",
        }
        tray_patch = {
            "webUrl": self.txt_web.get().strip(),
            "launchAtLogin": bool(self.chk_login.get()),
            "notifyOnMissingTools": bool(self.chk_notify.get()),
        }
        try:
            self.bundle = patch_settings(engine_patch, tray_patch)
            self._set_launch_at_login(bool(self.chk_login.get()))
            messagebox.showinfo("CTrack Engine", "Settings saved.")
            self.destroy()
        except EngineApiError as exc:
            messagebox.showerror("CTrack Engine", str(exc))

    def _refresh_auth_status(self) -> None:
        try:
            self.auth_status = get_auth_status()
            self._render_auth_status()
        except EngineApiError as exc:
            messagebox.showerror("CTrack Engine", str(exc))

    def _render_auth_status(self) -> None:
        paired = bool((self.auth_status or {}).get("paired"))
        if paired:
            email = str((self.auth_status or {}).get("email") or "").strip()
            device_id = str((self.auth_status or {}).get("deviceId") or "").strip()
            email_line = email if email else "paired account"
            device_line = device_id if device_id else "(unknown)"
            self.lbl_account_state.configure(text=f"Linked as: {email_line}\nDevice ID: {device_line}", text_color=T.SUCCESS)
            self.lbl_account_hint.configure(text="Auto-update can download installers with your device credential.")
            self.btn_unlink.configure(state="normal")
            return
        self.lbl_account_state.configure(text="Not linked", text_color=T.ERROR)
        self.lbl_account_hint.configure(
            text="Open web setup and link this workstation to enable authenticated downloads and auto-updates."
        )
        self.btn_unlink.configure(state="disabled")

    def _unlink_account(self) -> None:
        try:
            unpair_account()
            self._refresh_auth_status()
            messagebox.showinfo("CTrack Engine", "This workstation has been unlinked.")
        except EngineApiError as exc:
            messagebox.showerror("CTrack Engine", f"Unable to unlink workstation.\n\n{exc}")

    def _set_launch_at_login(self, enabled: bool) -> None:
        set_launch_at_login(enabled, get_tray_bat(self.install_root))


def main() -> None:
    ensure_gui_path()
    parser = argparse.ArgumentParser(description="CTrack Engine settings")
    parser.add_argument("--install-root", default=None)
    parser.add_argument("--page", default="General")
    parser.add_argument("--from-tray", action="store_true")
    args = parser.parse_args()
    app = SettingsWindow(
        install_root=args.install_root,
        initial_page=args.page,
        animate_from_tray=args.from_tray,
    )
    app.mainloop()


if __name__ == "__main__":
    main()
