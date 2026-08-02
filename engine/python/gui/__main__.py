"""Entry: python -m gui [--panel tray|settings|logs]"""

from __future__ import annotations

import argparse
import sys

from gui.paths import ensure_gui_path


def main() -> None:
    ensure_gui_path()
    parser = argparse.ArgumentParser(description="CTrack Engine GUI")
    parser.add_argument("--install-root", default=None)
    parser.add_argument("--panel", choices=("tray", "settings", "logs"), default="tray")
    args, _unknown = parser.parse_known_args()

    if args.panel == "settings":
        from gui.settings_window import SettingsWindow

        app = SettingsWindow(install_root=args.install_root)
        app.mainloop()
        return

    if args.panel == "logs":
        from gui.engine_window import EngineWindow

        app = EngineWindow(install_root=args.install_root)
        app.mainloop()
        return

    from gui.tray_app import main as tray_main

    if args.install_root:
        sys.argv = [sys.argv[0], "--install-root", args.install_root]
    tray_main()


if __name__ == "__main__":
    main()
