import fs from "node:fs"
import path from "node:path"
import { getUserDataDir } from "./paths.js"

export interface TraySettingsFile {
  version: number
  webUrl: string
  launchAtLogin: boolean
  notifyOnMissingTools: boolean
  pollIntervalSec: number
}

const DEFAULT_WEB = "https://ctrackpublishweb.vercel.app/"

export function getTraySettingsPath(): string {
  return path.join(getUserDataDir(), "tray-settings.json")
}

export function loadTraySettings(): TraySettingsFile {
  const target = getTraySettingsPath()
  const defaults: TraySettingsFile = {
    version: 1,
    webUrl: process.env.CTRACK_WEB_URL?.trim() || DEFAULT_WEB,
    launchAtLogin: false,
    notifyOnMissingTools: true,
    pollIntervalSec: 8,
  }
  if (!fs.existsSync(target)) return defaults
  try {
    const raw = JSON.parse(fs.readFileSync(target, "utf-8")) as Partial<TraySettingsFile>
    return {
      version: 1,
      webUrl: typeof raw.webUrl === "string" && raw.webUrl.trim() ? raw.webUrl.trim() : defaults.webUrl,
      launchAtLogin: !!raw.launchAtLogin,
      notifyOnMissingTools: raw.notifyOnMissingTools !== false,
      pollIntervalSec:
        typeof raw.pollIntervalSec === "number" && raw.pollIntervalSec >= 3 && raw.pollIntervalSec <= 120
          ? raw.pollIntervalSec
          : defaults.pollIntervalSec,
    }
  } catch {
    return defaults
  }
}

export function saveTraySettings(settings: TraySettingsFile): void {
  const target = getTraySettingsPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ ...settings, version: 1 }, null, 2) + "\n", "utf-8")
}
