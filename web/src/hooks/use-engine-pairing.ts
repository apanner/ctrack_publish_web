import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { ENGINE_BASE } from "@/lib/engine-ipc-shim"

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

function resolveSupabaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (fromEnv) return fromEnv
  const fromClient = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl?.trim()
  return fromClient ?? ""
}

async function initializePairingRequest(): Promise<EnginePairInitResponse> {
  const supabaseUrl = resolveSupabaseUrl()
  if (!supabaseUrl) {
    throw new Error("Missing VITE_SUPABASE_URL for pairing.")
  }
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) {
    throw new Error("You must be signed in before pairing this workstation.")
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/engine-pair-init`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  })
  if (!response.ok) {
    throw new Error(`Failed to initialize pairing (${response.status})`)
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

async function completePairingRequest(pairToken: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${ENGINE_BASE}/api/auth/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairToken }),
    })
  } catch {
    throw new Error(
      `Cannot reach CTrack Engine at ${ENGINE_BASE}. Keep the engine tray running on this PC, then try again.`
    )
  }
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Engine pairing failed (${response.status})`)
  }
  return response.json()
}

async function fetchPairStatus(): Promise<EnginePairStatus | null> {
  const response = await fetch(`${ENGINE_BASE}/api/auth/status`, {
    headers: { "Content-Type": "application/json" },
  })
  if (!response.ok) {
    return null
  }
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
}

export function useEnginePairing(options?: UseEnginePairingOptions) {
  const queryClient = useQueryClient()
  const enabled = options?.enabled ?? true

  const pairStatusQuery = useQuery({
    queryKey: ["engine-pair-status"],
    queryFn: fetchPairStatus,
    enabled,
    refetchInterval: enabled ? (options?.refetchIntervalMs ?? 15_000) : false,
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
