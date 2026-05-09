import { useEffect, useState } from "react"
import App from "./App"
import { FirstRunSetup } from "@/components/setup/FirstRunSetup"
import { initializeSupabase } from "@/lib/supabase"

const ENGINE_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_ENGINE_URL) ||
  "http://127.0.0.1:7777"

export function Root() {
  const [phase, setPhase] = useState<"loading" | "setup" | "app" | "error">("loading")
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const viteReady =
          !!(import.meta.env.VITE_SUPABASE_URL?.trim() && import.meta.env.VITE_SUPABASE_ANON_KEY?.trim())
        if (viteReady) {
          await initializeSupabase()
          if (!cancelled) setPhase("app")
          return
        }
        const stRes = await fetch(`${ENGINE_BASE}/api/setup/status`)
        if (!stRes.ok) {
          throw new Error(
            `Cannot reach engine at ${ENGINE_BASE} (${stRes.status}). Start “Start CTrack Engine” first.`
          )
        }
        const st = (await stRes.json()) as { complete: boolean }
        if (cancelled) return
        if (!st.complete) {
          setPhase("setup")
          return
        }
        const ok = await initializeSupabase()
        if (!ok) {
          setErr("Supabase URL/key missing in engine configuration.")
          setPhase("error")
          return
        }
        setPhase("app")
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
        setPhase("error")
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1A1A1A] text-gray-400">
        Connecting to engine…
      </div>
    )
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#1A1A1A] p-6 text-center text-red-300">
        <p className="max-w-md">{err}</p>
        <button
          type="button"
          className="rounded-md bg-[#0096D6] px-4 py-2 text-white hover:bg-[#0096D6]/90"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    )
  }

  if (phase === "setup") {
    return (
      <FirstRunSetup
        engineBase={ENGINE_BASE}
        onFinished={() => {
          void initializeSupabase().then((ok) => {
            if (ok) setPhase("app")
            else {
              setErr("Saved, but Supabase keys could not be read from the engine.")
              setPhase("error")
            }
          })
        }}
      />
    )
  }

  return <App />
}
