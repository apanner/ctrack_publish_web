import { useEffect, useState } from "react"
import App from "./App"
import { FirstRunSetup } from "@/components/setup/FirstRunSetup"
import { EngineConnectionGate } from "@/components/engine/EngineConnectionGate"
import { LinkEnginePage } from "@/pages/LinkEnginePage"
import { ENGINE_BASE, isLocalEngineOrigin } from "@/lib/engine-base"
import { hasLocalNetworkAccessFlag, markLocalNetworkAccessGranted, probeEngineConnection } from "@/lib/engine-connection"
import { initializeSupabase, supabase } from "@/lib/supabase"

const START_ENGINE_HELP =
  "Run scripts\\start-engine-tray.vbs (or the Start CTrack Engine Tray shortcut), then retry."

function engineUrl(path: string): string {
  const base = ENGINE_BASE.replace(/\/+$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

export function Root() {
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/link-engine") {
    return <LinkEnginePage />
  }
  return <RootApp />
}

function RootApp() {
  const [phase, setPhase] = useState<"loading" | "setup" | "app" | "error">("loading")
  const [err, setErr] = useState<string | null>(null)
  const [isEngineReachable, setIsEngineReachable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribeAuth: (() => void) | null = null

    async function refreshAuthState(): Promise<void> {
      await supabase.auth.getSession()
    }

    async function probeEngineReachability(): Promise<boolean> {
      // Same-origin local UI (served by engine) — no Chrome PNA gate.
      if (isLocalEngineOrigin()) {
        markLocalNetworkAccessGranted()
        const probe = await probeEngineConnection()
        return probe.online
      }
      if (!hasLocalNetworkAccessFlag()) return false
      const probe = await probeEngineConnection()
      return probe.online
    }

    async function boot() {
      try {
        const viteReady =
          !!(import.meta.env.VITE_SUPABASE_URL?.trim() && import.meta.env.VITE_SUPABASE_ANON_KEY?.trim())
        if (viteReady) {
          const ok = await initializeSupabase()
          if (!ok) {
            throw new Error("Supabase URL/key missing in web environment.")
          }
          await refreshAuthState()
          const {
            data: { subscription },
          } = supabase.auth.onAuthStateChange(() => {
            /* session tracked in useAuth */
          })
          unsubscribeAuth = () => subscription.unsubscribe()
          const online = await probeEngineReachability()
          if (!cancelled) {
            setIsEngineReachable(online)
            setPhase("app")
          }
          return
        }
        const stRes = await fetch(engineUrl("/api/setup/status"), {
          signal: AbortSignal.timeout(15_000),
        })
        if (!stRes.ok) {
          throw new Error(
            `Cannot reach engine at ${ENGINE_BASE || "http://127.0.0.1:7777"} (${stRes.status}). ${START_ENGINE_HELP}`
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
        await refreshAuthState()
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(() => {
          /* session tracked in useAuth */
        })
        unsubscribeAuth = () => subscription.unsubscribe()
        const online = await probeEngineReachability()
        if (!cancelled) {
          setIsEngineReachable(online)
          setPhase("app")
        }
      } catch (e) {
        const msg =
          e instanceof Error && e.name === "TimeoutError"
            ? `Engine did not respond within 15s at ${ENGINE_BASE || "http://127.0.0.1:7777"}. ${START_ENGINE_HELP}`
            : e instanceof Error
              ? e.message
              : String(e)
        setErr(msg)
        setPhase("error")
      }
    }
    void boot()

    return () => {
      cancelled = true
      unsubscribeAuth?.()
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
        engineBase={ENGINE_BASE || "http://127.0.0.1:7777"}
        onFinished={() => {
          void initializeSupabase().then((ok) => {
            if (ok) {
              void fetch(engineUrl("/health"), {
                signal: AbortSignal.timeout(5_000),
                cache: "no-store",
              })
                .then((response) => setIsEngineReachable(response.ok))
                .catch(() => setIsEngineReachable(false))
              setPhase("app")
            }
            else {
              setErr("Saved, but Supabase keys could not be read from the engine.")
              setPhase("error")
            }
          })
        }}
      />
    )
  }

  // Hosted Vercel (or other remote origin) must pass Chrome PNA via the gate.
  // Local engine UI is same-origin — never show the gate.
  if (phase === "app" && isEngineReachable === false && !isLocalEngineOrigin()) {
    return (
      <EngineConnectionGate
        onConnected={() => {
          setIsEngineReachable(true)
        }}
      />
    )
  }

  return <App />
}
