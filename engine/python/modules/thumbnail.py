import os
import re

from modules.transcode import _prepend_exr_colorspace_filters


def _thumb_width(options):
    return max(1, int(options.get("width") or 480))


def _thumb_height(options):
    return max(0, int(options.get("height") or 0))


def _thumb_quality(options):
    return max(1, min(31, int(options.get("quality") or 2)))


def _webp_quality(options):
    return max(1, min(100, int(options.get("webp_quality") or 75)))


def _webp_width(options):
    return max(1, int(options.get("webp_width") or options.get("width") or 480))


def _frame_pick(options):
    frame = str(options.get("frame") or "middle").strip().lower()
    if frame in ("first", "middle", "last"):
        return frame
    return "middle"


def _pick_frame_index(total_frames, frame_pick):
    if total_frames <= 0:
        return 0
    if frame_pick == "first":
        return 0
    if frame_pick == "last":
        return max(0, total_frames - 1)
    return max(0, total_frames // 2)


def _resize_frame(frame, options):
    import cv2

    h, w = frame.shape[:2]
    if w <= 0 or h <= 0:
        return frame

    target_w = _thumb_width(options)
    target_h = _thumb_height(options)
    if target_h > 0:
        return cv2.resize(frame, (target_w, target_h))
    scale = target_w / w
    return cv2.resize(frame, (target_w, max(1, int(h * scale))))


def generate_thumbnails(input_path, output_dir, options=None, log_callback=None):
    """
    Generates a static thumbnail and an animated WebP from a sequence or video.
    - Image sequence: first create thumb from first frame, then WebP from sequence.
    - MP4/video: create thumb + WebP from video.
    Uses OpenCV for the static thumbnail to be robust against missing ffmpeg.
    Dynamic options: width, height, quality, frame, frame_skip, fps, frame_start, frame_end.
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
        options = options or {}
        frame_start = options.get("frame_start")
        frame_end = options.get("frame_end")
        frame_pick = _frame_pick(options)
        thumb_quality = _thumb_quality(options)
        webp_width = _webp_width(options)
        webp_quality = _webp_quality(options)
        is_image_sequence = frame_start is not None and frame_end is not None

        sequence_pattern = None
        if is_image_sequence:
            first_frame_str = str(frame_start)
            pad = len(first_frame_str)
            pattern = f"%0{max(4, pad)}d"
            sequence_pattern = re.sub(r"\d+(\.\w+)$", pattern + r"\1", input_path, count=1)
            if sequence_pattern and sequence_pattern != input_path:
                log(f"Image sequence [{frame_start}-{frame_end}], pattern: {sequence_pattern}")

        success = False
        is_image = False
        log(f"Generating thumbnail from: {input_path} (frame={frame_pick}, width={_thumb_width(options)})")

        try:
            is_image = any(
                input_path.lower().endswith(ext)
                for ext in [".jpg", ".jpeg", ".png", ".exr", ".tif", ".tiff"]
            )

            if is_image and "%" not in input_path:
                log("Processing as static image using imread...")
                import cv2

                frame = cv2.imread(input_path)
                if frame is not None:
                    resized = _resize_frame(frame, options)
                    cv2.imwrite(thumb_path, resized, [int(cv2.IMWRITE_JPEG_QUALITY), max(1, 100 - thumb_quality * 3)])
                    success = True
                    log("Static thumbnail created with imread.")

            if not success:
                log("Processing/Fallback using VideoCapture or resolving sequence...")
                import cv2

                resolved_path = input_path
                if "%" in input_path:
                    resolved_path = input_path.replace("%04d", "1001")
                    if not os.path.exists(resolved_path):
                        resolved_path = input_path.replace("%04d", "0001")

                cap = cv2.VideoCapture(resolved_path)
                if cap.isOpened():
                    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                    frame_index = _pick_frame_index(total_frames, frame_pick)
                    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                    ret, frame = cap.read()
                    if ret:
                        resized = _resize_frame(frame, options)
                        cv2.imwrite(
                            thumb_path,
                            resized,
                            [int(cv2.IMWRITE_JPEG_QUALITY), max(1, 100 - thumb_quality * 3)],
                        )
                        success = True
                        log(f"Thumbnail created with VideoCapture at frame {frame_index}.")
                cap.release()
        except Exception as cv_err:
            log(f"OpenCV Error: {cv_err}")

        if not success:
            log("OpenCV failed or skipped, falling back to FFmpeg for static thumbnail...")
            cmd_thumb = ["-y", "-i", input_path, "-frames:v", "1", "-q:v", str(thumb_quality), thumb_path]
            if frame_pick == "last":
                cmd_thumb = ["-y", "-sseof", "-1", "-i", input_path, "-frames:v", "1", "-q:v", str(thumb_quality), thumb_path]
            run_ffmpeg(cmd_thumb, log_callback=log_callback)
            if os.path.exists(thumb_path):
                success = True
                log("Static thumbnail created with FFmpeg.")

        is_single_static_image = is_image and "%" not in input_path and not is_image_sequence

        if not is_single_static_image:
            log("Generating optimized WebP preview (dynamic settings)...")
            webp_path = os.path.join(output_dir, "preview.webp")

            frame_skip = options.get("frame_skip", 1)
            fps = options.get("fps", 6)
            webp_input = sequence_pattern if sequence_pattern else input_path
            is_sequence = "%" in webp_input or "#" in webp_input or sequence_pattern is not None
            is_video_file = any(
                webp_input.lower().endswith(ext) for ext in [".mp4", ".mov", ".avi", ".mkv", ".webm"]
            )

            filters = []
            _prepend_exr_colorspace_filters(filters, webp_input, options)
            if is_sequence and frame_skip > 1:
                filters.append(f"select='not(mod(n,{frame_skip}))'")
            filters.append(f"fps={fps}")
            filters.append(f"scale={webp_width}:-1:flags=lanczos")
            vf = ",".join(filters)

            cmd_webp = ["-y"]
            if is_sequence:
                cmd_webp.extend(["-framerate", "24"])
                if frame_start is not None:
                    cmd_webp.extend(["-start_number", str(int(frame_start))])
            elif not is_sequence and not is_video_file:
                cmd_webp.extend(["-loop", "1"])

            cmd_webp.extend(["-i", webp_input])
            cmd_webp.extend(["-t", "3"])
            cmd_webp.extend(["-vf", vf])
            cmd_webp.extend(
                [
                    "-vcodec",
                    "libwebp",
                    "-lossless",
                    "0",
                    "-q:v",
                    str(webp_quality),
                    "-loop",
                    "0",
                    "-an",
                    webp_path,
                ]
            )
            run_ffmpeg(cmd_webp, log_callback=log_callback)
        else:
            log("Skipping WebP generation for single static image.")
            webp_path = None

        if success:
            return {
                "status": "success",
                "thumbnail": thumb_path,
                "webp": webp_path if webp_path and os.path.exists(webp_path) else None,
            }
        return {"status": "error", "message": "Failed to generate static thumbnail with all methods."}

    except Exception as e:
        log(f"Critical Thumbnail Error: {e}")
        return {"status": "error", "message": str(e)}
