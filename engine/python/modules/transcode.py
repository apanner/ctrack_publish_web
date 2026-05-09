import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from modules.utils import run_ffmpeg, get_ffmpeg_path, get_threads_for_parallel

VIDEO_EXTENSIONS = {'.mov', '.mp4', '.avi', '.mkv', '.mxf', '.webm'}
IMAGE_SEQ_EXTENSIONS = {'.exr', '.jpg', '.jpeg', '.png', '.tga', '.tif', '.tiff'}

def is_image_sequence(input_path, options=None):
    """True if input is EXR/JPG/PNG/TGA image sequence (not video file)."""
    if not input_path:
        return False
    options = options or {}
    ext = os.path.splitext(input_path)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        return False
    has_pattern = '%' in input_path or '#' in input_path
    has_range = options.get('frame_start') is not None and options.get('frame_end') is not None
    if ext in IMAGE_SEQ_EXTENSIONS:
        return has_pattern or has_range
    return False

def build_frame_chunks(frame_start, frame_end, chunk_size, max_chunks):
    """Returns list of (start, end) tuples for chunked transcode. E.g. [(1001,1025), (1026,1050), ...]"""
    total = frame_end - frame_start + 1
    if total <= 0:
        return [(frame_start, frame_end)]
    raw_chunks = (total + chunk_size - 1) // chunk_size
    n_chunks = min(max(1, raw_chunks), max_chunks)
    frames_per = total // n_chunks
    remainder = total % n_chunks
    chunks = []
    pos = frame_start
    for i in range(n_chunks):
        count = frames_per + (1 if i < remainder else 0)
        chunks.append((pos, pos + count - 1))
        pos += count
    return chunks

def transcode_chunk(input_path, output_path, options, log_callback=None):
    """
    Transcodes one chunk of an image sequence to MP4. Used by transcode_sequence_chunked.
    options must include start_frame and frame_count.
    """
    opts = dict(options)
    start_frame = opts.get('start_frame', 1)
    frame_count = opts.get('frame_count', 25)
    opts['start_frame'] = start_frame
    cmd = []
    cmd.extend(['-start_number', str(start_frame)])
    cmd.extend(['-framerate', str(opts.get('fps', 24))])
    cmd.extend(['-i', input_path])
    cmd.extend(['-frames:v', str(frame_count)])
    threads = opts.get('threads')
    if threads is not None and threads > 0:
        cmd.extend(['-threads', str(threads)])
    burnin_enabled = opts.get('burnin', False)
    metadata = opts.get('metadata', {})
    filters = []
    if burnin_enabled:
        font = get_font_path()
        if font:
            shot_text = f"{metadata.get('shot', 'SHOT')} | {metadata.get('version', 'v001')}"
            filters.append(f"drawtext=fontfile='{font}':text='{shot_text}':x=20:y=20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5")
            artist_text = metadata.get('artist', 'Artist')
            filters.append(f"drawtext=fontfile='{font}':text='{artist_text}':x=w-tw-20:y=20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5")
            date_text = metadata.get('date', '')
            if date_text:
                filters.append(f"drawtext=fontfile='{font}':text='{date_text}':x=20:y=h-th-20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5")
            filters.append(f"drawtext=fontfile='{font}':text='%{{frame_num}}':start_number={start_frame}:x=w-tw-20:y=h-th-20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5")
    max_width = opts.get('max_width') or 0
    max_height = opts.get('max_height') or 0
    if max_width and max_height:
        filters.append(f"scale={max_width}:{max_height}:force_original_aspect_ratio=decrease")
    elif max_width:
        filters.append(f"scale={max_width}:-2")
    elif max_height:
        filters.append(f"scale=-2:{max_height}")
    if filters:
        cmd.extend(['-vf', ",".join(filters)])
    codec = opts.get('codec', 'libx265')
    crf = opts.get('crf', 24)
    preset = opts.get('preset', 'slow')
    pixel_format = opts.get('pixel_format', 'yuv420p')
    cmd.extend([
        '-c:v', codec, '-pix_fmt', pixel_format, '-crf', str(crf), '-preset', preset,
        '-tag:v', 'hvc1', '-movflags', '+faststart', output_path
    ])
    if log_callback:
        log_callback(f"Chunk FFmpeg: start={start_frame} count={frame_count}")
    ret, _, stderr = run_ffmpeg(['-y'] + cmd, log_callback=log_callback)
    if ret != 0:
        return {'status': 'error', 'message': stderr}
    return {'status': 'success', 'output': output_path}

