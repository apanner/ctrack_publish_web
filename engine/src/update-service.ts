import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { getAuthSnapshot } from "./auth-store.js"

export interface ManifestArtifact {
  sha256?: string
  sizeBytes?: number
  fileName?: string
}

export interface UpdateManifest {
  product?: string
  channel?: string
  version: string
  publishedAt?: string
  releaseNotes?: string
  breaking?: boolean
  artifacts?: {
    engineSetup?: ManifestArtifact
    nukePluginSetup?: ManifestArtifact
  }
}
export type UpdateProduct = "engine" | "nuke"
export interface UpdateCheckOptions {
  product?: UpdateProduct
  includeDownloadUrl?: boolean
}

export interface UpdateCheckResult {
  ok: boolean
  product: UpdateProduct
  updateAvailable: boolean
  localVersion: string
  remoteVersion: string | null
  manifestUrl: string | null
  message: string
  downloadUrl?: string | null
  downloadUrlError?: string
  manifest?: UpdateManifest
}

export interface DownloadedUpdate {
  version: string
  installerPath: string
  downloadedAt: string
}

export interface DownloadUpdateResult {
  ok: boolean
  updateAvailable: boolean
  localVersion: string
  remoteVersion: string | null
  pendingUpdate: DownloadedUpdate | null
  message: string
}

export interface ApplyUpdateResult {
  ok: boolean
  launched: boolean
  installerPath: string | null
  message: string
}

const MANIFEST_RPC_NAMES = ["rpc_get_engine_manifest_url", "rpc_engine_manifest_url", "rpc_latest_engine_manifest_url"]
const DOWNLOAD_FLAGS = ["/SILENT", "/CLOSEAPPLICATIONS", "/SUPPRESSMSGBOXES"]

interface SemverParts {
  major: number
  minor: number
  patch: number
}

interface DownloadEdgeResponse {
  url?: string
  backupUrl?: string
  downloadUrl?: string
  presignedUrl?: string
  signedUrl?: string
}

function parseSemver(input: string): SemverParts | null {
  const match = input.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return left.localeCompare(right)
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

function normalizeSha256(input: string): string {
  return input.trim().toLowerCase()
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  const file = fs.createReadStream(filePath)
  return await new Promise((resolve, reject) => {
    file.on("error", reject)
    file.on("data", (chunk: Buffer | string) => {
      hash.update(chunk)
    })
    file.on("end", () => resolve(hash.digest("hex")))
  })
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`HTTP ${response.status} from ${url}: ${detail}`)
  }
  return await response.json()
}

function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL?.trim() ?? process.env.VITE_SUPABASE_URL?.trim() ?? ""
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ""
  if (!url || !anonKey) return null
  return { url, anonKey }
}

