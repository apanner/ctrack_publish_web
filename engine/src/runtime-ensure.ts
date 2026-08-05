import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { getEngineRoot } from "./paths.js"

function getRepoScriptsDir(): string {
  const engineRoot = getEngineRoot()
  const candidates = [
    path.resolve(engineRoot, "..", "scripts"),
    path.resolve(engineRoot, "..", "..", "scripts"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "ensure-engine-runtime.ps1"))) {
      return candidate
    }
  }
  return candidates[0]
}

function hasFfmpeg(runtimeRoot: string): boolean {
  return fs.existsSync(path.join(runtimeRoot, "ffmpeg", "ffmpeg.exe"))
}

function hasOiio(runtimeRoot: string): boolean {
  try {
    const oiioDir = path.join(runtimeRoot, "oiio")
    if (!fs.existsSync(oiioDir)) return false
    const walk = (dir: string): boolean => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isFile() && entry.name.toLowerCase() === "oiiotool.exe") return true
        if (entry.isDirectory() && walk(full)) return true
      }
      return false
    }
    return walk(oiioDir)
  } catch {
    return false
  }
}

export async function ensureMediaRuntime(installRoot: string): Promise<{
  ready: boolean
  ffmpeg: boolean
  oiio: boolean
  downloaded: boolean
  runtimeRoot: string
}> {
  const engineRoot = fs.existsSync(path.join(installRoot, "engine", "dist"))
    ? path.join(installRoot, "engine")
    : installRoot
  const runtimeRoot = path.join(engineRoot, "runtime")
  const ffmpeg = hasFfmpeg(runtimeRoot)
  const oiio = hasOiio(runtimeRoot)
  if (ffmpeg && oiio) {
    return { ready: true, ffmpeg, oiio, downloaded: false, runtimeRoot }
  }

  const scriptsDir = getRepoScriptsDir()
  const ps1 = path.join(scriptsDir, "ensure-engine-runtime.ps1")
  if (!fs.existsSync(ps1)) {
    throw new Error(`Media runtime script not found: ${ps1}`)
  }

  await new Promise<void>((resolve, reject) => {
    const exe = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe"
    const child = spawn(
      exe,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-TargetRoot", engineRoot, "-Provision"],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    )
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `ensure-engine-runtime.ps1 exited ${code}`))
    })
  })

  return {
    ready: hasFfmpeg(runtimeRoot) && hasOiio(runtimeRoot),
    ffmpeg: hasFfmpeg(runtimeRoot),
    oiio: hasOiio(runtimeRoot),
    downloaded: true,
    runtimeRoot,
  }
}
