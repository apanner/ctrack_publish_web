/**
 * Browser-side delivery media detection (mirrors engine `staging.ts` + `ctrack_publish/python/modules/scanner.py` ideas).
 * No engine call: used to build staging rows + keep original File objects until Publish.
 */

import type { StagingItem } from "@/types/staging"

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".mxf", ".avi"])
const IMAGE_EXTS = new Set([".exr", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".dpx"])
const DELIVERY_SUPPORTED_EXTS = new Set([
  ".exr",
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".dpx",
  ".mp4",
  ".mov",
  ".mkv",
  ".mxf",
  ".avi",
])
const SEQUENCE_REGEX = /^(.*?)(?:\.|_|-)?(\d+)\.(\w+)$/

export function isLikelyRealDiskPathForEngine(p: string): boolean {
  const t = p.trim()
  if (t.length < 2) return false
  // Win32 long path prefix from some APIs: \\?\C:\...
  if (/^\\\\\?\\[A-Za-z]:[\\/]/.test(t)) return true
  if (/^[A-Za-z]:[\\/]/.test(t)) return true
  if (t.startsWith("\\\\")) return true
  if (t.startsWith("/Users/") || t.startsWith("/home/") || t.startsWith("/Volumes/")) return true
  return false
}

/**
 * Path the local engine / FFmpeg must read for publish. EXRs are never copied to engine temp:
 * we only process from this path and write transcoded outputs to app temp, then upload.
 */
export function resolveRealDiskInputPathForEnginePublish(item: StagingItem): string | null {
  const persisted = item.engineInputPath?.trim() ?? ""
  if (persisted.length > 0 && isLikelyRealDiskPathForEngine(persisted)) {
    return persisted
  }
  // Real disk path from engine/Electron staging must win even if a stale browserBundle exists
  // (e.g. user used Files then engine Add folder, or hydration merged shapes).
  const direct = item.filePath?.trim() ?? ""
  if (direct.length > 0 && isLikelyRealDiskPathForEngine(direct)) {
    return direct
  }
  if (!item.browserBundle?.files?.length) {
    return null
  }
  const candidates = item.browserBundle.files
    .map((f) => {
      const p = (f as File & { path?: string }).path?.trim() ?? ""
      return { f, p }
    })
    .filter((x) => x.p.length > 0 && isLikelyRealDiskPathForEngine(x.p))
  if (!candidates.length) return null
  if (item.frameStart != null) {
    const exact = candidates.find((x) => {
      const m = x.f.name.match(SEQUENCE_REGEX)
      return m != null && parseInt(m[2], 10) === item.frameStart
    })
    if (exact) return exact.p
    const sorted = candidates
      .map((x) => {
        const m = x.f.name.match(SEQUENCE_REGEX)
        const fr = m != null ? parseInt(m[2], 10) : Number.POSITIVE_INFINITY
        return { x, fr }
      })
      .sort((a, b) => a.fr - b.fr)
    if (sorted.length > 0 && sorted[0].fr !== Number.POSITIVE_INFINITY) return sorted[0].x.p
  }
  return candidates[0].p
}

const VIRTUAL_PREFIX = "virtual:/"

function virtualMultipartFromStagingFilePath(filePath: string): string | null {
  const t = filePath.trim()
  if (!t.toLowerCase().startsWith(VIRTUAL_PREFIX)) return null
  const rest = t.slice(VIRTUAL_PREFIX.length).replace(/^[./\\]+/, "")
  return rest.length > 0 ? rest : null
}

/** True when staging `filePath` is a browser virtual key (needs disk root or `engineInputPath`). */
export function stagingItemUsesVirtualFilePath(item: StagingItem): boolean {
  return virtualMultipartFromStagingFilePath(item.filePath) != null
}

/** Join root from engine `select-directory` with multipart relative path (see `fileToDeliveryMultipartName` / `collect-directory-files`). */
export function joinDiskRootWithVirtualMultipart(diskRoot: string, multipart: string): string {
  const root = diskRoot.trim().replace(/[/\\]+$/, "")
  const sep = root.includes("\\") ? "\\" : "/"
  const relativeParts = multipart.split("__").filter(Boolean)
  return [root, ...relativeParts].join(sep)
}

/**
 * Map browser-staged virtual path + user’s on-disk folder (same tree as in the picker) to an absolute file path for FFmpeg.
 */
export function resolveBrowserStagingItemWithDiskRoot(item: StagingItem, diskRoot: string): string | null {
  const multipart = virtualMultipartFromStagingFilePath(item.filePath)
  if (!multipart) return null
  return joinDiskRootWithVirtualMultipart(diskRoot, multipart)
}

/** Build a flat multipart name so nested folder picks stay unique in virtual keys. */
export function fileToDeliveryMultipartName(file: File): string {
  const f = file as File & { path?: string; relativePath?: string; webkitRelativePath?: string }
  const rel =
    (typeof f.relativePath === "string" && f.relativePath.length > 0 ? f.relativePath : null) ??
    (typeof f.webkitRelativePath === "string" && f.webkitRelativePath.length > 0 ? f.webkitRelativePath : null) ??
    (typeof f.path === "string" && f.path.length > 0 && !isLikelyRealDiskPathForEngine(f.path) ? f.path : null)
  if (rel) {
    return rel.replace(/\\/g, "/").replace(/^[./]+/, "").split("/").filter(Boolean).join("__")
  }
  return file.name
}