async function resolveManifestUrlFromSupabaseRpc(): Promise<string | null> {
  const config = getSupabaseConfig()
  if (!config) return null
  for (const rpcName of MANIFEST_RPC_NAMES) {
    try {
      const payload = await fetchJson(`${config.url}/rest/v1/rpc/${rpcName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
        },
        body: "{}",
      })
      if (typeof payload === "string" && payload.trim().length > 0) return payload.trim()
      if (payload && typeof payload === "object") {
        const maybe = payload as Record<string, unknown>
        const urlCandidate =
          (typeof maybe.manifest_url === "string" && maybe.manifest_url) ||
          (typeof maybe.manifestUrl === "string" && maybe.manifestUrl) ||
          (typeof maybe.url === "string" && maybe.url) ||
          (typeof maybe.latest_json_url === "string" && maybe.latest_json_url)
        if (urlCandidate && urlCandidate.trim().length > 0) return urlCandidate.trim()
      }
    } catch {
      // Try the next RPC name.
    }
  }
  return null
}

async function resolveManifestUrl(): Promise<string> {
  const fromEnv = process.env.CTRACK_MANIFEST_URL?.trim()
  if (fromEnv) return fromEnv
  const fromRpc = await resolveManifestUrlFromSupabaseRpc()
  if (fromRpc) return fromRpc
  throw new Error("Manifest URL is not configured. Set CTRACK_MANIFEST_URL or provide a Supabase manifest RPC.")
}

function parseManifest(payload: unknown): UpdateManifest {
  if (!payload || typeof payload !== "object") {
    throw new Error("Update manifest is not an object")
  }
  const manifest = payload as Record<string, unknown>
  const version = typeof manifest.version === "string" ? manifest.version.trim() : ""
  if (!version) throw new Error("Update manifest is missing version")
  const artifactsObj = manifest.artifacts
  let engineSetup: ManifestArtifact | undefined
  let nukePluginSetup: ManifestArtifact | undefined
  if (artifactsObj && typeof artifactsObj === "object") {
    const artifacts = artifactsObj as Record<string, unknown>
    const maybeEngine = artifacts.engineSetup
    if (maybeEngine && typeof maybeEngine === "object") {
      const value = maybeEngine as Record<string, unknown>
      engineSetup = {
        sha256: typeof value.sha256 === "string" ? value.sha256 : undefined,
        sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : undefined,
        fileName: typeof value.fileName === "string" ? value.fileName : undefined,
      }
    }
    const maybeNuke = artifacts.nukePluginSetup
    if (maybeNuke && typeof maybeNuke === "object") {
      const value = maybeNuke as Record<string, unknown>
      nukePluginSetup = {
        sha256: typeof value.sha256 === "string" ? value.sha256 : undefined,
        sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : undefined,
        fileName: typeof value.fileName === "string" ? value.fileName : undefined,
      }
    }
  }
  return {
    product: typeof manifest.product === "string" ? manifest.product : undefined,
    channel: typeof manifest.channel === "string" ? manifest.channel : undefined,
    version,
    publishedAt: typeof manifest.publishedAt === "string" ? manifest.publishedAt : undefined,
    releaseNotes: typeof manifest.releaseNotes === "string" ? manifest.releaseNotes : undefined,
    breaking: typeof manifest.breaking === "boolean" ? manifest.breaking : undefined,
    artifacts: { engineSetup, nukePluginSetup },
  }
}

async function fetchLatestManifest(): Promise<{ manifestUrl: string; manifest: UpdateManifest }> {
  const manifestUrl = await resolveManifestUrl()
  const payload = await fetchJson(manifestUrl)
  return { manifestUrl, manifest: parseManifest(payload) }
}

function getUpdateTempDir(version: string): string {
  const dir = path.join(os.tmpdir(), "ctrack-update", version)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function getPendingUpdateStatePath(): string {
  const dir = path.join(os.homedir(), ".ctrack-engine")
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, "pending-update.json")
}

function writePendingUpdateState(payload: DownloadedUpdate): void {
  fs.writeFileSync(getPendingUpdateStatePath(), JSON.stringify(payload, null, 2), "utf8")
}

function readPendingUpdateState(): DownloadedUpdate | null {
  const filePath = getPendingUpdateStatePath()
  if (!fs.existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as DownloadedUpdate
    if (!parsed || typeof parsed !== "object") return null
    if (typeof parsed.installerPath !== "string" || parsed.installerPath.trim().length === 0) return null
    if (!fs.existsSync(parsed.installerPath)) return null
    if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function requireDeviceToken(): string {
  const auth = getAuthSnapshot()
  if (!auth.paired || !auth.deviceToken) {
    throw new Error("Engine is not paired. Link this workstation in Settings before downloading updates.")
  }
  return auth.deviceToken
}
function resolveArtifactNameForProduct(product: UpdateProduct): "engineSetup" | "nukePluginSetup" {
  return product === "nuke" ? "nukePluginSetup" : "engineSetup"
}
async function requestPresignedDownloadUrl(version: string, fileName: string, product: UpdateProduct): Promise<{ url: string; backupUrl: string | null }> {
  const edgeBase = process.env.CTRACK_EDGE_BASE?.trim()
  if (!edgeBase) {
    throw new Error("CTRACK_EDGE_BASE is not configured")
  }
  const token = requireDeviceToken()
  const payload = await fetchJson(`${edgeBase.replace(/\/$/, "")}/engine-download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      product,
      artifact: resolveArtifactNameForProduct(product),
      version,
      fileName,
    }),
  })
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid response from engine-download")
  }
  const data = payload as DownloadEdgeResponse
  const url = data.url ?? data.downloadUrl ?? data.presignedUrl ?? data.signedUrl
  if (!url || url.trim().length === 0) {
    throw new Error("engine-download did not return a presigned URL")
  }
  const backupUrl = typeof data.backupUrl === "string" && data.backupUrl.trim().length > 0 ? data.backupUrl.trim() : null
  return { url: url.trim(), backupUrl }
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Download failed (${response.status}): ${detail}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(outputPath, bytes)
}

