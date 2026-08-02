import os
import urllib.request
import zipfile
import shutil

def setup_ffmpeg():
    base_dir = r"d:\dev\track\ctrack_publish"
    bin_dir = os.path.join(base_dir, "resources", "bin")
    
    if not os.path.exists(bin_dir):
        os.makedirs(bin_dir)
        print(f"Created directory: {bin_dir}")

    # Direct link from gyan.dev
    url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    zip_path = os.path.join(bin_dir, "ffmpeg.zip")

    print(f"Downloading FFmpeg from {url}...")
    try:
        # Increase timeout or provide a better UX? Simple request is fine for now.
        urllib.request.urlretrieve(url, zip_path)
    except Exception as e:
        print(f"Failed to download: {e}")
        return

    print("Extracting...")
    extract_to = os.path.join(bin_dir, "temp_extract")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)

    # Find the ffmpeg.exe in the extracted folder (it's usually in a subfolder like ffmpeg-8.0.1.../bin/)
    ffmpeg_found = False
    for root, dirs, files in os.walk(extract_to):
        if "ffmpeg.exe" in files:
            src = os.path.join(root, "ffmpeg.exe")
            dst = os.path.join(bin_dir, "ffmpeg.exe")
            shutil.copy2(src, dst)
            print(f"Successfully installed FFmpeg to: {dst}")
            ffmpeg_found = True
            break

    # Cleanup
    shutil.rmtree(extract_to)
    os.remove(zip_path)

    if not ffmpeg_found:
        print("Could not find ffmpeg.exe in the downloaded ZIP.")

if __name__ == "__main__":
    setup_ffmpeg()
