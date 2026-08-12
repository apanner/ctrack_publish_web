import fs from "node:fs"
import path from "node:path"
import { createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { getUserDataDir, getInstallRoot, getEngineRoot } from "./paths.js"

export interface UiManifest {
  version: string
  builtAt?: string
  /** Absolute or CDN URL to a zip of the web/dist folder */
  archiveUrl?: string
  /** Or list of relative asset paths under baseUrl */
  baseUrl?: string
  files?: string[]
}

const MANIFEST_ENV = "CTRACK_UI_MANIFEST_URL"
const DEFAULT_MANIFEST_URL = "https://ctrackpublishweb.vercel.app/engine-ui-manifest.json"
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

function uiCacheRoot(): string {
  return path.join(getUserDataDir(), "ui-cache")
}

function currentVersionPath(): string {
  return path.join(uiCacheRoot(), "version.txt")
}

function currentDistPath(): string {
  return path.join(uiCacheRoot(), "current")
}

export function resolveBundledWebDistDir(): string | null {
  const candidates = [
    path.join(getInstallRoot(), "web", "dist"),
    path.join(getEngineRoot(), "..", "web", "dist"),
    path.join(getEngineRoot(), "web", "dist"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return path.resolve(dir)
  }
  return null
}

/** Prefer fresh UI cache; fall back to installer-baked web/dist. */
export function resolveActiveWebDistDir(): string | null {
  const cached = currentDistPath()
  if (fs.existsSync(path.join(cached, "index.html"))) return cached
  return resolveBundledWebDistDir()
}

function readCachedVersion(): string | null {
  try {
    const p = currentVersionPath()
    if (!fs.existsSync(p)) return null
    return fs.readFileSync(p, "utf-8").trim() || null
  } catch {
    return null
  }
}

async function fetchManifest(url: string): Promise<UiManifest | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      console.warn(`[ui-cache] manifest HTTP ${res.status} from ${url}`)
      return null
    }
    return (await res.json()) as UiManifest
  } catch (e) {
    console.warn("[ui-cache] manifest fetch failed:", e instanceof Error ? e.message : e)
    return null
  }
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok || !res.body) {
    throw new Error(`Download failed HTTP ${res.status}`)
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream)
  await pipeline(nodeStream, createWriteStream(dest))
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(from, to)
    else fs.copyFileSync(from, to)
  }
}

async function extractZipToDir(zipPath: string, destDir: string): Promise<void> {
  // Prefer PowerShell Expand-Archive on Windows (no extra deps).
  if (process.platform === "win32") {
    const { execFile } = await import("node:child_process")
    const { promisify } = await import("node:util")
    const execFileAsync = promisify(execFile)
    const staging = `${destDir}.extracting`
    fs.rmSync(staging, { recursive: true, force: true })
    fs.mkdirSync(staging, { recursive: true })
    const ps = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    await execFileAsync(
      ps,
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${staging.replace(/'/g, "''")}' -Force`],
      { windowsHide: true }
    )
    // If zip contains a single top-level "dist" folder, use that.
    const children = fs.readdirSync(staging)
    const maybeDist = children.length === 1 ? path.join(staging, children[0]) : staging
    const source = fs.existsSync(path.join(maybeDist, "index.html"))
      ? maybeDist
      : fs.existsSync(path.join(staging, "index.html"))
        ? staging
        : maybeDist
    fs.rmSync(destDir, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(destDir), { recursive: true })
    fs.renameSync(source, destDir)
    fs.rmSync(staging, { recursive: true, force: true })
    return
  }
  throw new Error("Zip extract is only implemented on Windows for the UI cache")
}

async function downloadFileTree(manifest: UiManifest, destDir: string): Promise<void> {
  if (!manifest.baseUrl || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Manifest missing archiveUrl and baseUrl/files")
  }
  const staging = `${destDir}.staging`
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  const base = manifest.baseUrl.replace(/\/+$/, "")
  for (const rel of manifest.files) {
    const clean = rel.replace(/^\/+/, "")
    const target = path.join(staging, clean)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await downloadToFile(`${base}/${clean}`, target)
  }
  if (!fs.existsSync(path.join(staging, "index.html"))) {
    throw new Error("Downloaded UI is missing index.html")
  }
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.renameSync(staging, destDir)
}

/**
 * Refresh UI cache from CDN manifest when a newer version is available.
 * Safe to call on boot and on a timer; failures leave the previous UI in place.
 */
export async function refreshUiCache(options: { force?: boolean } = {}): Promise<{
  updated: boolean
  version: string | null
  source: "cache" | "bundled" | "none"
}> {
  const manifestUrl = (process.env[MANIFEST_ENV] || DEFAULT_MANIFEST_URL).trim()
  const manifest = await fetchManifest(manifestUrl)
  if (!manifest?.version) {
    const active = resolveActiveWebDistDir()
    return {
      updated: false,
      version: readCachedVersion(),
      source: active ? (active === currentDistPath() ? "cache" : "bundled") : "none",
    }
  }

  const current = readCachedVersion()
  if (!options.force && current === manifest.version && fs.existsSync(path.join(currentDistPath(), "index.html"))) {
    return { updated: false, version: current, source: "cache" }
  }

  const dest = currentDistPath()
  try {
    if (manifest.archiveUrl) {
      const zipPath = path.join(uiCacheRoot(), `ui-${manifest.version}.zip`)
      fs.mkdirSync(uiCacheRoot(), { recursive: true })
      await downloadToFile(manifest.archiveUrl, zipPath)
      await extractZipToDir(zipPath, dest)
      try {
        fs.unlinkSync(zipPath)
      } catch {
        /* ignore */
      }
    } else {
      await downloadFileTree(manifest, dest)
    }
    fs.writeFileSync(currentVersionPath(), `${manifest.version}\n`, "utf-8")
    console.log(`[ui-cache] Updated local UI to v${manifest.version}`)
    return { updated: true, version: manifest.version, source: "cache" }
  } catch (e) {
    console.warn("[ui-cache] update failed:", e instanceof Error ? e.message : e)
    // Seed cache from bundled dist once so offline path still works.
    if (!fs.existsSync(path.join(dest, "index.html"))) {
      const bundled = resolveBundledWebDistDir()
      if (bundled) {
        copyDirRecursive(bundled, dest)
        fs.writeFileSync(currentVersionPath(), `${manifest.version}-bundled\n`, "utf-8")
      }
    }
    const active = resolveActiveWebDistDir()
    return {
      updated: false,
      version: readCachedVersion(),
      source: active ? (active === currentDistPath() ? "cache" : "bundled") : "none",
    }
  }
}

export function startUiCacheLoop(): void {
  void refreshUiCache()
  setInterval(() => {
    void refreshUiCache()
  }, CHECK_INTERVAL_MS)
}

export function getUiCacheStatus(): {
  cachedVersion: string | null
  activeDir: string | null
  manifestUrl: string
} {
  return {
    cachedVersion: readCachedVersion(),
    activeDir: resolveActiveWebDistDir(),
    manifestUrl: (process.env[MANIFEST_ENV] || DEFAULT_MANIFEST_URL).trim(),
  }
}
