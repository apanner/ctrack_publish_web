import os
import re
from pathlib import Path

# Common VFX sequence patterns: name.####.ext, name_####.ext, name####.ext, etc.
SEQUENCE_PATTERN = re.compile(r"^(.*?)(?:\.|_|-)?(\d+)\.(\w+)$")

def scan_directory(root_dir):
    """
    Recursively scans a directory for image sequences and video files.
    """
    results = []
    
    # Supported video formats
    video_exts = {'.mp4', '.mov', '.mkv', '.mxf', '.avi'}
    # Supported image formats (common in VFX)
    image_exts = {'.exr', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.dpx'}
    
    for root, dirs, files in os.walk(root_dir):
        # Group files by potential sequence identity (prefix + extension)
        sequences = {}
        
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            
            # Handle Video Files
            if ext in video_exts:
                full_path = os.path.join(root, file)
                results.append({
                    'type': 'video',
                    'name': file,
                    'path': full_path,
                    'size': os.path.getsize(full_path),
                    'extension': ext[1:]
                })
                continue
            
            # Handle Potential Image Sequences
            if ext in image_exts:
                match = SEQUENCE_PATTERN.match(file)
                if match:
                    prefix, frame, extension = match.groups()
                    key = (root, prefix, extension)
                    if key not in sequences:
                        sequences[key] = {'frames': [], 'total_size': 0}
                    sequences[key]['frames'].append(int(frame))
                    sequences[key]['total_size'] += os.path.getsize(os.path.join(root, file))
                    
        # Process grouped sequences
        for (folder, prefix, extension), data in sequences.items():
            frames = data['frames']
            total_size = data['total_size']
            frames.sort()
            start = frames[0]
            end = frames[-1]
            total_expected = end - start + 1
            missing = []
            
            # Simple gap detection
            if len(frames) != total_expected:
                frame_set = set(frames)
                for f in range(start, end + 1):
                    if f not in frame_set:
                        missing.append(f)
            
            results.append({
                'type': 'sequence',
                'name': prefix.strip('._-'),
                'folder': folder,
                'prefix': prefix,
                'extension': extension,
                'start': start,
                'end': end,
                'count': len(frames),
                'total_size_bytes': total_size,
                'total_expected': total_expected,
                'missing': missing,
                'status': 'error' if missing else 'ready',
                'file_pattern': f"{prefix}{'#' * len(str(frames[0]))}.{extension}"
            })
            
    return results

if __name__ == "__main__":
    # Test
    import sys
    if len(sys.argv) > 1:
        res = scan_directory(sys.argv[1])
        import json
        print(json.dumps(res, indent=2))
