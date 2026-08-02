import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const PAIR_TOKEN_TTL_MS = 5 * 60 * 1000

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

function generatePairingCode(): string {
  const randomNumber = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return String(randomNumber % 1_000_000).padStart(6, "0")
}

function generatePairToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
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
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization")
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Bearer token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      })
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }

    const supabaseAdmin = createClient(getSupabaseUrl(req), serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const jwt = authHeader.slice(7).trim()
    const { data, error } = await supabaseAdmin.auth.getUser(jwt)
    if (error || !data.user) {
      return new Response(JSON.stringify({ error: "Unauthorized user token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      })
    }

    const pairToken = generatePairToken()
    const tokenHash = await sha256Hex(pairToken)
    const pairingCode = generatePairingCode()
    const expiresAt = new Date(Date.now() + PAIR_TOKEN_TTL_MS).toISOString()

    const { error: insertError } = await supabaseAdmin.from("engine_pairing_tokens").insert({
      token_hash: tokenHash,
      user_id: data.user.id,
      pairing_code: pairingCode,
      expires_at: expiresAt,
    })

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }

    return new Response(JSON.stringify({ pairToken, pairingCode, expiresAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
