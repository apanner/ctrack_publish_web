# Code signing and antivirus (Windows)

Unsigned Windows installers that bundle Node, Python, FFmpeg, and add firewall rules are commonly flagged by Defender and other AV products. **There is no reliable bypass without Authenticode signing.**

## What actually fixes it

| Approach | Effect | Cost / effort |
|----------|--------|----------------|
| **EV code signing certificate** | SmartScreen reputation immediately; strongest AV trust | ~$400–700/year, identity verification |
| **OV / standard code signing** | Signed publisher name; reputation builds over download volume | ~$200–500/year |
| **Sign all shipped `.exe` files** | Reduces nested-binary heuristics | Same cert + CI step (see below) |
| **Microsoft false-positive report** | Can clear a specific detection in 1–3 days | Free |
| **User exclusion** | Works for one machine / facility | Manual per workstation |

## Enable signing in this repo

1. Buy a code signing certificate (DigiCert, Sectigo, SSL.com, etc.). **EV is recommended** if you need installs to work on day one without SmartScreen warnings.

2. Export a `.pfx` and set secrets:

   **Local:**
   ```powershell
   $env:CTRACK_CODESIGN_PFX = "D:\certs\ctrack-codesign.pfx"
   $env:CTRACK_CODESIGN_PASSWORD = "your-password"
   ```

   **GitHub Actions** (repo secrets):
   - `CTRACK_CODESIGN_PFX_BASE64` — base64 of the `.pfx`
   - `CTRACK_CODESIGN_PASSWORD`

   Encode locally:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("D:\certs\ctrack-codesign.pfx")) | Set-Clipboard
   ```

3. Install **Windows SDK** (for `signtool.exe`) on the build machine / CI runner.

4. Build as usual — signing runs automatically when secrets are present:
   ```bat
   scripts\build-installer.bat
   ```

   Order: sign bundled `node.exe` / `python.exe` → compile Inno Setup → sign `CTrackPublishEngine-Setup.exe`.

## If AV blocks install today (workaround)

**Windows Security → Virus & threat protection → Protection history** → find the block → **Allow on device** (or add an exclusion for the download folder).

For facility IT, exclude:
- Install folder: `%ProgramFiles%\CTrackPublishEngine`
- Engine data: `%USERPROFILE%\.ctrack-engine`

## Report a false positive

1. **Microsoft Defender:** https://www.microsoft.com/en-us/wdsi/filesubmission  
   - Category: *Software developer*  
   - Upload `CTrackPublishEngine-Setup.exe`  
   - Include product URL: https://ctrackpublishweb.vercel.app

2. **VirusTotal:** https://www.virustotal.com — upload the installer; use vendor contact links for any engine that flags it.

3. Re-submit after each new signed release if detections persist.

## Installer changes that reduce heuristics

- Firewall `netsh` rule is **optional** (unchecked by default) — enable only if loopback port 7777 is blocked.
- Avoid renaming or repacking the installer after signing (breaks signature).
- Distribute only from GitHub Releases or your authenticated edge function — random mirrors hurt reputation.

## Verify signature

```powershell
Get-AuthenticodeSignature .\installer\output\CTrackPublishEngine-Setup.exe
```

Status should be `Valid` with your publisher name.
