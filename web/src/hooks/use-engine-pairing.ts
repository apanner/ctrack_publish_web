import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { ENGINE_BASE } from "@/lib/engine-base"

export interface EnginePairInitResponse {
  pairToken: string
  pairingCode?: string
  expiresAt?: string
}

export interface EnginePairStatus {
  paired: boolean
  userId?: string
  email?: string
  deviceId?: string
}

interface UseEnginePairingOptions {
  enabled?: boolean
  refetchIntervalMs?: number
}

const PAIR_INIT_TIMEOUT_MS = 15_000
const PAIR_COMPLETE_TIMEOUT_MS = 12_000
const PAIR_STATUS_TIMEOUT_MS = 5_000

function resolveSupabaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (fromEnv) return fromEnv
  const fromClient = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl?.trim()
  return fromClient ?? ""
}

function displayEngineBase(): string {
  return ENGINE_BASE.replace(/\/+$/, "") || "http://127.0.0.1:7777"
}

export async function initializePairingRequest(): Promise<EnginePairInitResponse> {
  const supabaseUrl = resolveSupabaseUrl()
  if (!supabaseUrl) {
    throw new Error("Missing VITE_SUPABASE_URL for pairing.")
  }
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) {
    throw new Error("You must be signed in before pairing this workstation.")
  }
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/engine-pair-init`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(PAIR_INIT_TIMEOUT_MS),
    })
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
    throw new Error(
      aborted
        ? "Pairing init timed out. Check your network and that the engine-pair-init edge function is deployed."
        : err instanceof Error
          ? err.message
          : "Failed to initialize pairing."
    )
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(detail || `Failed to initialize pairing (${response.status})`)
  }
  const payload = (await response.json()) as {
    pairToken?: string
    pair_token?: string
    pairingCode?: string
    pairing_code?: string
    expiresAt?: string
    expires_at?: string
  }
  const pairToken = payload.pairToken ?? payload.pair_token
  if (!pairToken) {
    throw new Error("Pairing init did not return a pair token.")
  }
  return {
    pairToken,
    pairingCode: payload.pairingCode ?? payload.pairing_code,
    expiresAt: payload.expiresAt ?? payload.expires_at,
  }
}

export async function completePairingRequest(pairToken: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${ENGINE_BASE}/api/auth/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairToken }),
      signal: AbortSignal.timeout(PAIR_COMPLETE_TIMEOUT_MS),
    })
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
    throw new Error(
      aborted
        ? `Engine at ${displayEngineBase()} did not respond. Keep the tray running, allow local network access, then retry.`
        : `Cannot reach CTrack Engine at ${displayEngineBase()}. Keep the engine tray running on this PC, then try again.`
    )
  }
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Engine pairing failed (${response.status})`)
  }
  return response.json()
}

export function buildPairRedirectUrl(pairToken: string): string {
  const engineBase = displayEngineBase()
  return `${engineBase}/api/auth/pair-redirect?pairToken=${encodeURIComponent(pairToken)}`
}

async function fetchPairStatus(): Promise<EnginePairStatus | null> {
  try {
    const response = await fetch(`${ENGINE_BASE}/api/auth/status`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(PAIR_STATUS_TIMEOUT_MS),
      cache: "no-store",
    })
    if (!response.ok) return null
    const payload = (await response.json()) as {
      paired?: boolean
      userId?: string
      user_id?: string
      email?: string
      userEmail?: string
      deviceId?: string
      device_id?: string
    }
    return {
      paired: Boolean(payload.paired),
      userId: payload.userId ?? payload.user_id,
      email: payload.email ?? payload.userEmail,
      deviceId: payload.deviceId ?? payload.device_id,
    }
  } catch {
    return null
  }
}

export function useEnginePairing(options?: UseEnginePairingOptions) {
  const queryClient = useQueryClient()
  const enabled = options?.enabled ?? true

  const pairStatusQuery = useQuery({
    queryKey: ["engine-pair-status"],
    queryFn: fetchPairStatus,
    enabled,
    refetchInterval: enabled ? (options?.refetchIntervalMs ?? 15_000) : false,
    retry: false,
  })

  const initializePairingMutation = useMutation({
    mutationFn: initializePairingRequest,
  })

  const completePairingMutation = useMutation({
    mutationFn: (args: { pairToken: string }) => completePairingRequest(args.pairToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["engine-pair-status"] })
    },
  })

  return {
    pairStatusQuery,
    initializePairingMutation,
    completePairingMutation,
  }
}
