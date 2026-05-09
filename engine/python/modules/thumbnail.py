import os
import re

def generate_thumbnails(input_path, output_dir, options=None, log_callback=None):
    """
    Generates a static thumbnail and an animated WebP from a sequence or video.
    - Image sequence: first create thumb from first frame, then WebP from sequence.
    - MP4/video: create thumb + WebP from video.
    Uses OpenCV for the static thumbnail to be robust against missing ffmpeg.
    Dynamic options: frame_skip, fps, frame_start, frame_end.
    """
    from modules.utils import run_ffmpeg

    def log(msg):
        if log_callback:
            log_callback(msg)
        else:
            print(f"[THUMB] {msg}")

    try:
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            
        thumb_path = os.path.join(output_dir, "thumbnail.jpg")
        gif_path = os.path.join(output_dir, "preview.gif")
        
        options = options or {}
        frame_start = options.get('frame_start')
        frame_end = options.get('frame_end')
        is_image_sequence = frame_start is not None and frame_end is not None
        
        # Build ffmpeg sequence pattern for image sequences (e.g. file.1001.jpg -> file.%04d.jpg)
        sequence_pattern = None
        if is_image_sequence:
            first_frame_str = str(frame_start)
            pad = len(first_frame_str)
            pattern = f'%0{max(4, pad)}d'
            sequence_pattern = re.sub(r'\d+(\.\w+)$', pattern + r'\1', input_path, count=1)
            if sequence_pattern and sequence_pattern != input_path:
                log(f"Image sequence [{frame_start}-{frame_end}], pattern: {sequence_pattern}")
        
        # 1. Generate Static Thumbnail (always first - from first frame or video)
        success = False
        log(f"Generating thumbnail from: {input_path}")
        
        try:
            # Check if it's a static image or a sequence/video
            is_image = any(input_path.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.exr', '.tif', '.tiff'])
            
            if is_image and "%" not in input_path:
                log("Processing as static image using imread...")
                import cv2
                # Note: imread might need special handling for EXR
                frame = cv2.imread(input_path)
                if frame is not None:
                    h, w = frame.shape[:2]
                    scale = 480 / w
                    resized = cv2.resize(frame, (480, int(h * scale)))
                    cv2.imwrite(thumb_path, resized)
                    success = True
                    log("Static thumbnail created with imread.")
            
            if not success:
                log("Processing/Fallback using VideoCapture or resolving sequence...")
                import cv2
                # Handle sequence patterns
                resolved_path = input_path
                if "%" in input_path:
                    resolved_path = input_path.replace("%04d", "1001")
                    if not os.path.exists(resolved_path):
                        resolved_path = input_path.replace("%04d", "0001")
                
                cap = cv2.VideoCapture(resolved_path)
                if cap.isOpened():
                    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                    middle = max(0, total_frames // 2)
                    cap.set(cv2.CAP_PROP_POS_FRAMES, middle)
                    ret, frame = cap.read()
                    if ret:
                        h, w = frame.shape[:2]
                        scale = 480 / w
                        resized = cv2.resize(frame, (480, int(h * scale)))
                        cv2.imwrite(thumb_path, resized)
                        success = True
                        log("Thumbnail created with VideoCapture.")
                cap.release()
        except Exception as cv_err:
            log(f"OpenCV Error: {cv_err}")

        # 2. Fallback to FFmpeg for static thumbnail if OpenCV fails
        if not success:
            log("OpenCV failed or skipped, falling back to FFmpeg for static thumbnail...")
            cmd_thumb = [
                '-y',
                '-i', input_path,
                '-frames:v', '1',
                '-q:v', '2',
                thumb_path
            ]
            run_ffmpeg(cmd_thumb, log_callback=log_callback)
            if os.path.exists(thumb_path):
                success = True
                log("Static thumbnail created with FFmpeg.")
        
        # 3. Generate Animated WebP (for videos or image sequences - NOT for single static image)
        is_single_static_image = is_image and "%" not in input_path and not is_image_sequence
        
        if not is_single_static_image:
            log("Generating optimized WebP preview (dynamic settings)...")
            webp_path = os.path.join(output_dir, "preview.webp")
            
            frame_skip = options.get('frame_skip', 1)
            fps = options.get('fps', 6)
            
            # Use sequence pattern for image sequences, else input path (can be MP4/video)
            webp_input = sequence_pattern if sequence_pattern else input_path
            is_sequence = '%' in webp_input or '#' in webp_input or sequence_pattern is not None
            is_video_file = any(webp_input.lower().endswith(ext) for ext in ['.mp4', '.mov', '.avi', '.mkv', '.webm'])

            # Build filter with dynamic frame skipping
            filters = []
            if is_sequence and frame_skip > 1:
                filters.append(f"select='not(mod(n,{frame_skip}))'")
            filters.append(f"fps={fps}")
            filters.append("scale=480:-1:flags=lanczos")
            vf = ",".join(filters)

            cmd_webp = ['-y']
            if is_sequence:
                cmd_webp.extend(['-framerate', '24'])
                if frame_start is not None:
                    cmd_webp.extend(['-start_number', str(int(frame_start))])
            elif not is_sequence and not is_video_file:
                cmd_webp.extend(['-loop', '1'])

            cmd_webp.extend(['-i', webp_input])
            cmd_webp.extend(['-t', '3'])
            cmd_webp.extend(['-vf', vf])
            cmd_webp.extend([
                '-vcodec', 'libwebp',
                '-lossless', '0',
                '-qscale', '75',
                '-loop', '0',
                '-an',
                webp_path
            ])
            run_ffmpeg(cmd_webp, log_callback=log_callback)
        else:
            log("Skipping WebP generation for single static image.")
            webp_path = None
        
        if success:
            return {
                'status': 'success', 
                'thumbnail': thumb_path,
                'webp': webp_path if webp_path and os.path.exists(webp_path) else None
            }
        else:
            return {'status': 'error', 'message': 'Failed to generate static thumbnail with all methods.'}
        
    except Exception as e:
        log(f"Critical Thumbnail Error: {e}")
        return {'status': 'error', 'message': str(e)}
