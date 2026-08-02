# ctrack_nuke

Nuke plugin package for connecting to CTrack Engine at `http://127.0.0.1:7777`.

## Package structure

```text
ctrack_nuke/
├── init.py
├── menu.py
├── api_client.py
├── install/install.bat
├── install/README.md
└── README.md
```

## Features

- Adds **CTrack** menu in Nuke with:
  - **Engine Status**: calls `GET /health` and `GET /api/engine/status`.
  - **Open Engine Settings**: calls `POST /api/gui/open` and falls back to `POST /api/engine/rescan`.
  - **Publish to CTrack**:
    - Checks engine health (`GET /health`).
    - Uses selected **Write** node, or asks you to choose one from script Write nodes.
    - Resolves the output path from `Write.file` using first frame expansion.
    - Enqueues publish via `POST /api/publish/enqueue` with metadata and `auto_process=true`.
    - Shows returned job id and status in a Nuke dialog.
- Uses standard-library HTTP client (`urllib`) only; no external dependencies.

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