def concat_chunks(chunk_paths, output_path, log_callback=None):
    """Concatenates MP4 chunks using FFmpeg concat demuxer. No re-encode."""
    if not chunk_paths:
        return {'status': 'error', 'message': 'No chunks to concatenate'}
    fd, filelist_path = tempfile.mkstemp(suffix='.txt')
    try:
        with os.fdopen(fd, 'w') as f:
            for p in chunk_paths:
                abs_p = os.path.abspath(p)
                abs_p = abs_p.replace('\\', '/')
                f.write(f"file '{abs_p}'\n")
        cmd = ['-y', '-f', 'concat', '-safe', '0', '-i', filelist_path, '-c', 'copy', output_path]
        if log_callback:
            log_callback(f"Concat: merging {len(chunk_paths)} chunks")
        ret, _, stderr = run_ffmpeg(cmd, log_callback=log_callback)
        if ret != 0:
            return {'status': 'error', 'message': stderr}
        return {'status': 'success', 'output': output_path}
    finally:
        try:
            os.remove(filelist_path)
        except OSError:
            pass

def transcode_to_mp4(input_path, output_path, options=None, log_callback=None):
    """
    Smart router: image sequence with 50+ frames -> chunked; else single pass.
    Video files always single pass. Returns result dict.
    """
    options = options or {}
    if is_image_sequence(input_path, options):
        frame_start = options.get('frame_start', 1)
        frame_end = options.get('frame_end', frame_start)
        total = frame_end - frame_start + 1
        min_frames = options.get('chunked_min_frames', 50)
        if total >= min_frames and options.get('chunked_enabled', True):
            return transcode_sequence_chunked(input_path, output_path, options, log_callback)
    return transcode_sequence(input_path, output_path, options, log_callback)

def transcode_sequence_chunked(input_path, output_path, options=None, log_callback=None):
    """
    Image sequences only. Splits into chunks, transcodes in parallel, concats.
    """
    options = options or {}
    frame_start = options.get('frame_start', 1)
    frame_end = options.get('frame_end', frame_start)
    chunk_size = options.get('chunk_size', 25)
    max_chunks = min(8, max(1, (os.cpu_count() or 4) - 1))
    max_chunks = options.get('max_chunks', max_chunks)
    chunks = build_frame_chunks(frame_start, frame_end, chunk_size, max_chunks)
    if log_callback:
        log_callback(f"Chunked transcode: {len(chunks)} chunks for frames {frame_start}-{frame_end}")
    temp_dir = tempfile.mkdtemp()
    temp_paths = []
    try:
        threads_per_chunk = max(1, get_threads_for_parallel())
        opts_base = {k: v for k, v in options.items() if k not in ('start_frame', 'frame_count')}
        with ThreadPoolExecutor(max_workers=len(chunks)) as ex:
            futures = []
            for i, (start, end) in enumerate(chunks):
                chunk_opts = {**opts_base, 'start_frame': start, 'frame_count': end - start + 1, 'threads': threads_per_chunk}
                chunk_out = os.path.join(temp_dir, f'chunk_{i}.mp4')
                temp_paths.append(chunk_out)
                futures.append(ex.submit(transcode_chunk, input_path, chunk_out, chunk_opts, log_callback))
            for f in futures:
                res = f.result()
                if res.get('status') == 'error':
                    raise Exception(res.get('message', 'Chunk failed'))
        concat_res = concat_chunks(temp_paths, output_path, log_callback)
        if concat_res.get('status') == 'error':
            raise Exception(concat_res.get('message', 'Concat failed'))
        return {'status': 'success', 'output': output_path}
    finally:
        for p in temp_paths:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(temp_dir)
        except OSError:
            pass

def get_font_path():
    """Returns the embedded font path, escaped for FFmpeg filters."""
    # Try local project font first (embedded)
    try:
        # Get the path relative to this script
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        local_font = os.path.join(base_dir, "resources", "fonts", "arial.ttf")
        
        if os.path.exists(local_font):
            # For FFmpeg on Windows, we MUST escape the colon: C\:
            # and it's best to use forward slashes for the rest.
            escaped_path = local_font.replace(":", "\\:").replace("\\", "/")
            return escaped_path
    except Exception:
        pass

    # Fallback to system font
    windows_font = "C:/Windows/Fonts/arial.ttf"
    if os.path.exists(windows_font):
        return windows_font.replace(':', '\\:')
    return None

