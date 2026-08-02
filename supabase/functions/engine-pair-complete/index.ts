import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DEVICE_REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 90

type PairCompleteBody = {
  pairToken?: string
  machineId?: string
  machineLabel?: string
  engineVersion?: string
  osPlatform?: string
}

function getSupabaseUrl(req: Request): string {
  const direct = Deno.env.get("SUPABASE_URL")
  if (direct) {
    return direct
  }
  const requestUrl = new URL(req.url)
  const projectRef = requestUrl.hostname.split(".")[0]
  return `https://${projectRef}.supabase.co`
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return toHex(digest)
}

function generateRefreshToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...corsHeaders,
        "Access-Control-Max-Age": "86400",
      },
      status: 200,
    })
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 405,
    })
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }

    const body = (await req.json()) as PairCompleteBody
    const pairToken = String(body.pairToken ?? "").trim()
    const machineId = String(body.machineId ?? "").trim()
    if (!pairToken || !machineId) {
      return new Response(JSON.stringify({ error: "pairToken and machineId are required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      })
    }

    const supabaseAdmin = createClient(getSupabaseUrl(req), serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const tokenHash = await sha256Hex(pairToken)
    const { data: pairingToken, error: pairingError } = await supabaseAdmin
      .from("engine_pairing_tokens")
      .select("token_hash,user_id,expires_at,consumed_at")
      .eq("token_hash", tokenHash)
      .maybeSingle()

    if (pairingError) {
      return new Response(JSON.stringify({ error: pairingError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }
    if (!pairingToken) {
      return new Response(JSON.stringify({ error: "Invalid pair token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      })
    }
    if (pairingToken.consumed_at) {
      return new Response(JSON.stringify({ error: "Pair token already consumed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      })
    }
    if (new Date(pairingToken.expires_at).getTime() <= Date.now()) {
      return new Response(JSON.stringify({ error: "Pair token expired" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      })
    }

    const { data: device, error: deviceError } = await supabaseAdmin
      .from("engine_devices")
      .upsert(
        {
          user_id: pairingToken.user_id,
          machine_id: machineId,
          machine_label: body.machineLabel ?? null,
          engine_version: body.engineVersion ?? null,
          os_platform: body.osPlatform ?? null,
          last_seen_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: "user_id,machine_id" }
      )
      .select("id,user_id")
      .single()

    if (deviceError || !device) {
      return new Response(JSON.stringify({ error: deviceError?.message ?? "Failed to create device" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }

    const refreshToken = generateRefreshToken()
    const refreshTokenHash = await sha256Hex(refreshToken)
    const expiresAt = new Date(Date.now() + DEVICE_REFRESH_TTL_MS).toISOString()

    const { error: credentialError } = await supabaseAdmin.from("engine_device_credentials").upsert(
      {
        device_id: device.id,
        refresh_token_hash: refreshTokenHash,
        expires_at: expiresAt,
        rotated_at: new Date().toISOString(),
      },
      { onConflict: "device_id" }
    )

    if (credentialError) {
      return new Response(JSON.stringify({ error: credentialError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }

    const { error: consumeError } = await supabaseAdmin
      .from("engine_pairing_tokens")
      .update({
        consumed_at: new Date().toISOString(),
        consumed_device_id: device.id,
      })
      .eq("token_hash", tokenHash)

    if (consumeError) {
      return new Response(JSON.stringify({ error: consumeError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }

    const { data: authUser, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(pairingToken.user_id)
    if (authUserError) {
      return new Response(JSON.stringify({ error: authUserError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }

    const { data: profileRow } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", pairingToken.user_id)
      .maybeSingle()

    const accountEmail = authUser.user?.email ?? null
    const accountName =
      (typeof profileRow?.full_name === "string" && profileRow.full_name.trim()) || accountEmail

    return new Response(
      JSON.stringify({
        deviceId: device.id,
        refreshToken,
        userId: device.user_id,
        email: accountName,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
