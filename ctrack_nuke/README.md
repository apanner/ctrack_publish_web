# ctrack_nuke

Nuke plugin package for connecting to CTrack Engine at `http://127.0.0.1:7777`.

## Package structure

```text
ctrack_nuke/
├── init.py
├── menu.py
├── api_client.py
├── installer/CTrackNuke.iss
├── installer/build-installer.bat
├── install/install.bat
├── install/README.md
└── README.md
```

## Features

- Adds **CTrack** menu in Nuke with:
  - **Publish Write**: enqueues the selected Write node output via `POST /api/publish/enqueue` (no blocking dialogs).
  - **Open Engine**: opens the engine console, or the sign-in card if the workstation is not paired.
  - **Settings…**: opens engine settings via `POST /api/gui/open`.
- Uses standard-library HTTP client (`urllib`) only; no external dependencies.

> For full workstation GUI details (tray, sign-in, settings), see [`ctrack_publish_web/docs/DEVELOPMENT_STATUS.md`](../ctrack_publish_web/docs/DEVELOPMENT_STATUS.md).

## Requirements

- Nuke 13+ (Python 3 target).
- CTrack Engine running locally at `http://127.0.0.1:7777`.

## Install (Windows)

### Option A: Inno Setup installer (recommended)

1. Build installer:

```bat
cd /d D:\dev\track\ctrack_nuke\installer
build-installer.bat
```

2. Run generated setup:

```bat
D:\dev\track\ctrack_nuke\installer\output\CTrackNuke-Setup.exe
```

3. In setup:
- Use default install path `%USERPROFILE%\.nuke\ctrack` or choose a custom path.
- Optionally enable `Append nuke.pluginAddPath...` task to auto-update `%USERPROFILE%\.nuke\init.py` (backup is created automatically).

4. Restart Nuke.

### Option B: manual copy script (legacy)

```bat
cd /d D:\dev\track\ctrack_nuke\install
install.bat
```

Then ensure `%USERPROFILE%\.nuke\init.py` includes:

```python
import nuke
nuke.pluginAddPath(r"C:\Users\<you>\.nuke\ctrack")
```

## Usage in Nuke

After restart, use top menu: **Nuke -> CTrack**

- **Engine Status**
  - Shows `health` and `engine/status` responses in a message dialog.
- **Open Engine Settings**
  - Tries to open engine GUI endpoint, otherwise requests a rescan fallback.
- **Publish to CTrack**
  - Requires CTrack Engine to be running and reachable.
  - Select a **Write** node first for best results. If none is selected, plugin prompts for one.
  - Plugin sends:
    - `file_path`: resolved first-frame file path (or output directory when sequence token remains)
    - `meta`:
      - `tab: "version"`
      - `source: "nuke"`
      - `script`: `nuke.scriptName()`
      - `write_node`: selected write node name
    - `auto_process: true`
  - Publish endpoints used:
    - `POST /api/publish/enqueue`
    - `GET /api/publish/jobs`
    - `POST /api/publish/process-next`
