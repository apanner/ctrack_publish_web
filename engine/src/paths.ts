import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Resolved `engine/` package root (contains `python/`, `dist/`). */
export function getEngineRoot(): string {
  const fromDist = path.join(__dirname, "..")
  if (fs.existsSync(path.join(fromDist, "python", "engine.py"))) return path.resolve(fromDist)
  const cwd = process.cwd()
  if (fs.existsSync(path.join(cwd, "python", "engine.py"))) return path.resolve(cwd)
  return path.resolve(fromDist)
}

export function getUserDataDir(): string {
  const base = path.join(os.homedir(), ".ctrack-engine")
  fs.mkdirSync(base, { recursive: true })
  return base
}
