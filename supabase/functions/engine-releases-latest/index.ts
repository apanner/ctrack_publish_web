import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

  if (req.method !== "GET") {
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
    const supabaseAdmin = createClient(getSupabaseUrl(req), serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const requestUrl = new URL(req.url)
    const channel = requestUrl.searchParams.get("channel")?.trim() || "stable"

    const { data, error } = await supabaseAdmin
      .from("engine_releases")
      .select("*")
      .eq("channel", channel)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }
    if (!data) {
      return new Response(JSON.stringify({ error: "No release found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      })
    }

    return new Response(JSON.stringify(data), {
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