async function downloadFileWithFallback(primaryUrl: string, backupUrl: string | null, outputPath: string): Promise<void> {
  try {
    await downloadFile(primaryUrl, outputPath)
  } catch (primaryError: unknown) {
    if (!backupUrl) {
      throw primaryError
    }
    await downloadFile(backupUrl, outputPath)
  }
}

export async function checkForUpdate(localVersion: string, options?: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const product: UpdateProduct = options?.product === "nuke" ? "nuke" : "engine"
  const { manifestUrl, manifest } = await fetchLatestManifest()
  const artifact = product === "nuke" ? manifest.artifacts?.nukePluginSetup : manifest.artifacts?.engineSetup
  const diff = compareSemver(manifest.version, localVersion)
  const result: UpdateCheckResult = {
    ok: true,
    product,
    updateAvailable: diff > 0,
    localVersion,
    remoteVersion: manifest.version,
    manifestUrl,
    message: diff > 0 ? "Update available" : `${product === "nuke" ? "Nuke plugin" : "Engine"} is up to date`,
    manifest,
  }
  if (options?.includeDownloadUrl && diff > 0 && artifact?.fileName) {
    try {
      const signed = await requestPresignedDownloadUrl(manifest.version, artifact.fileName, product)
      result.downloadUrl = signed.url
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      result.downloadUrl = null
      result.downloadUrlError = message
    }
  }
  if (diff <= 0) {
    return result
  }
  return result
}

export async function downloadUpdate(localVersion: string): Promise<DownloadUpdateResult> {
  const check = await checkForUpdate(localVersion, { product: "engine" })
  if (!check.updateAvailable || !check.manifest) {
    return {
      ok: true,
      updateAvailable: false,
      localVersion,
      remoteVersion: check.remoteVersion,
      pendingUpdate: null,
      message: "No update available",
    }
  }
  const artifact = check.manifest.artifacts?.engineSetup
  if (!artifact?.fileName || !artifact.sha256) {
    throw new Error("Update manifest is missing engine artifact metadata")
  }
  const signed = await requestPresignedDownloadUrl(check.manifest.version, artifact.fileName, "engine")
  const outputDir = getUpdateTempDir(check.manifest.version)
  const installerPath = path.join(outputDir, artifact.fileName)
  await downloadFileWithFallback(signed.url, signed.backupUrl, installerPath)
  const actualHash = normalizeSha256(await sha256File(installerPath))
  const expectedHash = normalizeSha256(artifact.sha256)
  if (actualHash !== expectedHash) {
    try {
      fs.unlinkSync(installerPath)
    } catch {
      // no-op
    }
    throw new Error(`SHA256 mismatch. Expected ${expectedHash}, got ${actualHash}`)
  }
  const pendingUpdate: DownloadedUpdate = {
    version: check.manifest.version,
    installerPath,
    downloadedAt: new Date().toISOString(),
  }
  writePendingUpdateState(pendingUpdate)
  return {
    ok: true,
    updateAvailable: true,
    localVersion,
    remoteVersion: check.remoteVersion,
    pendingUpdate,
    message: "Update downloaded and verified",
  }
}

export function getPendingUpdate(): DownloadedUpdate | null {
  return readPendingUpdateState()
}

export async function applyDownloadedUpdate(): Promise<ApplyUpdateResult> {
  const pending = getPendingUpdate()
  if (!pending) {
    return {
      ok: true,
      launched: false,
      installerPath: null,
      message: "No downloaded update is ready to install",
    }
  }
  if (process.platform !== "win32") {
    throw new Error("Silent installer apply is only supported on Windows")
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(pending.installerPath, DOWNLOAD_FLAGS, {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    })
    child.on("error", reject)
    child.on("spawn", () => {
      child.unref()
      resolve()
    })
  })
  return {
    ok: true,
    launched: true,
    installerPath: pending.installerPath,
    message: "Installer launched in silent mode",
  }
}