def transcode_sequence(input_path, output_path, options=None, log_callback=None):
    """
    Transcodes an EXR sequence or video file to MP4 with optional burn-ins.
    Uses H.265 (HEVC) for maximum quality and minimum file size.
    """
    try:
        if options is None:
            options = {}
            
        burnin_enabled = options.get('burnin', False)
        metadata = options.get('metadata', {})
        
        # Default to H.265 (libx265) for higher compression
        codec = options.get('codec', 'libx265') 
        crf = options.get('crf', 24) # CRF 24 in x265 is roughly equivalent to CRF 18-20 in x264
        preset = options.get('preset', 'slow') # Slow for better compression efficiency
        max_width = options.get('max_width') or 0
        max_height = options.get('max_height') or 0
        pixel_format = options.get('pixel_format', 'yuv420p')
        
        # Build filter complex for burnins and/or scale
        filters = []
        if burnin_enabled:
            font = get_font_path()
            if font:
                shot_text = f"{metadata.get('shot', 'SHOT')} | {metadata.get('version', 'v001')}"
                filters.append(f"drawtext=fontfile='{font}':text='{shot_text}':x=20:y=20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5")
                artist_text = metadata.get('artist', 'Artist')
                filters.append(f"drawtext=fontfile='{font}':text='{artist_text}':x=w-tw-20:y=20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5")
                date_text = metadata.get('date', '')
                if date_text:
                    filters.append(f"drawtext=fontfile='{font}':text='{date_text}':x=20:y=h-th-20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5")
                
                # Use actual start frame for burn-in
                start_num = options.get('start_frame', 1)
                filters.append(f"drawtext=fontfile='{font}':text='%{{frame_num}}':start_number={start_num}:x=w-tw-20:y=h-th-20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5")
        
        scale_part = None
        if max_width and max_height:
            scale_part = f"scale={max_width}:{max_height}:force_original_aspect_ratio=decrease"
        elif max_width:
            scale_part = f"scale={max_width}:-2"
        elif max_height:
            scale_part = f"scale=-2:{max_height}"
        if scale_part:
            filters.append(scale_part)
        
        cmd = []
        if '%' in input_path or '#' in input_path:
            cmd.extend(['-start_number', str(options.get('start_frame', 1))])
            cmd.extend(['-framerate', str(options.get('fps', 24))])
            
        cmd.extend(['-i', input_path])
        threads = options.get('threads')
        if threads is not None and threads > 0:
            cmd.extend(['-threads', str(threads)])
        
        if filters:
            cmd.extend(['-vf', ",".join(filters)])
            
        if log_callback:
            log_callback(f"FFmpeg Command: {' '.join(cmd)}")
            
        cmd.extend([
            '-c:v', codec,
            '-pix_fmt', pixel_format,
            '-crf', str(crf),
            '-preset', preset,
            '-tag:v', 'hvc1', # Crucial for QuickTime/macOS/iOS playback
            '-movflags', '+faststart', # Streaming optimization
            '-map_metadata', '0', # Copy creation_time, timecode, and other container metadata from source MOV/MP4
            output_path
        ])
        
        returncode, stdout, stderr = run_ffmpeg(['-y'] + cmd, log_callback=log_callback)
        
        if returncode != 0:
            return {'status': 'error', 'message': stderr, 'command': " ".join(cmd)}
            
        return {'status': 'success', 'output': output_path}
        
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

