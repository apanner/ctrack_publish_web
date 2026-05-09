import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const ENGINE_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ENGINE_URL) ||
  'http://127.0.0.1:7777'

const authOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  flowType: 'pkce' as const,
}

function placeholderClient(): SupabaseClient {
  return createClient('https://placeholder.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder', {
    auth: authOptions,
  })
}

/** Live binding — replaced after `initializeSupabase()` when using engine-backed config. */
export let supabase: SupabaseClient = placeholderClient()

/**
 * Dev: uses Vite env when set. Installed build: loads URL + anon key from the local engine (`/api/setup/runtime-config`).
 */
export async function initializeSupabase(): Promise<boolean> {
  const viteUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
  const viteKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''
  if (viteUrl && viteKey) {
    supabase = createClient(viteUrl, viteKey, { auth: authOptions })
    return true
  }
  try {
    const res = await fetch(`${ENGINE_BASE}/api/setup/runtime-config`)
    if (!res.ok) return false
    const j = (await res.json()) as { supabaseUrl: string; supabaseAnonKey: string }
    if (!j.supabaseUrl?.trim() || !j.supabaseAnonKey?.trim()) return false
    supabase = createClient(j.supabaseUrl.trim(), j.supabaseAnonKey.trim(), { auth: authOptions })
    return true
  } catch {
    return false
  }
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
