import fs from "node:fs"
import path from "node:path"
import type { NukeInstallation } from "./engine-settings.js"

function parseVersion(dirName: string, exeName: string): string {
  const m = /Nuke(\d+(?:\.\d+)?)/i.exec(dirName) ?? /Nuke(\d+(?:\.\d+)?)/i.exec(exeName)
  return m?.[1] ?? "unknown"
}

/** Scan Windows Program Files for Nuke executables (newest first). */
export function detectNukeInstallations(): NukeInstallation[] {
  const found: NukeInstallation[] = []
  const seen = new Set<string>()
  const roots = [
    process.env["ProgramFiles"],
    process.env["ProgramFiles(x86)"],
  ].filter(Boolean) as string[]

  for (const root of roots) {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^Nuke/i.test(entry.name)) continue
      const dir = path.join(root, entry.name)
      let exes: fs.Dirent[] = []
      try {
        exes = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const exe of exes) {
        if (!exe.isFile() || !/^Nuke\d/i.test(exe.name) || !exe.name.endsWith(".exe")) continue
        if (/crash|assist/i.test(exe.name)) continue
        const full = path.join(dir, exe.name)
        if (seen.has(full)) continue
        seen.add(full)
        const version = parseVersion(entry.name, exe.name)
        found.push({
          exePath: full.replace(/\\/g, "/"),
          version,
          label: `Nuke ${version} (${entry.name})`,
          sortKey: version,
        })
      }
    }
  }

  found.sort((a, b) => (b.sortKey ?? "").localeCompare(a.sortKey ?? "", undefined, { numeric: true }))
  return found
}

export function resolveSampleNkTemplate(engineRoot: string): string | null {
  const candidates = [
    path.join(engineRoot, "python", "templates", "review_mp4.nk"),
    path.join(engineRoot, "..", "..", "sample.nk"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}
