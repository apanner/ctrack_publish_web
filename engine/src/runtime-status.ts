import fs from "node:fs"
import path from "node:path"
import { getEngineRoot, getUserDataDir } from "./paths.js"
import {
  loadEngineSettings,
  saveEngineSettings,
  type EngineSettingsFile,
  type NukeInstallation,
} from "./engine-settings.js"
import { detectNukeInstallations, resolveSampleNkTemplate } from "./nuke-detect.js"
import { getTemplateAbsolutePathById, seedDefaultReviewTemplateIfEmpty } from "./template-registry.js"
import type { PythonManager } from "./python-manager.js"

export interface ToolStatus {
  available: boolean
  path: string | null
  bundled?: boolean
}

export interface EngineRuntimeStatus {
  engineRoot: string
  settingsPath: string
  tools: {
    ffmpeg: ToolStatus
    oiiotool: ToolStatus
    ocio: ToolStatus
    nuke: ToolStatus
    nukeTemplate: ToolStatus
    python: ToolStatus
  }
  nukeInstallations: NukeInstallation[]
  preferredNukeExe: string | null
  exrTranscodeOrder: string[]
  activeExrBackend: string | null
  lastToolScanAt: string | null
  missing: string[]
}

function fileExists(p: string | null | undefined): boolean {
  return !!p && p !== "ffmpeg" && p !== "oiiotool" && fs.existsSync(p)
}

function probeNodeSide(): Partial<EngineRuntimeStatus> {
  const engineRoot = getEngineRoot()
  const ffmpeg = path.join(engineRoot, "runtime", "ffmpeg", "ffmpeg.exe")
  const oiiotool = path.join(engineRoot, "runtime", "oiio", "oiiotool.exe")
  const ocio = path.join(engineRoot, "runtime", "ocio", "aces_1.2", "config.ocio")
  const python = path.join(engineRoot, "runtime", "python", "python.exe")
  const settings = loadEngineSettings()
  seedDefaultReviewTemplateIfEmpty()
  const nukeInstalls = detectNukeInstallations()
  const template =
    (settings.reviewTemplateId ? getTemplateAbsolutePathById(settings.reviewTemplateId) : null) ??
    resolveSampleNkTemplate(engineRoot)
  const preferred =
    settings.preferredNukeExe && fileExists(settings.preferredNukeExe)
      ? settings.preferredNukeExe
      : nukeInstalls[0]?.exePath ?? null

  return {
    engineRoot,
    settingsPath: path.join(getUserDataDir(), "engine-settings.json"),
    tools: {
      ffmpeg: { available: fileExists(ffmpeg), path: fileExists(ffmpeg) ? ffmpeg : null },
      oiiotool: { available: fileExists(oiiotool), path: fileExists(oiiotool) ? oiiotool : null },
      ocio: { available: fileExists(ocio), path: fileExists(ocio) ? ocio : null },
      nuke: { available: fileExists(preferred), path: preferred },
      nukeTemplate: { available: !!template, path: template },
      python: { available: fileExists(python), path: fileExists(python) ? python : null, bundled: true },
    },
    nukeInstallations: nukeInstalls,
    preferredNukeExe: preferred,
    exrTranscodeOrder: settings.exrTranscodeOrder,
    lastToolScanAt: settings.lastToolScanAt,
  }
}

function mergeNodeNukeScan(settings: EngineSettingsFile): void {
  const installs = detectNukeInstallations()
  if (installs.length === 0) return
  settings.nukeInstallations = installs
  settings.lastToolScanAt = new Date().toISOString()
  if (!settings.preferredNukeExe) {
    settings.preferredNukeExe = installs[0].exePath
  }
  const tpl =
    (settings.reviewTemplateId ? getTemplateAbsolutePathById(settings.reviewTemplateId) : null) ??
    resolveSampleNkTemplate(getEngineRoot())
  if (tpl) settings.sampleNkTemplate = tpl
  saveEngineSettings(settings)
}

export async function fetchEngineStatus(
  pythonManager: PythonManager,
  options: { rescan?: boolean } = {}
): Promise<EngineRuntimeStatus> {
  const command = options.rescan ? "rescan_tools" : "get_engine_status"
  try {
    const raw = (await pythonManager.sendCommand(command, {})) as {
      status?: string
      data?: EngineRuntimeStatus
      missing?: string[]
    }
    if (raw?.status === "success" && raw.data) {
      return raw.data
    }
  } catch (err) {
    console.warn(`[runtime-status] Python ${command} failed:`, err)
  }

  if (options.rescan) {
    mergeNodeNukeScan(loadEngineSettings())
  }

  const partial = probeNodeSide()
  const order = partial.exrTranscodeOrder ?? ["nuke", "oiio", "ffmpeg"]
  const tools = partial.tools!
  let active: string | null = null
  for (const name of order) {
    if (name === "nuke" && tools.nuke.available && tools.nukeTemplate.available) {
      active = "nuke"
      break
    }
    if (name === "oiio" && tools.oiiotool.available && tools.ocio.available) {
      active = "oiio"
      break
    }
    if (name === "ffmpeg" && tools.ffmpeg.available) {
      active = "ffmpeg"
      break
    }
  }

  const missing: string[] = []
  if (!tools.ffmpeg.available) missing.push("ffmpeg")
  if (!tools.python.available) missing.push("python")

  return {
    engineRoot: partial.engineRoot ?? getEngineRoot(),
    settingsPath: partial.settingsPath ?? "",
    tools,
    nukeInstallations: partial.nukeInstallations ?? [],
    preferredNukeExe: partial.preferredNukeExe ?? null,
    exrTranscodeOrder: order,
    activeExrBackend: active,
    lastToolScanAt: partial.lastToolScanAt ?? null,
    missing,
  }
}
