import fs from "node:fs"
import path from "node:path"
import { getUserEnvPath } from "./setup-config.js"

const RUNTIME_ENV_KEYS = [
  "CTRACK_TRANSCODE_MODE",
  "CTRACK_EXR_COLORSPACE",
  "CTRACK_OCIO_CONFIG",
  "CTRACK_OCIO_LUT_PATH",
] as const

function escapeEnvValue(val: string): string {
  if (/[\s#"']/.test(val)) {
    return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return val
}

/** Update engine runtime keys in ~/.ctrack-engine/.env without removing setup keys. */
export function mergeUserEnvRuntimeKeys(updates: Record<string, string>): void {
  const target = getUserEnvPath()
  const keySet = new Set<string>(RUNTIME_ENV_KEYS)
  const lines: string[] = []
  const merged: Record<string, string> = { ...readUserEnvRuntimeKeys(), ...updates }

  if (fs.existsSync(target)) {
    for (const line of fs.readFileSync(target, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) {
        if (trimmed) lines.push(line)
        continue
      }
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed)
      if (m && keySet.has(m[1])) continue
      lines.push(line)
    }
  }

  for (const key of RUNTIME_ENV_KEYS) {
    const v = merged[key]?.trim()
    if (!v) continue
    lines.push(`${key}=${escapeEnvValue(v)}`)
  }

  const body = lines.filter(Boolean).join("\n") + "\n"
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, body, "utf-8")
}

export function readUserEnvRuntimeKeys(): Record<string, string> {
  const out: Record<string, string> = {}
  const target = getUserEnvPath()
  if (!fs.existsSync(target)) return out
  for (const line of fs.readFileSync(target, "utf-8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (!m) continue
    if (!(RUNTIME_ENV_KEYS as readonly string[]).includes(m[1])) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[m[1]] = val
  }
  return out
}
