from __future__ import print_function

import json
import os
import re

import nuke

from api_client import DEFAULT_BASE_URL, EngineClient


def add_menu():
    menu_bar = nuke.menu("Nuke")
    ctrack_menu = menu_bar.addMenu("CTrack")
    ctrack_menu.addCommand("Engine Status", check_engine_status)
    ctrack_menu.addCommand("Open Engine Settings", open_engine_settings)
    ctrack_menu.addSeparator()
    ctrack_menu.addCommand("Publish to CTrack", publish_to_ctrack)


def check_engine_status():
    client = EngineClient(base_url=DEFAULT_BASE_URL)
    health_response = client.health()
    status_response = client.status()

    message_lines = [
        "CTrack Engine: %s" % client.base_url,
        "",
        "GET /health",
        _format_response(health_response),
        "",
        "GET /api/engine/status",
        _format_response(status_response),
    ]
    nuke.message("\n".join(message_lines))


def open_engine_settings():
    client = EngineClient(base_url=DEFAULT_BASE_URL)
    response = client.open_gui_with_fallback()

    if response.get("ok"):
        if response.get("fallback_used"):
            message = (
                "Requested settings fallback (POST /api/engine/rescan).\n"
                "Primary /api/gui/open failed: %s"
            ) % response.get("primary_error", "unknown error")
        else:
            message = "Requested engine settings via POST /api/gui/open."
        nuke.message(message)
        return

    error_text = response.get("error", "unknown error")
    nuke.message(
        "Could not open engine settings.\n"
        "Engine URL: %s\n"
        "Error: %s\n\n"
        "Make sure CTrack Engine is running."
        % (client.base_url, error_text)
    )


def publish_to_ctrack():
    client = EngineClient(base_url=DEFAULT_BASE_URL)
    health_response = client.health()
    if not health_response.get("ok"):
        nuke.message(
            "CTrack Engine is unavailable.\n"
            "Engine URL: %s\n"
            "Error: %s"
            % (client.base_url, health_response.get("error", "unknown error"))
        )
        return

    write_node = _choose_write_node()
    if write_node is None:
        return

    publish_path = _resolve_publish_path(write_node)
    if not publish_path:
        nuke.message(
            "Could not resolve a publish path from Write node '%s'.\n"
            "Set a valid value in the file knob first."
            % write_node.name()
        )
        return

    metadata = {
        "tab": "version",
        "source": "nuke",
        "script": nuke.scriptName(),
        "write_node": write_node.name(),
    }
    enqueue_response = client.enqueue_publish(
        file_path=publish_path,
        meta=metadata,
        auto_process=True,
    )

    if not enqueue_response.get("ok"):
        nuke.message(
            "Failed to enqueue publish.\n"
            "Error: %s"
            % enqueue_response.get("error", "unknown error")
        )
        return

    payload = enqueue_response.get("data") or {}
    job_payload = payload.get("job") if isinstance(payload.get("job"), dict) else payload
    job_id = job_payload.get("id") or job_payload.get("job_id") or payload.get("job_id")
    status = job_payload.get("status") or payload.get("status") or "queued"
    nuke.message(
        "Publish queued in CTrack.\n"
        "Job ID: %s\n"
        "Status: %s"
        % (job_id or "unknown", status)
    )


def _choose_write_node():
    selected_write_node = _get_selected_write_node()
    if selected_write_node is not None:
        return selected_write_node

    write_nodes = nuke.allNodes("Write")
    if not write_nodes:
        nuke.message("No Write nodes found in this script.")
        return None

    if len(write_nodes) == 1:
        return write_nodes[0]

    panel = nuke.Panel("Select Write Node")
    write_node_names = [node.name() for node in write_nodes]
    panel.addEnumerationPulldown("Write node", " ".join(write_node_names))
    if not panel.show():
        return None

    selected_name = panel.value("Write node")
    for node in write_nodes:
        if node.name() == selected_name:
            return node
    return None


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


def _format_response(response):
    if not response.get("ok"):
        return "ERROR: %s" % response.get("error", "unknown error")

    status_code = response.get("status_code")
    payload = response.get("data")
    if payload is None:
        payload = response.get("raw", "")

    if isinstance(payload, (dict, list)):
        payload_text = json.dumps(payload, indent=2, sort_keys=True)
    else:
        payload_text = str(payload).strip() or "<empty>"

    return "OK (%s)\n%s" % (status_code, payload_text)
