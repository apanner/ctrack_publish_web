import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function getSupabaseUrl(req: Request): string {
  const direct = Deno.env.get("SUPABASE_URL")
  if (direct) return direct
  const requestUrl = new URL(req.url)
  const projectRef = requestUrl.hostname.split(".")[0]
  return `https://${projectRef}.supabase.co`
}

function envOrEmpty(key: string): string {
  return (Deno.env.get(key) ?? "").trim()
}

/** Facility-wide defaults from Edge secrets when no studio_engine_config row exists. */
function defaultEnvFromSecrets(): Record<string, string> {
  const env: Record<string, string> = {}
  const map: Record<string, string> = {
    VITE_SUPABASE_URL: "VITE_SUPABASE_URL",
    VITE_SUPABASE_ANON_KEY: "VITE_SUPABASE_ANON_KEY",
    SUPABASE_URL: "SUPABASE_URL",
    STORAGE_PROVIDER: "ENGINE_STORAGE_PROVIDER",
    AWS_REGION: "ENGINE_AWS_REGION",
    AWS_ACCESS_KEY_ID: "ENGINE_AWS_ACCESS_KEY_ID",
    AWS_SECRET_ACCESS_KEY: "ENGINE_AWS_SECRET_ACCESS_KEY",
    AWS_S3_BUCKET_NAME: "ENGINE_AWS_S3_BUCKET_NAME",
    HYBRID_STORAGE_PRIMARY_ENDPOINT: "ENGINE_HYBRID_ENDPOINT",
    HYBRID_STORAGE_PRIMARY_BUCKET: "ENGINE_HYBRID_BUCKET",
    HYBRID_STORAGE_PRIMARY_ACCESS_KEY: "ENGINE_HYBRID_ACCESS_KEY",
    HYBRID_STORAGE_PRIMARY_SECRET_KEY: "ENGINE_HYBRID_SECRET_KEY",
    HYBRID_STORAGE_PRIMARY_REGION: "ENGINE_HYBRID_REGION",
    CTRACK_WEB_ORIGINS: "ENGINE_WEB_ORIGINS",
  }
  for (const [outKey, secretKey] of Object.entries(map)) {
    const v = envOrEmpty(secretKey)
    if (v) env[outKey] = v
  }
  if (!env.STORAGE_PROVIDER) env.STORAGE_PROVIDER = "hybrid"
  if (!env.CTRACK_WEB_ORIGINS) {
    env.CTRACK_WEB_ORIGINS =
      "https://ctrackpublishweb.vercel.app,http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:7777"
  }
  if (!env.CTRACK_AUTH_CALLBACK_URL) {
    env.CTRACK_AUTH_CALLBACK_URL = "http://127.0.0.1:7777/auth/link"
  }
  // Prefer project URL/anon from the edge runtime itself.
  if (!env.VITE_SUPABASE_URL) env.VITE_SUPABASE_URL = envOrEmpty("SUPABASE_URL") || getFallbackUrl()
  if (!env.SUPABASE_URL) env.SUPABASE_URL = env.VITE_SUPABASE_URL
  if (!env.VITE_SUPABASE_ANON_KEY) env.VITE_SUPABASE_ANON_KEY = envOrEmpty("SUPABASE_ANON_KEY")
  return env
}

function getFallbackUrl(): string {
  return envOrEmpty("SUPABASE_URL")
}

function rowToEnv(row: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = { ...defaultEnvFromSecrets() }
  const set = (key: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) env[key] = value.trim()
  }
  set("STORAGE_PROVIDER", row.storage_provider)
  set("AWS_REGION", row.aws_region)
  set("AWS_ACCESS_KEY_ID", row.aws_access_key_id)
  set("AWS_SECRET_ACCESS_KEY", row.aws_secret_access_key)
  set("AWS_S3_BUCKET_NAME", row.aws_s3_bucket_name)
  set("HYBRID_STORAGE_PRIMARY_ENDPOINT", row.hybrid_endpoint)
  set("HYBRID_STORAGE_PRIMARY_BUCKET", row.hybrid_bucket)
  set("HYBRID_STORAGE_PRIMARY_ACCESS_KEY", row.hybrid_access_key)
  set("HYBRID_STORAGE_PRIMARY_SECRET_KEY", row.hybrid_secret_key)
  set("HYBRID_STORAGE_PRIMARY_REGION", row.hybrid_region)
  set("CTRACK_WEB_ORIGINS", row.web_origins)
  return env
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { ...corsHeaders, "Access-Control-Max-Age": "86400" },
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
    const authHeader = req.headers.get("Authorization") ?? ""
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim()
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing Authorization bearer token" }), {
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

    const supabaseUrl = getSupabaseUrl(req)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt)
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: userError?.message ?? "Invalid session" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      })
    }
    const userId = userData.user.id

    const { data: memberships, error: memberError } = await supabaseAdmin
      .from("studio_members")
      .select("studio_id, role, studio:studios(id, slug, name, display_name, status)")
      .eq("user_id", userId)

    if (memberError) {
      // Table missing or RLS — fall back to facility-wide secrets if present.
      const fallback = defaultEnvFromSecrets()
      const hasStorage =
        (!!fallback.AWS_ACCESS_KEY_ID && !!fallback.AWS_SECRET_ACCESS_KEY) ||
        (!!fallback.HYBRID_STORAGE_PRIMARY_ENDPOINT && !!fallback.HYBRID_STORAGE_PRIMARY_ACCESS_KEY)
      if (hasStorage) {
        return new Response(
          JSON.stringify({
            studioId: null,
            studioName: "Facility default",
            env: fallback,
            message: "Provisioned from facility defaults (no studio_members row).",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        )
      }
      return new Response(JSON.stringify({ error: memberError.message, noStudio: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      })
    }

    const active = (memberships ?? []).filter((m) => {
      const studioRaw = m.studio as { status?: string } | { status?: string }[] | null
      const studio = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw
      return !studio?.status || studio.status === "active"
    })

    if (active.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No studio membership — ask your TD to add you in CTrack.",
          noStudio: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      )
    }

    const membership = active[0]
    const studioRaw = membership.studio as
      | { id: string; slug?: string; name?: string; display_name?: string }
      | { id: string; slug?: string; name?: string; display_name?: string }[]
      | null
    const studio = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw
    const studioId = String(membership.studio_id ?? studio?.id ?? "")

    const { data: configRow } = await supabaseAdmin
      .from("studio_engine_config")
      .select("*")
      .eq("studio_id", studioId)
      .maybeSingle()

    const env = configRow ? rowToEnv(configRow as Record<string, unknown>) : defaultEnvFromSecrets()
    const hasStorage =
      (!!env.AWS_ACCESS_KEY_ID && !!env.AWS_SECRET_ACCESS_KEY) ||
      (!!env.HYBRID_STORAGE_PRIMARY_ENDPOINT &&
        !!env.HYBRID_STORAGE_PRIMARY_ACCESS_KEY &&
        !!env.HYBRID_STORAGE_PRIMARY_SECRET_KEY)

    if (!hasStorage) {
      return new Response(
        JSON.stringify({
          error:
            "Studio has no engine storage config yet. Ask your TD to set studio_engine_config or ENGINE_HYBRID_* Edge secrets.",
          studioId,
          studioName: studio?.display_name || studio?.name || studio?.slug,
          noStudio: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      )
    }

    return new Response(
      JSON.stringify({
        studioId,
        studioSlug: studio?.slug ?? null,
        studioName: studio?.display_name || studio?.name || studio?.slug || null,
        env,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
