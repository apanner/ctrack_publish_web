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
const RELEASE_RPC_NAMES = ["rpc_engine_releases_latest", "engine_releases_latest"] as const

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

function normalizeReleaseRow(row: Record<string, unknown>, channel: string): EngineReleaseInfo | null {
  const version = row.version ? String(row.version) : ""
  if (!version) return null
  return {
    version,
    channel: row.channel ? String(row.channel) : channel,
    publishedAt: row.published_at
      ? String(row.published_at)
      : row.publishedAt
        ? String(row.publishedAt)
        : undefined,
    releaseNotes: row.release_notes
      ? String(row.release_notes)
      : row.releaseNotes
        ? String(row.releaseNotes)
        : undefined,
    breaking: Boolean(row.breaking),
  }
}

export async function fetchLatestEngineRelease(channel = "stable"): Promise<EngineReleaseInfo | null> {
  for (const rpcName of RELEASE_RPC_NAMES) {
    const { data, error } = await supabase.rpc(rpcName, { p_channel: channel })
    if (error || !data) continue
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
    if (!row) continue
    const release = normalizeReleaseRow(row, channel)
    if (release) return release
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
  const payload = (await response.json()) as Record<string, unknown>
  return normalizeReleaseRow(payload, channel)
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

/**
 * Resolve installer URL for the web UI.
 * Prefer public GitHub Releases (always latest / specific tag) so first-time
 * install works without sign-in and without popup-blocker issues on edge hops.
 * When signed in, still try edge first for audit + private-repo support.
 */
export async function requestEngineInstallerDownloadUrl(
  channel = "stable",
  version = "latest"
): Promise<InstallerDownloadResult> {
  const latest = await fetchLatestEngineRelease(channel).catch(() => null)
  const resolvedVersion =
    version !== "latest" ? version : latest?.version?.trim() || "latest"

  const { data: sessionData } = await supabase.auth.getSession()
  const hasSession = Boolean(sessionData.session?.access_token)

  if (hasSession) {
    try {
      return await requestEdgeInstallerDownloadUrl(channel, resolvedVersion === "latest" ? "latest" : resolvedVersion)
    } catch (edgeError) {
      console.warn("[engine-installer] edge download failed, falling back to GitHub:", edgeError)
    }
  }

  return {
    downloadUrl: buildGithubInstallerDownloadUrl(resolvedVersion),
    version: resolvedVersion === "latest" ? (latest?.version ?? "latest") : resolvedVersion,
    source: "github",
    sha256: undefined,
    sizeBytes: undefined,
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

/** Prefer anchor navigation — window.open is often blocked after async work. */
export function openInstallerDownload(downloadUrl: string): void {
  const anchor = document.createElement("a")
  anchor.href = downloadUrl
  anchor.target = "_blank"
  anchor.rel = "noopener noreferrer"
  anchor.style.display = "none"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
