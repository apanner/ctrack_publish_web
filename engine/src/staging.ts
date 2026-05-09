import fs from "node:fs"
import path from "node:path"

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

export interface ProcessPathsResult {
  items: { filePath: string; fileName: string; size: number; frameStart?: number; frameEnd?: number }[]
  unsupported: { fileName: string }[]
}

function processFileEntries(
  filePaths: string[]
): { filePath: string; fileName: string; size: number; frameStart?: number; frameEnd?: number }[] {
  const results: { filePath: string; fileName: string; size: number; frameStart?: number; frameEnd?: number }[] = []
  const dirMap = new Map<string, string[]>()
  for (const fp of filePaths) {
    const dir = path.dirname(fp)
    if (!dirMap.has(dir)) dirMap.set(dir, [])
    dirMap.get(dir)!.push(path.basename(fp))
  }

  dirMap.forEach((names, dirPath) => {
    type SeqEntry = { frame: number; name: string }
    const sequences = new Map<string, SeqEntry[]>()

    for (const name of names) {
      const ext = path.extname(name).toLowerCase()
      const fullPath = path.join(dirPath, name)

      let stat: fs.Stats
      try {
        stat = fs.statSync(fullPath)
        if (!stat.isFile()) continue
      } catch {
        continue
      }

      if (VIDEO_EXTS.has(ext)) {
        results.push({ filePath: fullPath, fileName: name, size: stat.size })
        continue
      }

      if (IMAGE_EXTS.has(ext)) {
        const m = name.match(SEQUENCE_REGEX)
        if (m) {
          const prefix = m[1]
          const frame = parseInt(m[2], 10)
          const extPart = m[3]
          const key = `${prefix}\t${extPart}`
          if (!sequences.has(key)) sequences.set(key, [])
          sequences.get(key)!.push({ frame, name })
        } else {
          results.push({ filePath: fullPath, fileName: name, size: stat.size })
        }
      } else {
        results.push({ filePath: fullPath, fileName: name, size: stat.size })
      }
    }

    sequences.forEach((entries) => {
      entries.sort((a, b) => a.frame - b.frame)
      const firstFrame = entries[0].frame
      const lastFrame = entries[entries.length - 1].frame
      const firstEntry = entries.find((e) => e.frame === firstFrame) || entries[0]
      const firstPath = path.join(dirPath, firstEntry.name)

      let totalSize = 0
      for (const entry of entries) {
        try {
          totalSize += fs.statSync(path.join(dirPath, entry.name)).size
        } catch {
          /* skip */
        }
      }

      results.push({
        filePath: firstPath,
        fileName: firstEntry.name,
        size: totalSize,
        frameStart: firstFrame,
        frameEnd: lastFrame,
      })
    })
  })

  return results
}

function collectFilesRecursive(dirPath: string, out: string[]): void {
  try {
    const names = fs.readdirSync(dirPath)
    for (const name of names) {
      const fp = path.join(dirPath, name)
      try {
        const stat = fs.statSync(fp)
        if (stat.isDirectory()) {
          collectFilesRecursive(fp, out)
        } else if (stat.isFile()) {
          out.push(fp)
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
}

export function processPathsOrFolders(paths: string[]): ProcessPathsResult {
  const allFilePaths: string[] = []
  for (const p of paths) {
    try {
      const stat = fs.statSync(p)
      if (stat.isDirectory()) {
        collectFilesRecursive(p, allFilePaths)
      } else {
        allFilePaths.push(p)
      }
    } catch {
      /* skip */
    }
  }
  const rawItems = processFileEntries(allFilePaths)
  const items: typeof rawItems = []
  const unsupported: { fileName: string }[] = []
  for (const item of rawItems) {
    const ext = path.extname(item.fileName).toLowerCase()
    if (DELIVERY_SUPPORTED_EXTS.has(ext)) {
      items.push(item)
    } else {
      unsupported.push({ fileName: item.fileName })
    }
  }
  return { items, unsupported }
}

export function processFilePathsOnly(filePaths: string[]): ProcessPathsResult {
  const rawItems = processFileEntries(filePaths)
  const items: typeof rawItems = []
  const unsupported: { fileName: string }[] = []
  for (const item of rawItems) {
    const ext = path.extname(item.fileName).toLowerCase()
    if (DELIVERY_SUPPORTED_EXTS.has(ext)) {
      items.push(item)
    } else {
      unsupported.push({ fileName: item.fileName })
    }
  }
  return { items, unsupported }
}
