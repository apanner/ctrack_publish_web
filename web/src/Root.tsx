import { useEffect, useState } from "react"
import App from "./App"
import { FirstRunSetup } from "@/components/setup/FirstRunSetup"
import { EngineConnectionWizard } from "@/components/engine/EngineConnectionWizard"
import { LinkEnginePage } from "@/pages/LinkEnginePage"
import { initializeSupabase, supabase } from "@/lib/supabase"

const ENGINE_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_ENGINE_URL) ||
  "http://127.0.0.1:7777"
const START_ENGINE_HELP =
  "Run scripts\\start-engine-tray.vbs (or the Start CTrack Engine Tray shortcut), then retry."

export function Root() {
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/link-engine") {
    return <LinkEnginePage />
  }
  return <RootApp />
}

function RootApp() {
  const [phase, setPhase] = useState<"loading" | "setup" | "app" | "error">("loading")
  const [err, setErr] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isEngineReachable, setIsEngineReachable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribeAuth: (() => void) | null = null

    async function refreshAuthState(): Promise<void> {
      const { data } = await supabase.auth.getSession()
      if (!cancelled) {
        setIsAuthenticated(Boolean(data.session?.user))
      }
    }

    async function probeEngineReachability(): Promise<boolean> {
      try {
        const healthRes = await fetch(`${ENGINE_BASE}/health`, {
          signal: AbortSignal.timeout(5_000),
          cache: "no-store",
        })
        if (!healthRes.ok) return false
        const health = (await healthRes.json()) as { status?: string; pythonReady?: boolean }
        return health.status === "ok" && health.pythonReady === true
      } catch {
        return false
      }
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
          } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!cancelled) setIsAuthenticated(Boolean(session?.user))
          })
          unsubscribeAuth = () => subscription.unsubscribe()
          const online = await probeEngineReachability()
          if (!cancelled) {
            setIsEngineReachable(online)
            setPhase("app")
          }
          return
        }
        const stRes = await fetch(`${ENGINE_BASE}/api/setup/status`, {
          signal: AbortSignal.timeout(15_000),
        })
        if (!stRes.ok) {
          throw new Error(
            `Cannot reach engine at ${ENGINE_BASE} (${stRes.status}). ${START_ENGINE_HELP}`
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
        } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!cancelled) setIsAuthenticated(Boolean(session?.user))
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
            ? `Engine did not respond within 15s at ${ENGINE_BASE}. ${START_ENGINE_HELP}`
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
        engineBase={ENGINE_BASE}
        onFinished={() => {
          void initializeSupabase().then((ok) => {
            if (ok) {
              void supabase.auth.getSession().then(({ data }) => setIsAuthenticated(Boolean(data.session?.user)))
              void fetch(`${ENGINE_BASE}/health`, {
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

  if (phase === "app" && isAuthenticated && isEngineReachable === false) {
    return (
      <EngineConnectionWizard
        onConnected={() => {
          setIsEngineReachable(true)
        }}
      />
    )
  }

  return <App />
}
