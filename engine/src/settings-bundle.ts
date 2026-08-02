import {
  applyEngineSettingsPatch,
  getEngineSettingsPath,
  loadEngineSettings,
  type EngineSettingsPatch,
  type TranscodeMode,
} from "./engine-settings.js"
import { getUserDataDir } from "./paths.js"
import { fetchEngineStatus, type EngineRuntimeStatus } from "./runtime-status.js"
import type { PythonManager } from "./python-manager.js"
import {
  loadTraySettings,
  saveTraySettings,
  getTraySettingsPath,
  type TraySettingsFile,
} from "./tray-settings.js"
import { mergeUserEnvRuntimeKeys, readUserEnvRuntimeKeys } from "./user-env.js"
import { getUserEnvPath } from "./setup-config.js"
import { isSetupComplete } from "./setup-config.js"

export interface TraySettingsPatch {
  webUrl?: string
  launchAtLogin?: boolean
  notifyOnMissingTools?: boolean
  pollIntervalSec?: number
}

export interface SettingsBundle {
  engine: ReturnType<typeof loadEngineSettings>
  tray: TraySettingsFile
  runtime: EngineRuntimeStatus | null
  paths: {
    userDataDir: string
    engineSettingsPath: string
    traySettingsPath: string
    userEnvPath: string
  }
  setupComplete: boolean
  envTranscodeMode: string | null
}

export async function getSettingsBundle(pythonManager: PythonManager): Promise<SettingsBundle> {
  const engine = loadEngineSettings()
  const tray = loadTraySettings()
  const envKeys = readUserEnvRuntimeKeys()
  let runtime: EngineRuntimeStatus | null = null
  try {
    runtime = await fetchEngineStatus(pythonManager)
  } catch {
    runtime = null
  }
  return {
    engine,
    tray,
    runtime,
    paths: {
      userDataDir: getUserDataDir(),
      engineSettingsPath: getEngineSettingsPath(),
      traySettingsPath: getTraySettingsPath(),
      userEnvPath: getUserEnvPath(),
    },
    setupComplete: isSetupComplete(),
    envTranscodeMode: envKeys.CTRACK_TRANSCODE_MODE ?? process.env.CTRACK_TRANSCODE_MODE ?? null,
  }
}

export interface SettingsBundlePatch {
  engine?: EngineSettingsPatch
  tray?: TraySettingsPatch
}

export async function patchSettingsBundle(
  pythonManager: PythonManager,
  patch: SettingsBundlePatch
): Promise<SettingsBundle> {
  if (patch.engine) {
    const next = applyEngineSettingsPatch(patch.engine)
    if (patch.engine.transcodeMode) {
      mergeUserEnvRuntimeKeys({ CTRACK_TRANSCODE_MODE: patch.engine.transcodeMode })
      process.env.CTRACK_TRANSCODE_MODE = patch.engine.transcodeMode
    }
    void next
  }
  if (patch.tray) {
    const current = loadTraySettings()
    const next: TraySettingsFile = {
      ...current,
      webUrl: patch.tray.webUrl?.trim() ? patch.tray.webUrl.trim() : current.webUrl,
      launchAtLogin: patch.tray.launchAtLogin ?? current.launchAtLogin,
      notifyOnMissingTools: patch.tray.notifyOnMissingTools ?? current.notifyOnMissingTools,
      pollIntervalSec:
        typeof patch.tray.pollIntervalSec === "number"
          ? Math.min(120, Math.max(3, patch.tray.pollIntervalSec))
          : current.pollIntervalSec,
    }
    saveTraySettings(next)
    if (patch.tray.webUrl) {
      process.env.CTRACK_WEB_URL = next.webUrl
    }
  }
  return getSettingsBundle(pythonManager)
}

export function validateTranscodeMode(mode: string): mode is TranscodeMode {
  return ["auto", "nuke", "oiio", "ffmpeg"].includes(mode)
}
