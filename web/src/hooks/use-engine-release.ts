import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"

export interface EngineRelease {
  version: string
  channel?: string
  publishedAt?: string
  releaseNotes?: string
  breaking?: boolean
}

interface UseEngineReleaseOptions {
  channel?: string
  enabled?: boolean
}

function resolveSupabaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (fromEnv) return fromEnv
  const fromClient = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl?.trim()
  return fromClient ?? ""
}

const RELEASE_RPC_NAMES = ["rpc_engine_releases_latest", "engine_releases_latest"] as const

async function fetchLatestRelease(channel: string): Promise<EngineRelease | null> {
  for (const rpcName of RELEASE_RPC_NAMES) {
    const { data, error } = await supabase.rpc(rpcName, { p_channel: channel })
    if (error || !data) continue
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
  if (!supabaseUrl) {
    return null
  }
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) {
    return null
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/engine-releases-latest?channel=${encodeURIComponent(channel)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch latest release (${response.status})`)
  }
  const payload = (await response.json()) as {
    version?: string
    channel?: string
    publishedAt?: string
    published_at?: string
    releaseNotes?: string
    release_notes?: string
    breaking?: boolean
    release?: EngineRelease
  }
  const release = payload.release ?? payload
  if (!release?.version) {
    return null
  }
  return {
    version: release.version,
    channel: release.channel ?? channel,
    publishedAt: release.publishedAt ?? payload.published_at,
    releaseNotes: release.releaseNotes ?? payload.release_notes,
    breaking: release.breaking,
  }
}

export function useEngineRelease(options?: UseEngineReleaseOptions) {
  const channel = options?.channel ?? "stable"
  const enabled = options?.enabled ?? true
  return useQuery({
    queryKey: ["engine-release-latest", channel],
    queryFn: () => fetchLatestRelease(channel),
    enabled,
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  })
}
