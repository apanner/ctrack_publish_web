import fs from "node:fs"
import path from "node:path"
import { getUserDataDir } from "./paths.js"

/** Keys we persist from the web setup form (flat strings). */
export const SETUP_ENV_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_AUTH_CALLBACK_URL",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_S3_BUCKET_NAME",
  "STORAGE_PROVIDER",
  "HYBRID_STORAGE_PRIMARY_ENDPOINT",
  "HYBRID_STORAGE_PRIMARY_BUCKET",
  "HYBRID_STORAGE_PRIMARY_ACCESS_KEY",
  "HYBRID_STORAGE_PRIMARY_SECRET_KEY",
  "HYBRID_STORAGE_PRIMARY_REGION",
  "CTRACK_ENGINE_PORT",
  "CTRACK_ENGINE_HOST",
  "CTRACK_WEB_ORIGINS",
] as const

export function getUserEnvPath(): string {
  return path.join(getUserDataDir(), ".env")
}

export function isSetupComplete(): boolean {
  const supabaseOk =
    !!process.env.VITE_SUPABASE_URL?.trim() && !!process.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!supabaseOk) return false
  const hasAwsPair =
    !!process.env.AWS_ACCESS_KEY_ID?.trim() && !!process.env.AWS_SECRET_ACCESS_KEY?.trim()
  const hasHybrid =
    !!process.env.HYBRID_STORAGE_PRIMARY_ENDPOINT?.trim() &&
    !!process.env.HYBRID_STORAGE_PRIMARY_ACCESS_KEY?.trim() &&
    !!process.env.HYBRID_STORAGE_PRIMARY_SECRET_KEY?.trim() &&
    !!process.env.HYBRID_STORAGE_PRIMARY_BUCKET?.trim()
  return hasAwsPair || hasHybrid
}

function escapeEnvValue(val: string): string {
  if (/[\s#"']/.test(val)) {
    return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return val
}

const KEY_SET = new Set<string>(SETUP_ENV_KEYS as unknown as string[])

export function mergeUserEnvFile(updates: Record<string, string>): void {
  const target = getUserEnvPath()
  const preserved: string[] = []
  if (fs.existsSync(target)) {
    const raw = fs.readFileSync(target, "utf-8").split(/\r?\n/)
    for (const line of raw) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) {
        if (trimmed) preserved.push(line)
        continue
      }
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed)
      if (m && KEY_SET.has(m[1])) continue
      preserved.push(line)
    }
  }
  const setupLines: string[] = []
  for (const key of SETUP_ENV_KEYS) {
    const v = updates[key]?.trim() ?? ""
    if (!v) continue
    setupLines.push(`${key}=${escapeEnvValue(v)}`)
  }
  const body = [...setupLines, ...preserved.filter(Boolean)].join("\n") + "\n"
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, body, "utf-8")
}
