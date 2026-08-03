import { supabase } from "@/lib/supabase"

export interface EngineReleaseInfo {
  version: string
  channel?: string
  publishedAt?: string
  releaseNotes?: string
  breaking?: boolean
}

export type InstallerDownloadSource = "edge" | "github"

export interface InstallerDownloadResult {
  downloadUrl: string
  backupDownloadUrl?: string
  version: string
  sha256?: string
  sizeBytes?: number
  source: InstallerDownloadSource
}

const DEFAULT_GITHUB_REPO = "apanner/ctrack_publish_web"
const DEFAULT_INSTALLER_ASSET = "CTrackPublishEngine-Setup.exe"

function resolveSupabaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (fromEnv) return fromEnv
  const fromClient = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl?.trim()
  return fromClient ?? ""
}

export function resolveGithubRepo(): string {
  return import.meta.env.VITE_GITHUB_REPO?.trim() || DEFAULT_GITHUB_REPO
}

export function resolveInstallerAssetName(): string {
  return import.meta.env.VITE_ENGINE_INSTALLER_ASSET?.trim() || DEFAULT_INSTALLER_ASSET
}

export function buildGithubInstallerDownloadUrl(version = "latest"): string {
  const repo = resolveGithubRepo()
  const asset = resolveInstallerAssetName()
  if (!version || version === "latest") {
    return `https://github.com/${repo}/releases/latest/download/${asset}`
  }
  const tag = version.startsWith("v") ? version : `v${version}`
  return `https://github.com/${repo}/releases/download/${tag}/${asset}`
}

export function buildGithubReleasePageUrl(version = "latest"): string {
  const repo = resolveGithubRepo()
  if (!version || version === "latest") {
    return `https://github.com/${repo}/releases/latest`
  }
  const tag = version.startsWith("v") ? version : `v${version}`
  return `https://github.com/${repo}/releases/tag/${tag}`
}

export async function fetchLatestEngineRelease(channel = "stable"): Promise<EngineReleaseInfo | null> {
  const { data, error } = await supabase.rpc("engine_releases_latest", { p_channel: channel })
  if (!error && data) {
    const row = Array.isArray(data) ? data[0] : data
    if (row?.version) {
      return {
        version: String(row.version),
        channel: row.channel ? String(row.channel) : channel,
        publishedAt: row.published_at ? String(row.published_at) : undefined,
        releaseNotes: row.release_notes ? String(row.release_notes) : undefined,
        breaking: Boolean(row.breaking),
      }
    }
  }
  const supabaseUrl = resolveSupabaseUrl()
  if (!supabaseUrl) return null
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) return null
  const response = await fetch(
    `${supabaseUrl}/functions/v1/engine-releases-latest?channel=${encodeURIComponent(channel)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  )
  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Failed to fetch latest release (${response.status})`)
  }
  const payload = (await response.json()) as {
    version?: string
    channel?: string
    published_at?: string
    publishedAt?: string
    release_notes?: string
    releaseNotes?: string
    breaking?: boolean
  }
  if (!payload.version) return null
  return {
    version: payload.version,
    channel: payload.channel ?? channel,
    publishedAt: payload.publishedAt ?? payload.published_at,
    releaseNotes: payload.releaseNotes ?? payload.release_notes,
    breaking: Boolean(payload.breaking),
  }
}

async function requestEdgeInstallerDownloadUrl(
  channel: string,
  version: string
): Promise<InstallerDownloadResult> {
  const supabaseUrl = resolveSupabaseUrl()
  if (!supabaseUrl) {
    throw new Error("Missing Supabase URL. Set VITE_SUPABASE_URL before downloading.")
  }
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) {
    throw new Error("Sign in first to download the engine installer.")
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/engine-download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ product: "engine", version, channel }),
  })
  if (response.status === 404) {
    throw new Error("No engine release published yet.")
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Installer download request failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  const payload = (await response.json()) as {
    url?: string
    backupUrl?: string
    downloadUrl?: string
    download_url?: string
    presignedUrl?: string
    presigned_url?: string
    version?: string
    sha256?: string
    sizeBytes?: number
  }
  const downloadUrl =
    payload.downloadUrl ?? payload.download_url ?? payload.presignedUrl ?? payload.presigned_url ?? payload.url
  if (!downloadUrl) {
    throw new Error("Download endpoint returned no URL.")
  }
  const backupDownloadUrl =
    typeof payload.backupUrl === "string" && payload.backupUrl.trim().length > 0
      ? payload.backupUrl.trim()
      : undefined
  return {
    downloadUrl,
    backupDownloadUrl,
    version: payload.version ?? version,
    sha256: payload.sha256,
    sizeBytes: payload.sizeBytes,
    source: "edge",
  }
}

export async function requestEngineInstallerDownloadUrl(
  channel = "stable",
  version = "latest"
): Promise<InstallerDownloadResult> {
  try {
    return await requestEdgeInstallerDownloadUrl(channel, version)
  } catch (edgeError) {
    const latest = await fetchLatestEngineRelease(channel).catch(() => null)
    const resolvedVersion = latest?.version ?? (version === "latest" ? "latest" : version)
    return {
      downloadUrl: buildGithubInstallerDownloadUrl(resolvedVersion),
      version: resolvedVersion === "latest" ? (latest?.version ?? "latest") : resolvedVersion,
      source: "github",
      sha256: undefined,
      sizeBytes: undefined,
    }
  }
}

export async function probeEngineHealth(
  engineBase: string
): Promise<{ online: boolean; version?: string }> {
  try {
    const response = await fetch(`${engineBase.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    })
    if (!response.ok) return { online: false }
    const payload = (await response.json()) as { version?: string; status?: string; pythonReady?: boolean }
    const online = payload.status === "ok" && payload.pythonReady === true
    return { online, version: payload.version }
  } catch {
    return { online: false }
  }
}

export function openInstallerDownload(downloadUrl: string): void {
  window.open(downloadUrl, "_blank", "noopener,noreferrer")
}
