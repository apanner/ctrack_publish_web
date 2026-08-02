# CTrack Nuke Plugin Installer (Windows)

This installer copies the plugin package into your Nuke plugin location.

## Quick install

1. Open Command Prompt.
2. Run:

```bat
cd /d D:\dev\track\ctrack_nuke\install
install.bat
```

3. Press Enter to use the default path:

```
%USERPROFILE%\.nuke\ctrack
```

Or enter a custom plugin path.

## After install

Make sure your `%USERPROFILE%\.nuke\init.py` contains:

```python
import nuke
nuke.pluginAddPath(r"C:\Users\<you>\.nuke\ctrack")
```

Then restart Nuke.

## Notes

- Target runtime: Nuke 13+ (Python 3).
- The plugin is pure Python and keeps compatibility considerations for Python 2/3 where practical.
- CTrack Engine must be running at `http://127.0.0.1:7777`.
