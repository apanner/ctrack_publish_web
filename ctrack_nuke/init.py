from __future__ import print_function

import traceback


def _register_ctrack_menu():
    import menu as ctrack_menu

    ctrack_menu.add_menu()


try:
    _register_ctrack_menu()
except Exception:
    try:
        import nuke

        nuke.tprint("[CTrack] Failed to register menu.")
        nuke.tprint(traceback.format_exc())
    except Exception:
        pass
