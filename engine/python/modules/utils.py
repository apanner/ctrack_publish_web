import os
import re
import subprocess
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple


def _engine_root() -> Path:
    modules_dir = Path(__file__).resolve().parent
    return modules_dir.parent.parent


def get_ffmpeg_path():
    """
    Finds the ffmpeg executable.
    1. Checks for bundled release FFmpeg in runtime/ffmpeg.
    2. Checks for embedded FFmpeg in resources/bin.
    2. Checks if 'ffmpeg' is in the system PATH.
    3. Checks if 'static-ffmpeg' is installed.
    4. Checks common installation paths on Windows.
    """
    # 1. Check for embedded version (Preferred)
    try:
        # From d:\dev\track\ctrack_publish\python\modules\utils.py 
        # to d:\dev\track\ctrack_publish\resources\bin\ffmpeg.exe
        modules_dir = os.path.dirname(os.path.abspath(__file__))
        python_dir = os.path.dirname(modules_dir)
        project_root = os.path.dirname(python_dir)
        
        bundled_candidates = [
            os.path.join(project_root, "runtime", "ffmpeg", "ffmpeg.exe"),
            os.path.join(project_root, "resources", "bin", "ffmpeg.exe"),
        ]
        for local_ffmpeg in bundled_candidates:
            if os.path.exists(local_ffmpeg):
                return local_ffmpeg
    except Exception:
        pass

    # 2. Check if it's already in PATH
    ffmpeg_in_path = shutil.which('ffmpeg')
    if ffmpeg_in_path:
        return 'ffmpeg'

    # 2. Check for static-ffmpeg (Python package that provides binaries)
    try:
        from static_ffmpeg import run
        # This returns the path to the ffmpeg executable provided by the package
        path, _ = run.get_or_fetch_platform_executables_else_raise()
        if path and os.path.exists(path):
            return path
    except (ImportError, Exception):
        pass

    # 3. Common Windows paths
    if os.name == 'nt':
        common_paths = [
            "C:/ffmpeg/bin/ffmpeg.exe",
            "C:/Program Files/ffmpeg/bin/ffmpeg.exe",
            "C:/Program Files (x86)/ffmpeg/bin/ffmpeg.exe"
        ]
        for p in common_paths:
            if os.path.exists(p):
                return p

    # Fallback to 'ffmpeg' and let it fail if not found
    return 'ffmpeg'


def get_oiiotool_path() -> str:
    """
    Finds oiiotool executable.
    1. engine/runtime/oiio/oiiotool.exe (bundled)
    2. PATH
    """
    root = _engine_root()
    bundled = [
        root / "runtime" / "oiio" / "oiiotool.exe",
        root / "runtime" / "oiio" / "bin" / "oiiotool.exe",
    ]
    for candidate in bundled:
        if candidate.is_file():
            return str(candidate)
    which = shutil.which("oiiotool")
    if which:
        return which
    return "oiiotool"


def get_oiio_runtime_dir() -> Optional[Path]:
    root = _engine_root()
    for sub in ("runtime/oiio",):
        path = root / sub.replace("/", os.sep)
        if (path / "oiiotool.exe").is_file() or path.is_dir():
            return path
    tool = Path(get_oiiotool_path())
    if tool.is_file():
        return tool.parent
    return None


def _resolve_engine_path(path: str) -> str:
    if not path:
        return path
    expanded = os.path.expandvars(os.path.expanduser(path.strip()))
    if os.path.isabs(expanded) and os.path.isfile(expanded):
        return expanded
    root = _engine_root()
    rel = os.path.join(root, expanded.replace("/", os.sep))
    if os.path.isfile(rel):
        return rel
    return expanded