def generate_preview_webp(input_path, output_path, options=None, log_callback=None):
    """
    Generates a high-quality Animated WebP from a sequence.
    WebP is much more efficient than GIF.
    """
    try:
        if options is None:
            options = {}
        width = options.get('width', 480)
        fps = options.get('fps', 8)
        frame_skip = options.get('frame_skip', 1)
        duration_seconds = options.get('duration_seconds', 3)
        quality = options.get('quality', 75)
        
        is_sequence = '%' in input_path or '#' in input_path
        
        # Build filter with dynamic frame skipping
        filters = []
        if is_sequence and frame_skip > 1:
            filters.append(f"select='not(mod(n,{frame_skip}))'")
        
        filters.append(f"fps={fps}")
        filters.append(f"scale={width}:-1:flags=lanczos")
        vf = ",".join(filters)
        
        cmd = ['-y']
        
        if is_sequence:
            cmd.extend(['-start_number', str(options.get('start_frame', 1))])
        else:
            # Check if it's an image file (jpg, png, tif, exr)
            lower_path = input_path.lower()
            if any(lower_path.endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.exr', '.tga']):
                # For single images, we need -loop 1
                cmd.extend(['-loop', '1'])
            
        cmd.extend(['-i', input_path])
        threads = options.get('threads')
        if threads is not None and threads > 0:
            cmd.extend(['-threads', str(threads)])
        
        # Only add duration limit if we are looping a single image
        if any(input_path.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.exr', '.tga']):
             cmd.extend(['-t', str(duration_seconds)])
        cmd.extend(['-vf', vf])
        cmd.extend([
            '-vcodec', 'libwebp',
            '-lossless', '0',
            '-qscale', str(quality),
            '-loop', '0',
            '-an',
            output_path
        ])
        
        if log_callback:
            log_callback(f"WebP Preview Command: {' '.join(cmd)}")
            
        ret, out, err = run_ffmpeg(cmd, log_callback=log_callback)
        if ret != 0:
            return {'status': 'error', 'message': err}
            
        return {'status': 'success', 'output': output_path}
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

def thumbnails_and_transcode_parallel(input_path, output_dir, mp4_path, thumb_options=None, transcode_options=None, transcode_input_path=None, log_callback=None):
    """
    Runs thumbnails and transcode in parallel when both are needed (video or image sequence).
    Each uses ~50% CPU (threads = cpu_count//2).
    transcode_input_path: optional - for image sequences use sequence pattern (e.g. file.%04d.jpg); else same as input_path.
    Returns {'thumbnails': thumb_result, 'transcode': transcode_result}.
    """
    from modules.thumbnail import generate_thumbnails
    thumb_options = thumb_options or {}
    transcode_options = transcode_options or {}
    transcode_options.setdefault('threads', get_threads_for_parallel())
    tc_input = transcode_input_path if transcode_input_path is not None else input_path

    def run_thumbnails():
        return generate_thumbnails(input_path, output_dir, thumb_options, log_callback=log_callback)

    def run_transcode():
        return transcode_sequence(tc_input, mp4_path, transcode_options, log_callback=log_callback)

    if log_callback:
        log_callback("Running thumbnails and transcode in parallel (50% CPU each)...")
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_thumb = ex.submit(run_thumbnails)
        f_transcode = ex.submit(run_transcode)
        thumb_result = f_thumb.result()
        transcode_result = f_transcode.result()
    return {'thumbnails': thumb_result, 'transcode': transcode_result}

def transcode_then_webp_thumb(input_path, mp4_path, webp_path, thumb_output_dir, transcode_options=None, webp_options=None, thumb_options=None, log_callback=None):
    """
    Process order: MP4 first (chunked for long image sequences, single for video),
    then WebP and thumbnails from the MP4. Sequential steps.
    Returns {'transcode': ..., 'webp': ..., 'thumbnails': ...}.
    """
    from modules.thumbnail import generate_thumbnails
    transcode_options = transcode_options or {}
    webp_options = webp_options or {}
    thumb_options = thumb_options or {}
    transcode_options.setdefault('threads', get_threads_for_parallel())
    webp_options.setdefault('threads', get_threads_for_parallel())

    if log_callback:
        log_callback("Step 1/3: Transcode to MP4 (chunked if long image sequence)...")
    tc_res = transcode_to_mp4(input_path, mp4_path, transcode_options, log_callback=log_callback)
    if tc_res.get('status') != 'success':
        return {'transcode': tc_res, 'webp': None, 'thumbnails': None}

    if log_callback:
        log_callback("Step 2/3: Generate thumbnails from MP4...")
    thumb_res = generate_thumbnails(mp4_path, thumb_output_dir, thumb_options, log_callback=log_callback)

    if log_callback:
        log_callback("Step 3/3: Generate WebP from MP4...")
    webp_opts = {**webp_options, 'width': webp_options.get('width', 480), 'fps': webp_options.get('fps', 8)}
    webp_res = generate_preview_webp(mp4_path, webp_path, webp_opts, log_callback=log_callback)

    return {'transcode': tc_res, 'webp': webp_res, 'thumbnails': thumb_res}

def transcode_and_webp_parallel(input_path, mp4_path, webp_path, transcode_options=None, webp_options=None, log_callback=None):
    """
    Runs transcode (MP4) and WebP generation in parallel, each using ~50% CPU (threads = cpu_count//2).
    Returns (transcode_result, webp_result) as a dict with 'transcode' and 'webp' keys.
    """
    transcode_options = transcode_options or {}
    webp_options = webp_options or {}
    transcode_options.setdefault('threads', get_threads_for_parallel())
    webp_options.setdefault('threads', get_threads_for_parallel())

    def run_transcode():
        return transcode_sequence(input_path, mp4_path, transcode_options, log_callback=log_callback)

    def run_webp():
        return generate_preview_webp(input_path, webp_path, webp_options, log_callback=log_callback)

    if log_callback:
        log_callback("Running transcode and WebP in parallel (50% CPU each)...")
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_transcode = ex.submit(run_transcode)
        f_webp = ex.submit(run_webp)
        transcode_result = f_transcode.result()
        webp_result = f_webp.result()
    return {'transcode': transcode_result, 'webp': webp_result}
