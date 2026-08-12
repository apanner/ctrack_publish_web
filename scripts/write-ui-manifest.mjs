#!/usr/bin/env node
/**
 * Writes web/public/engine-ui-manifest.json (and copies to web/dist after build).
 * Used by the local engine UI cache to download the latest web UI on the fly.
 *
 * Usage:
 *   node scripts/write-ui-manifest.mjs
 *   node scripts/write-ui-manifest.mjs --version 0.1.3 --base-url https://ctrackpublishweb.vercel.app
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const webPkg = JSON.parse(fs.readFileSync(path.join(root, "web", "package.json"), "utf-8"))
const rootVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf-8")).web || webPkg.version
  } catch {
    return webPkg.version
  }
})()

const args = process.argv.slice(2)
function flag(name, fallback) {
  const i = args.indexOf(name)
  if (i >= 0 && args[i + 1]) return args[i + 1]
  return fallback
}

const version = flag("--version", rootVersion)
const baseUrl = flag("--base-url", "https://ctrackpublishweb.vercel.app").replace(/\/+$/, "")
const archiveUrl = flag("--archive-url", "")

const distDir = path.join(root, "web", "dist")
const publicDir = path.join(root, "web", "public")
fs.mkdirSync(publicDir, { recursive: true })

function listFiles(dir, prefix = "") {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel))
    else if (entry.name !== "engine-ui-manifest.json") out.push(rel.replace(/\\/g, "/"))
  }
  return out
}

const files = listFiles(distDir)
const manifest = {
  version: String(version),
  builtAt: new Date().toISOString(),
  baseUrl,
  files,
  ...(archiveUrl ? { archiveUrl } : {}),
}

const json = `${JSON.stringify(manifest, null, 2)}\n`
const publicPath = path.join(publicDir, "engine-ui-manifest.json")
fs.writeFileSync(publicPath, json, "utf-8")
if (fs.existsSync(distDir)) {
  fs.writeFileSync(path.join(distDir, "engine-ui-manifest.json"), json, "utf-8")
}
console.log(`[ui-manifest] wrote v${version} (${files.length} files) → ${publicPath}`)
