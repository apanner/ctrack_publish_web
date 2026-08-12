import { mergeUserEnvFile, isSetupComplete, SETUP_ENV_KEYS } from "./setup-config.js"
import { loadEnv } from "./env.js"

export interface ProvisionConfig {
  studioId?: string
  studioSlug?: string
  studioName?: string
  env: Record<string, string>
  message?: string
}

function supabaseUrl(): string {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    ""
  ).replace(/\/+$/, "")
}

function supabaseAnonKey(): string {
  return process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || ""
}

/**
 * After Google login, pull studio workstation config from the cloud and write ~/.ctrack-engine/.env.
 * Artists never paste AWS/MinIO keys.
 */
export async function provisionFromAccessToken(accessToken: string): Promise<{
  ok: boolean
  complete: boolean
  studioId?: string
  studioName?: string
  error?: string
  noStudio?: boolean
}> {
  const base = supabaseUrl()
  const anon = supabaseAnonKey()
  if (!base || !anon) {
    return {
      ok: false,
      complete: isSetupComplete(),
      error: "Supabase is not configured on the engine (missing URL/anon key).",
    }
  }

  const url = `${base}/functions/v1/engine-provision`
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anon,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    return {
      ok: false,
      complete: isSetupComplete(),
      error: e instanceof Error ? e.message : String(e),
    }
  }

  const payload = (await res.json().catch(() => ({}))) as ProvisionConfig & {
    error?: string
    noStudio?: boolean
  }

  if (res.status === 404 || payload.noStudio) {
    return {
      ok: false,
      complete: isSetupComplete(),
      noStudio: true,
      error: payload.error || "No studio membership — ask your TD to add you in CTrack.",
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      complete: isSetupComplete(),
      error: payload.error || `Provision failed (HTTP ${res.status})`,
    }
  }

  const envUpdates: Record<string, string> = {}
  const incoming = payload.env && typeof payload.env === "object" ? payload.env : {}
  for (const key of SETUP_ENV_KEYS) {
    const v = incoming[key]
    if (typeof v === "string" && v.trim()) envUpdates[key] = v.trim()
  }
  // Always keep Supabase identity from the engine if provision omitted them.
  if (!envUpdates.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    envUpdates.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL
  }
  if (!envUpdates.VITE_SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY) {
    envUpdates.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
  }
  if (!envUpdates.CTRACK_WEB_ORIGINS) {
    envUpdates.CTRACK_WEB_ORIGINS =
      process.env.CTRACK_WEB_ORIGINS ||
      "https://ctrackpublishweb.vercel.app,http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:7777"
  }
  if (!envUpdates.CTRACK_AUTH_CALLBACK_URL) {
    envUpdates.CTRACK_AUTH_CALLBACK_URL =
      process.env.CTRACK_AUTH_CALLBACK_URL || "http://127.0.0.1:7777/auth/link"
  }

  if (Object.keys(envUpdates).length === 0) {
    return {
      ok: false,
      complete: isSetupComplete(),
      error: "Provision returned no configuration for this studio.",
      studioId: payload.studioId,
      studioName: payload.studioName,
    }
  }

  mergeUserEnvFile(envUpdates)
  // Reload process.env so subsequent health/setupComplete sees new keys.
  loadEnv()

  return {
    ok: true,
    complete: isSetupComplete(),
    studioId: payload.studioId,
    studioName: payload.studioName,
  }
}
