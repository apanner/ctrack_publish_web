import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_BASE } from '@/lib/engine-base'

/** Manual exchangeCodeForSession only — avoid double-consume with App / LinkEngine. */
const authOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
  flowType: 'pkce' as const,
}

function createAuthClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: authOptions })
}

function placeholderClient(): SupabaseClient {
  return createAuthClient(
    'https://placeholder.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder'
  )
}

function viteEnvCredentials(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''
  if (!url || !key) return null
  return { url, key }
}

let initialized = false

/**
 * Hosted / Vite builds: real client at module load (no placeholder race on OAuth return).
 * Engine-served builds without Vite env: placeholder until `initializeSupabase()` loads runtime-config.
 */
const viteCreds = viteEnvCredentials()
export let supabase: SupabaseClient = viteCreds
  ? createAuthClient(viteCreds.url, viteCreds.key)
  : placeholderClient()

if (viteCreds) initialized = true

/**
 * Dev/Vercel: uses Vite env when set (idempotent if already eager-inited).
 * Installed build: loads URL + anon key from the local engine (`/api/setup/runtime-config`).
 */
export async function initializeSupabase(): Promise<boolean> {
  const vite = viteEnvCredentials()
  if (vite) {
    if (!initialized) {
      supabase = createAuthClient(vite.url, vite.key)
      initialized = true
    }
    return true
  }
  try {
    const res = await fetch(`${ENGINE_BASE}/api/setup/runtime-config`)
    if (!res.ok) return false
    const j = (await res.json()) as { supabaseUrl: string; supabaseAnonKey: string }
    if (!j.supabaseUrl?.trim() || !j.supabaseAnonKey?.trim()) return false
    supabase = createAuthClient(j.supabaseUrl.trim(), j.supabaseAnonKey.trim())
    initialized = true
    return true
  } catch {
    return false
  }
}

export function isSupabaseInitialized(): boolean {
  return initialized
}

// Database Types
export interface Profile {
    id: string
    full_name: string
    role: 'admin' | 'artist' | 'production' | 'manager' | 'supervisor'
    department: string | null
    avatar_url: string | null
    is_active: boolean
}

// Database Types (Simplified for now - we can import from ctrack_v0 later)
export type Project = {
    id: string;
    name: string;
    code: string;
}

export type Sequence = {
    id: string;
    code: string;
    project_id: string;
}

export type Shot = {
    id: string;
    code: string;
    sequence_id: string;
    project_id: string;
}