function logicalDirKey(multipartName: string): string {
  const last = multipartName.lastIndexOf("__")
  if (last === -1) return "__root__"
  return multipartName.slice(0, last)
}

function logicalBaseName(multipartName: string): string {
  const last = multipartName.lastIndexOf("__")
  if (last === -1) return multipartName
  return multipartName.slice(last + 2)
}

interface RawEntry {
  file: File
  multipart: string
  dirKey: string
  baseName: string
  ext: string
}

export interface DeliveryScanResult {
  items: StagingItem[]
  unsupported: { fileName: string }[]
  firstPath?: string
}

/**
 * Scan File[] from folder picker / drag-drop and return staging items with in-memory `browserBundle`
 * (all frames for sequences). Engine is not contacted.
 */
export function scanDeliveryMediaFromFiles(files: File[]): DeliveryScanResult {
  const entries: RawEntry[] = []
  for (const file of files) {
    const multipart = fileToDeliveryMultipartName(file)
    const baseName = logicalBaseName(multipart)
    const dirKey = logicalDirKey(multipart)
    const ext = baseName.includes(".") ? baseName.slice(baseName.lastIndexOf(".")).toLowerCase() : ""
    entries.push({ file, multipart, dirKey, baseName, ext })
  }

  type SeqEntry = { frame: number; name: string; file: File }
  const sequences = new Map<string, SeqEntry[]>()
  const singles: Array<{ file: File; multipart: string; baseName: string; ext: string; dirKey: string }> = []

  for (const e of entries) {
    if (VIDEO_EXTS.has(e.ext)) {
      singles.push({ file: e.file, multipart: e.multipart, baseName: e.baseName, ext: e.ext, dirKey: e.dirKey })
      continue
    }
    if (IMAGE_EXTS.has(e.ext)) {
      const m = e.baseName.match(SEQUENCE_REGEX)
      if (m) {
        const prefix = m[1]
        const frame = parseInt(m[2], 10)
        const extPart = m[3]
        const key = `${e.dirKey}\t${prefix}\t${extPart}`
        if (!sequences.has(key)) sequences.set(key, [])
        sequences.get(key)!.push({ frame, name: e.baseName, file: e.file })
      } else {
        singles.push({ file: e.file, multipart: e.multipart, baseName: e.baseName, ext: e.ext, dirKey: e.dirKey })
      }
    } else {
      singles.push({ file: e.file, multipart: e.multipart, baseName: e.baseName, ext: e.ext, dirKey: e.dirKey })
    }
  }

  const rawItems: StagingItem[] = []

  for (const s of singles) {
    rawItems.push({
      filePath: `virtual:/${s.multipart.replace(/__/g, "/")}`,
      fileName: s.baseName,
      size: s.file.size,
      browserBundle: { files: [s.file] },
    })
  }

  sequences.forEach((seqEntries, key) => {
    const [, , extPart] = key.split("\t")
    seqEntries.sort((a, b) => a.frame - b.frame)
    const firstFrame = seqEntries[0].frame
    const lastFrame = seqEntries[seqEntries.length - 1].frame
    const firstEntry = seqEntries.find((x) => x.frame === firstFrame) ?? seqEntries[0]
    let totalSize = 0
    for (const x of seqEntries) {
      totalSize += x.file.size
    }
    const orderedFiles = seqEntries.map((x) => x.file)
    rawItems.push({
      filePath: `virtual:/${fileToDeliveryMultipartName(firstEntry.file)}`,
      fileName: firstEntry.name,
      size: totalSize,
      frameStart: firstFrame,
      frameEnd: lastFrame,
      browserBundle: { files: orderedFiles },
    })
  })

  const items: StagingItem[] = []
  const unsupported: { fileName: string }[] = []
  for (const item of rawItems) {
    const ext = item.fileName.includes(".") ? item.fileName.slice(item.fileName.lastIndexOf(".")).toLowerCase() : ""
    if (DELIVERY_SUPPORTED_EXTS.has(ext)) {
      items.push(item)
    } else {
      unsupported.push({ fileName: item.fileName })
    }
  }

  const firstPath = items[0]?.filePath
  return { items, unsupported, firstPath }
}

export interface BrowserSequenceFrameCheck {
  frameStart: number
  frameEnd: number
  presentFrames: number[]
}

/** Gap check for SequenceHealthBar when media is browser-only (no engine folder path). */
export function buildBrowserSequenceFrameCheck(item: StagingItem): BrowserSequenceFrameCheck | null {
  if (item.frameStart == null || item.frameEnd == null) return null
  const bundle = item.browserBundle?.files
  if (!bundle?.length) return null
  const present: number[] = []
  for (const f of bundle) {
    const base = f.name
    const m = base.match(SEQUENCE_REGEX)
    if (m) present.push(parseInt(m[2], 10))
  }
  present.sort((a, b) => a - b)
  return { frameStart: item.frameStart, frameEnd: item.frameEnd, presentFrames: present }
}
