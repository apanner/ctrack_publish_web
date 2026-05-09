import sys
import json
import os
import threading

_log_lock = threading.Lock()

def log_to_electron(msg):
    """Thread-safe: PythonShell expects one JSON object per line; concurrent prints corrupt output."""
    try:
        s = str(msg)[:500]  # Truncate to avoid oversized/problematic strings
        out = json.dumps({'type': 'log', 'message': s})
    except (TypeError, ValueError):
        out = json.dumps({'type': 'log', 'message': '[log error]'})
    with _log_lock:
        print(out)
        sys.stdout.flush()

def check_dependencies():
    missing = []
    try:
        import cv2
    except ImportError:
        missing.append('opencv-python')
    
    try:
        import ffmpeg
    except ImportError:
        missing.append('ffmpeg-python')

    # Check for FFmpeg Binary
    from modules.utils import get_ffmpeg_path
    ffmpeg_path = get_ffmpeg_path()
    
    # If binary missing, we might need to suggest a way to get it
    if ffmpeg_path == 'ffmpeg':
        import shutil
        if not shutil.which('ffmpeg'):
            # Binary is missing from PATH
            # We can suggest 'static-ffmpeg' which includes the binary
            try:
                import static_ffmpeg
            except ImportError:
                missing.append('static-ffmpeg (for ffmpeg binary)')
    elif not os.path.exists(ffmpeg_path):
        missing.append('ffmpeg (binary path invalid)')

    return missing

def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            
            data = json.loads(line)
            command_id = data.get('id')
            command = data.get('command')
            params = data.get('params', {})
            
            result = {}
            if command == 'ping':
                result = {'status': 'ok', 'message': 'pong'}
            
            elif command == 'check_dependencies':
                missing = check_dependencies()
                result = {'status': 'success', 'missing': missing}

            elif command == 'scan_folder':
                from modules.scanner import scan_directory
                folder_path = params.get('folder_path')
                data_result = scan_directory(folder_path)
                result = {'status': 'success', 'data': data_result}

            elif command == 'transcode':
                from modules.transcode import transcode_to_mp4
                input_path = params.get('input_path')
                output_path = params.get('output_path')
                options = params.get('options', {})
                result = transcode_to_mp4(input_path, output_path, options, log_callback=log_to_electron)
            
            elif command == 'transcode_and_webp':
                from modules.transcode import transcode_and_webp_parallel
                input_path = params.get('input_path')
                mp4_path = params.get('mp4_path')
                webp_path = params.get('webp_path')
                transcode_options = params.get('transcode_options', {})
                webp_options = params.get('webp_options', {})
                results = transcode_and_webp_parallel(input_path, mp4_path, webp_path, transcode_options, webp_options, log_callback=log_to_electron)
                if results['transcode']['status'] == 'error':
                    result = results['transcode']
                else:
                    result = {'status': 'success', 'transcode': results['transcode'], 'webp': results['webp']}

            elif command == 'transcode_then_webp_thumb':
                from modules.transcode import transcode_then_webp_thumb
                input_path = params.get('input_path')
                mp4_path = params.get('mp4_path')
                webp_path = params.get('webp_path')
                thumb_output_dir = params.get('thumb_output_dir')
                transcode_options = params.get('transcode_options', {})
                webp_options = params.get('webp_options', {})
                thumb_options = params.get('thumb_options', {})
                results = transcode_then_webp_thumb(input_path, mp4_path, webp_path, thumb_output_dir, transcode_options, webp_options, thumb_options, log_callback=log_to_electron)
                if results['transcode']['status'] == 'error':
                    result = results['transcode']
                else:
                    result = {'status': 'success', 'transcode': results['transcode'], 'webp': results['webp'], 'thumbnails': results['thumbnails']}
            
            elif command == 'webp':
                from modules.transcode import generate_preview_webp
                input_path = params.get('input_path')
                output_path = params.get('output_path')
                options = params.get('options', {})
                result = generate_preview_webp(input_path, output_path, options, log_callback=log_to_electron)

            elif command == 'thumbnails':
                from modules.thumbnail import generate_thumbnails
                input_path = params.get('input_path')
                output_dir = params.get('output_dir')
                options = params.get('options', {})
                result = generate_thumbnails(input_path, output_dir, options, log_callback=log_to_electron)

            elif command == 'thumbnails_and_transcode':
                from modules.transcode import thumbnails_and_transcode_parallel
                input_path = params.get('input_path')
                output_dir = params.get('output_dir')
                mp4_path = params.get('mp4_path')
                thumb_options = params.get('thumb_options', {})
                transcode_options = params.get('transcode_options', {})
                transcode_input_path = params.get('transcode_input_path')
                results = thumbnails_and_transcode_parallel(input_path, output_dir, mp4_path, thumb_options, transcode_options, transcode_input_path=transcode_input_path, log_callback=log_to_electron)
                if results['transcode']['status'] == 'error':
                    result = results['transcode']
                else:
                    result = {'status': 'success', 'thumbnails': results['thumbnails'], 'transcode': results['transcode']}

            elif command == 'exit':
                break
            
            else:
                result = {'status': 'error', 'message': f'Unknown command: {command}'}
            
            if command_id is not None:
                result['id'] = command_id
            
            print(json.dumps(result))
            sys.stdout.flush()
            
        except Exception as e:
            error_resp = {'status': 'error', 'message': str(e)}
            try:
                if 'command_id' in locals() and command_id is not None:
                    error_resp['id'] = command_id
            except: pass
            print(json.dumps(error_resp))
            sys.stdout.flush()

if __name__ == '__main__':
    main()
