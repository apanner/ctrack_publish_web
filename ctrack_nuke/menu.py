from __future__ import print_function

import os
import re
import time
import webbrowser

import nuke

from api_client import DEFAULT_BASE_URL, EngineClient


def add_menu():
    menu_bar = nuke.menu("Nuke")
    ctrack_menu = menu_bar.addMenu("CTrack")
    ctrack_menu.addCommand("Publish Write", publish_write_minimal)
    ctrack_menu.addCommand("Open Engine", open_engine_gui)
    ctrack_menu.addSeparator()
    ctrack_menu.addCommand("Settings...", open_engine_settings)


def publish_write_minimal():
    client = EngineClient(base_url=DEFAULT_BASE_URL)
    if not client.ensure_running():
        _print_status("CTrack: engine not running (start tray from Windows Start menu)")
        return

    write_node = _resolve_write_node()
    if write_node is None:
        _print_status("CTrack: no Write node found")
        return

    publish_path = _resolve_publish_path(write_node)
    if not publish_path:
        _print_status("CTrack: could not resolve path from Write '%s'" % write_node.name())
        return

    metadata = {
        "tab": "version",
        "source": "nuke",
        "script": nuke.scriptName(),
        "write_node": write_node.name(),
    }
    response = client.enqueue_publish(
        file_path=publish_path,
        meta=metadata,
        auto_process=True,
    )
    if not response.get("ok"):
        _print_status("CTrack publish failed: %s" % response.get("error", "unknown error"))
        return

    payload = response.get("data") or {}
    job_payload = payload.get("job") if isinstance(payload.get("job"), dict) else payload
    job_id = job_payload.get("id") or job_payload.get("job_id") or payload.get("job_id")
    status = job_payload.get("status") or payload.get("status") or "queued"
    _print_status("CTrack publish %s  job=%s  path=%s" % (status, (job_id or "?")[:8], publish_path))


def open_engine_gui():
    client = EngineClient(base_url=DEFAULT_BASE_URL)
    client.ensure_running()
    response = client.open_gui(panel="logs")
    if response.get("ok"):
        _print_status("CTrack: opened engine console")
        return
    _print_status("CTrack: could not open engine - %s" % response.get("error", "unknown error"))


def open_engine_settings():
    client = EngineClient(base_url=DEFAULT_BASE_URL)
    client.ensure_running()
    response = client.open_gui(panel="settings")
    if response.get("ok"):
        _print_status("CTrack: opened engine settings")
        return
    _print_status("CTrack: could not open settings - %s" % response.get("error", "unknown error"))


def _print_status(message):
    try:
        nuke.tprint(message)
    except Exception:
        print(message)


def _resolve_write_node():
    selected = _get_selected_write_node()
    if selected is not None:
        return selected
    write_nodes = nuke.allNodes("Write")
    if not write_nodes:
        return None
    if len(write_nodes) == 1:
        return write_nodes[0]
    for node in write_nodes:
        if node["disable"].value() == 0:
            return node
    return write_nodes[0]


def _get_selected_write_node():
    try:
        selected_node = nuke.selectedNode()
    except Exception:
        return None
    if selected_node.Class() == "Write":
        return selected_node
    return None


def _resolve_publish_path(write_node):
    try:
        file_knob = write_node["file"]
    except Exception:
        return None

    raw_path = ""
    for resolver in (file_knob.evaluate, file_knob.value):
        try:
            raw_path = resolver()
        except Exception:
            continue
        if raw_path:
            break

    if not raw_path:
        return None

    first_frame = _get_first_frame()
    if first_frame is None:
        return raw_path

    expanded_path = _expand_write_path(write_node, raw_path, first_frame)
    if _has_frame_token(expanded_path):
        return os.path.dirname(expanded_path)
    return expanded_path


def _get_first_frame():
    try:
        return int(nuke.root()["first_frame"].value())
    except Exception:
        return None


def _expand_write_path(write_node, raw_path, frame_number):
    try:
        filename_for_frame = nuke.filename(write_node, frame_number)
        if filename_for_frame:
            return filename_for_frame
    except Exception:
        pass

    padded_frame_text = str(int(frame_number))
    hash_pattern = re.compile(r"(#+)")

    def replace_hash(match_obj):
        width = len(match_obj.group(1))
        return str(int(frame_number)).zfill(width)

    expanded_path = hash_pattern.sub(replace_hash, raw_path)
    expanded_path = re.sub(r"%0(\d+)d", lambda m: padded_frame_text.zfill(int(m.group(1))), expanded_path)
    expanded_path = re.sub(r"%d", padded_frame_text, expanded_path)
    return expanded_path


def _has_frame_token(path_text):
    if not path_text:
        return False
    if "#" in path_text:
        return True
    if re.search(r"%0?\d*d", path_text):
        return True
    return False