def get_ocio_config_path(explicit: Optional[str] = None) -> Optional[str]:
    """
    OCIO config for EXR review (matches Nuke sample.nk aces_1.2 when available).
    """
    if explicit:
        resolved = _resolve_engine_path(explicit)
        if os.path.isfile(resolved):
            return resolved
    env_path = os.environ.get("CTRACK_OCIO_CONFIG") or os.environ.get("OCIO")
    if env_path:
        resolved = _resolve_engine_path(env_path)
        if os.path.isfile(resolved):
            return resolved

    root = _engine_root()
    bundled = [
        root / "runtime" / "ocio" / "aces_1.2" / "config.ocio",
        root / "runtime" / "ocio" / "cg-config-v1.0.0_aces-v1.3_ocio-v2.1.ocio",
        root / "runtime" / "ocio" / "fn-nuke_cg-config-v1.0.0_aces-v1.3_ocio-v2.1.ocio",
    ]
    for path in bundled:
        if path.is_file():
            return str(path)

    if os.name == "nt":
        nuke_aces = r"C:\Program Files\Nuke15.1v4\plugins\OCIOConfigs\configs\aces_1.2\config.ocio"
        if os.path.isfile(nuke_aces):
            return nuke_aces
        fn_cg = r"C:\Program Files\Nuke15.1v4\plugins\OCIOConfigs\configs\fn-nuke_cg-config-v1.0.0_aces-v1.3_ocio-v2.1.ocio"
        if os.path.isfile(fn_cg):
            return fn_cg
    return None


def _oiio_env(ocio_config: Optional[str] = None) -> Dict[str, str]:
    env = os.environ.copy()
    oiio_dir = get_oiio_runtime_dir()
    if oiio_dir:
        extra = [str(oiio_dir), str(oiio_dir / "bin")]
        env["PATH"] = os.pathsep.join(extra + [env.get("PATH", "")])
    ocio = get_ocio_config_path(ocio_config)
    if ocio:
        env["OCIO"] = ocio
    return env


def run_oiiotool(
    cmd_args: List[str],
    log_callback=None,
    ocio_config: Optional[str] = None,
) -> Tuple[int, str, str]:
    """Run oiiotool with bundled DLL path and OCIO config."""
    exe = get_oiiotool_path()
    full_cmd = [exe] + cmd_args
    process = subprocess.Popen(
        full_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
        bufsize=1,
        env=_oiio_env(ocio_config),
    )
    stderr_lines: List[str] = []
    while True:
        line = process.stderr.readline()
        if not line:
            break
        stderr_lines.append(line)
        if log_callback:
            stripped = line.strip()
            if stripped:
                log_callback(stripped)
    process.wait()
    stdout, rest = process.communicate()
    if rest:
        stderr_lines.append(rest)
    return process.returncode, stdout or "", "".join(stderr_lines)


def get_threads_for_parallel():
    """Returns thread count for FFmpeg when running 2 processes in parallel (~50% CPU each)."""
    n = os.cpu_count() or 4
    return max(1, n // 2)

def run_ffmpeg(cmd_args, log_callback=None):
    """
    Runs an ffmpeg command. If log_callback is provided, it's called with stderr lines.
    Deduplicates frame= progress lines (FFmpeg often logs same frame twice) — only log when frame number changes.
    """
    ffmpeg_exe = get_ffmpeg_path()
    full_cmd = [ffmpeg_exe] + cmd_args
    
    process = subprocess.Popen(
        full_cmd, 
        stdout=subprocess.PIPE, 
        stderr=subprocess.PIPE, 
        universal_newlines=True,
        bufsize=1
    )
    
    stderr_full = []
    last_frame = -1
    frame_re = re.compile(r'frame=\s*(\d+)')
    
    while True:
        line = process.stderr.readline()
        if not line:
            break
        stderr_full.append(line)
        if log_callback:
            stripped = line.strip()
            if stripped:
                m = frame_re.search(stripped)
                if m:
                    frame = int(m.group(1))
                    if frame != last_frame:
                        last_frame = frame
                        log_callback(stripped)
                else:
                    log_callback(stripped)
            
    process.wait()
    stdout, _ = process.communicate()
    return process.returncode, stdout, "".join(stderr_full)
