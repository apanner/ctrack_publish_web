import fs from "node:fs"
import path from "node:path"
import { getUserDataDir } from "./paths.js"

export interface NukeInstallation {
  exePath: string
  version: string
  label: string
  sortKey?: string
}

export type TranscodeMode = "auto" | "nuke" | "oiio" | "ffmpeg"

export interface EngineSettingsFile {
  version: number
  nukeInstallations: NukeInstallation[]
  preferredNukeExe: string | null
  exrTranscodeOrder: string[]
  sampleNkTemplate: string | null
  lastToolScanAt: string | null
  nukeInteractive: boolean
  nukeSafeMode: boolean
  transcodeMode: TranscodeMode
  reviewMp4Preset: "1080p" | "720p" | "4k" | "custom"
  reviewMp4Width: number
  reviewMp4Height: number
  reviewTemplateId: string | null
}

const DEFAULT_ORDER = ["nuke", "oiio", "ffmpeg"]
const VALID_TRANSCODE_MODES = new Set<TranscodeMode>(["auto", "nuke", "oiio", "ffmpeg"])
const VALID_EXR_BACKENDS = new Set(["nuke", "oiio", "ffmpeg"])

export function getEngineSettingsPath(): string {
  return path.join(getUserDataDir(), "engine-settings.json")
}

export function loadEngineSettings(): EngineSettingsFile {
  const target = getEngineSettingsPath()
  if (!fs.existsSync(target)) {
    return {
      version: 1,
      nukeInstallations: [],
      preferredNukeExe: null,
      exrTranscodeOrder: [...DEFAULT_ORDER],
      sampleNkTemplate: null,
      lastToolScanAt: null,
      nukeInteractive: true,
      nukeSafeMode: true,
      transcodeMode: "auto",
      reviewMp4Preset: "1080p",
      reviewMp4Width: 1920,
      reviewMp4Height: 1080,
      reviewTemplateId: "review_mp4",
    }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(target, "utf-8")) as EngineSettingsFile
    const mode = String(raw.transcodeMode ?? "auto").toLowerCase() as TranscodeMode
    const order = normalizeExrOrder(
      Array.isArray(raw.exrTranscodeOrder) ? raw.exrTranscodeOrder : [...DEFAULT_ORDER]
    )
    const preset = normalizeReviewPreset(raw.reviewMp4Preset)
    const dims = resolveReviewDimensions(preset, raw.reviewMp4Width, raw.reviewMp4Height)
    return {
      version: raw.version ?? 1,
      nukeInstallations: Array.isArray(raw.nukeInstallations) ? raw.nukeInstallations : [],
      preferredNukeExe: raw.preferredNukeExe ?? null,
      exrTranscodeOrder: order,
      sampleNkTemplate: raw.sampleNkTemplate ?? null,
      lastToolScanAt: raw.lastToolScanAt ?? null,
      nukeInteractive: raw.nukeInteractive !== false,
      nukeSafeMode: raw.nukeSafeMode !== false,
      transcodeMode: VALID_TRANSCODE_MODES.has(mode) ? mode : "auto",
      reviewMp4Preset: preset as EngineSettingsFile["reviewMp4Preset"],
      reviewMp4Width: dims.width,
      reviewMp4Height: dims.height,
      reviewTemplateId: typeof raw.reviewTemplateId === "string" ? raw.reviewTemplateId : "review_mp4",
    }
  } catch {
    return {
      version: 1,
      nukeInstallations: [],
      preferredNukeExe: null,
      exrTranscodeOrder: [...DEFAULT_ORDER],
      sampleNkTemplate: null,
      lastToolScanAt: null,
      nukeInteractive: true,
      nukeSafeMode: true,
      transcodeMode: "auto",
      reviewMp4Preset: "1080p",
      reviewMp4Width: 1920,
      reviewMp4Height: 1080,
      reviewTemplateId: "review_mp4",
    }
  }
}

const REVIEW_PRESETS: Record<string, { width: number; height: number }> = {
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "4k": { width: 3840, height: 2160 },
}

export type ReviewMp4Preset = keyof typeof REVIEW_PRESETS | "custom"

export function normalizeReviewPreset(value: unknown): ReviewMp4Preset {
  const key = String(value ?? "1080p").trim().toLowerCase()
  if (key === "4k" || key === "2160p") return "4k"
  if (key === "720p") return "720p"
  if (key === "custom") return "custom"
  return "1080p"
}

export function resolveReviewDimensions(
  preset: ReviewMp4Preset,
  width?: number,
  height?: number
): { width: number; height: number } {
  if (preset === "custom") {
    return {
      width: Math.min(7680, Math.max(320, Number(width) || 1920)),
      height: Math.min(4320, Math.max(240, Number(height) || 1080)),
    }
  }
  const p = REVIEW_PRESETS[preset] ?? REVIEW_PRESETS["1080p"]
  return { width: p.width, height: p.height }
}

export function normalizeExrOrder(order: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of order) {
    const key = String(item).trim().toLowerCase()
    if (!VALID_EXR_BACKENDS.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  for (const fallback of DEFAULT_ORDER) {
    if (!seen.has(fallback)) out.push(fallback)
  }
  return out
}

export interface EngineSettingsPatch {
  preferredNukeExe?: string | null
  exrTranscodeOrder?: string[]
  nukeInteractive?: boolean
  nukeSafeMode?: boolean
  transcodeMode?: TranscodeMode
  reviewMp4Preset?: ReviewMp4Preset
  reviewMp4Width?: number
  reviewMp4Height?: number
  reviewTemplateId?: string | null
}

export function applyEngineSettingsPatch(patch: EngineSettingsPatch): EngineSettingsFile {
  const current = loadEngineSettings()
  const next: EngineSettingsFile = { ...current }
  if (patch.preferredNukeExe !== undefined) {
    next.preferredNukeExe = patch.preferredNukeExe
  }
  if (patch.exrTranscodeOrder !== undefined) {
    next.exrTranscodeOrder = normalizeExrOrder(patch.exrTranscodeOrder)
  }
  if (patch.nukeInteractive !== undefined) {
    next.nukeInteractive = patch.nukeInteractive
  }
  if (patch.nukeSafeMode !== undefined) {
    next.nukeSafeMode = patch.nukeSafeMode
  }
  if (patch.transcodeMode !== undefined && VALID_TRANSCODE_MODES.has(patch.transcodeMode)) {
    next.transcodeMode = patch.transcodeMode
  }
  if (patch.reviewMp4Preset !== undefined) {
    next.reviewMp4Preset = normalizeReviewPreset(patch.reviewMp4Preset) as EngineSettingsFile["reviewMp4Preset"]
  }
  if (patch.reviewMp4Width !== undefined) {
    next.reviewMp4Width = patch.reviewMp4Width
  }
  if (patch.reviewMp4Height !== undefined) {
    next.reviewMp4Height = patch.reviewMp4Height
  }
  if (patch.reviewTemplateId !== undefined) {
    const value = String(patch.reviewTemplateId ?? "").trim()
    next.reviewTemplateId = value.length > 0 ? value : null
  }
  const dims = resolveReviewDimensions(next.reviewMp4Preset, next.reviewMp4Width, next.reviewMp4Height)
  next.reviewMp4Width = dims.width
  next.reviewMp4Height = dims.height
  saveEngineSettings(next)
  return next
}

export function saveEngineSettings(settings: EngineSettingsFile): void {
  const target = getEngineSettingsPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ ...settings, version: 1 }, null, 2) + "\n", "utf-8")
}
