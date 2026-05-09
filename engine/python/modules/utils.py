import os
import re
import subprocess
import shutil

def get_ffmpeg_path():
    """
    Finds the ffmpeg executable.
    1. Checks for embedded FFmpeg in resources/bin.
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
        
        local_ffmpeg = os.path.join(project_root, "resources", "bin", "ffmpeg.exe")
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
