"""
Run inside Nuke terminal mode (-t): Read -> OCIOColorSpace -> Write.

Uses Nuke's own OCIO config and menu colorspace names (no external .ocio required).

Environment:
  CTRACK_EXR_PATTERN, CTRACK_FRAME_START, CTRACK_FRAME_END, CTRACK_OUTPUT_MP4
  CTRACK_IN_COLORSPACE   default: ACES - ACEScg
  CTRACK_OUT_COLORSPACE  default: Output - sRGB
  CTRACK_FPS             default: 24
"""

from __future__ import print_function

import os
import sys


def _env(name, default=None):
    value = os.environ.get(name, default)
    if value is None or value == "":
        return default
    return value


def _env_int(name, default):
    raw = _env(name)
    if raw is None:
        return default
    return int(raw)


def _menu_entries(knob):
    """Normalize Nuke enum entries (handles 'internal\\tlabel' pairs)."""
    entries = []
    for item in knob.values():
        text = str(item)
        key = text.split("\t")[0].strip() if "\t" in text else text.strip()
        if key:
            entries.append((key, text))
    return entries


def _set_from_menu(node, knob_name, preferred, fallbacks, keywords=()):
    """Pick a value from a Nuke enum knob menu."""
    knob = node[knob_name]
    entries = _menu_entries(knob)
    keys = {k: v for k, v in entries}

    for candidate in [preferred] + list(fallbacks):
        if candidate in keys:
            knob.setValue(keys[candidate])
            return candidate
        cl = candidate.lower()
        for key, val in entries:
            if cl in key.lower() or key.lower() in cl:
                knob.setValue(val)
                return key

    for word in keywords:
        wl = word.lower()
        for key, val in entries:
            if wl in key.lower():
                knob.setValue(val)
                return key

    sample = [k for k, _ in entries[:12]]
    raise RuntimeError(
        "No match for {}.{} (wanted {!r}); menu sample: {}".format(
            node.name(), knob_name, preferred, sample
        )
    )


def _configure_write(write, output_path, fps):
    """Use Nuke's built-in movie writer (HEVC for large 6K plates)."""
    path = output_path.replace("\\", "/")
    write["file"].setValue(path)

    if path.lower().endswith(".mp4"):
        base, _ = os.path.splitext(path)
        path = base + ".mov"
        write["file"].setValue(path)

    write["file_type"].setValue("mov")
    codec = _set_from_menu(
        write,
        "mov64_codec",
        "h265",
        ["hevc", "H.265", "h264", "avc1"],
        keywords=("h265", "hevc", "h264"),
    )
    for fps_knob in ("mov64_fps", "fps", "meta_fps"):
        try:
            write[fps_knob].setValue(fps)
            break
        except Exception:
            continue
    return path, codec


def _enable_nuke_ocio():
    """Use Nuke's shipped OCIO config (Foundry ACES cg-config), not external downloads."""
    import nuke

    root = nuke.root()
    for knob_name, value in (("colorManagement", "OCIO"), ("colourManagement", "OCIO")):
        try:
            root[knob_name].setValue(value)
            break
        except Exception:
            continue

    nuke_dir = os.environ.get("NUKE_PATH") or r"C:\Program Files\Nuke15.1v4"
    shipped = os.path.join(
        nuke_dir,
        "plugins",
        "OCIOConfigs",
        "configs",
        "fn-nuke_cg-config-v1.0.0_aces-v1.3_ocio-v2.1.ocio",
    )
    if not os.path.isfile(shipped):
        for candidate in (
            r"C:\Program Files\Nuke15.1v4\plugins\OCIOConfigs\configs\fn-nuke_cg-config-v1.0.0_aces-v1.3_ocio-v2.1.ocio",
            r"C:\Program Files\Nuke13.2v5\plugins\OCIOConfigs\configs\fn-nuke_cg-config-v1.0.0_aces-v1.3_ocio-v2.1.ocio",
        ):
            if os.path.isfile(candidate):
                shipped = candidate
                break

    if os.path.isfile(shipped):
        path = shipped.replace("\\", "/")
        try:
            root["OCIO_config"].setValue(path)
        except Exception:
            pass
        print("[nuke] OCIO_config:", path, flush=True)
    else:
        print("[nuke] OCIO_config: nuke-default (shipped ACES config not found)", flush=True)


def main():
    import nuke

    _enable_nuke_ocio()

    pattern = _env("CTRACK_EXR_PATTERN")
    if not pattern:
        print("[nuke] CTRACK_EXR_PATTERN is required", file=sys.stderr)
        sys.exit(2)

    frame_start = _env_int("CTRACK_FRAME_START", 1001)
    frame_end = _env_int("CTRACK_FRAME_END", frame_start)
    output_mp4 = _env("CTRACK_OUTPUT_MP4")
    if not output_mp4:
        print("[nuke] CTRACK_OUTPUT_MP4 is required", file=sys.stderr)
        sys.exit(2)

    in_pref = _env("CTRACK_IN_COLORSPACE", "ACES - ACEScg")
    out_pref = _env("CTRACK_OUT_COLORSPACE", "Output - sRGB")
    fps = float(_env("CTRACK_FPS", "24"))

    nuke.scriptClear()

    read = nuke.nodes.Read()
    read["file"].setValue(pattern.replace("\\", "/"))
    read["first"].setValue(frame_start)
    read["last"].setValue(frame_end)
    read["origfirst"].setValue(frame_start)
    read["origlast"].setValue(frame_end)
    try:
        read["raw"].setValue(True)
    except Exception:
        pass

    ocs = nuke.createNode("OCIOColorSpace")
    ocs.setInput(0, read)
    in_cs = _set_from_menu(
        ocs,
        "in_colorspace",
        in_pref,
        ["ACES - ACEScg", "ACEScg", "scene_linear", "linear"],
        keywords=("acescg", "aces"),
    )
    out_cs = _set_from_menu(
        ocs,
        "out_colorspace",
        out_pref,
        ["Output - sRGB", "sRGB", "Output - Rec.709"],
        keywords=("srgb", "rec.709", "display"),
    )
    print("[nuke] OCIOColorSpace: {} -> {}".format(in_cs, out_cs), flush=True)

    write = nuke.nodes.Write()
    write.setInput(0, ocs)
    mov_path, codec = _configure_write(write, output_mp4, fps)
    os.makedirs(os.path.dirname(os.path.abspath(output_mp4)) or ".", exist_ok=True)

    print(
        "[nuke] Rendering {}-{} codec={} -> {}".format(
            frame_start, frame_end, codec, mov_path
        ),
        flush=True,
    )
    nuke.execute(write, frame_start, frame_end)

    if not os.path.isfile(mov_path):
        print("[nuke] Output missing:", mov_path, file=sys.stderr)
        sys.exit(4)

    if mov_path != output_mp4.replace("\\", "/") and not os.path.isfile(output_mp4):
        print("[nuke] Wrote", mov_path, "(requested .mp4; use .mov or rename)", flush=True)

    print("[nuke] Done:", mov_path, os.path.getsize(mov_path), "bytes", flush=True)


if __name__ == "__main__":
    main()
