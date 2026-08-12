import { useEffect, useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { initializeSupabase, supabase } from "@/lib/supabase"
import {
  buildPairRedirectUrl,
  completePairingRequest,
  initializePairingRequest,
  useEnginePairing,
} from "@/hooks/use-engine-pairing"
import { useEngineRelease } from "@/hooks/use-engine-release"
import { ENGINE_BASE } from "@/lib/engine-ipc-shim"
import { markLocalNetworkAccessGranted } from "@/lib/engine-connection"
import {
  openInstallerDownload,
  probeEngineHealth,
  requestEngineInstallerDownloadUrl,
} from "@/lib/engine-installer"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

type LinkPhase = "boot" | "login" | "checking" | "install" | "linking" | "ready" | "error"

function readOAuthCode(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("code")
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#1A1A1A] p-6 text-white">
      {children}
    </div>
  )
}

export function LinkEnginePage() {
  const codeHandledRef = useRef(false)
  const pairAttemptRef = useRef(0)
  const [supabaseReady, setSupabaseReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [phase, setPhase] = useState<LinkPhase>("boot")
  const [statusText, setStatusText] = useState("Starting…")
  const [error, setError] = useState<string | null>(null)
  const [oauthBusy, setOauthBusy] = useState(() => !!readOAuthCode())
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null)
  const [localEngineVersion, setLocalEngineVersion] = useState<string | null>(null)
  const [isDownloadBusy, setIsDownloadBusy] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [pairNonce, setPairNonce] = useState(0)
  const [accountEmail, setAccountEmail] = useState<string | null>(null)

  const { pairStatusQuery } = useEnginePairing({
    enabled: hasSession && engineOnline === true,
    refetchIntervalMs: 5_000,
  })
  const latestReleaseQuery = useEngineRelease({ enabled: hasSession })
  const latestVersion = latestReleaseQuery.data?.version?.trim() ?? ""
  const isPaired = Boolean(pairStatusQuery.data?.paired)

  // 1) Auth boot — real client before any OAuth exchange
  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    void (async () => {
      setStatusText("Connecting to CTrack…")
      const ok = await initializeSupabase()
      if (cancelled) return
      if (!ok) {
        setError(
          "Missing Supabase config. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (same project as ctrack_v0)."
        )
        setPhase("error")
        setOauthBusy(false)
        setSessionReady(true)
        setSupabaseReady(false)
        return
      }
      setSupabaseReady(true)

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return
        setHasSession(Boolean(session?.user))
        setSessionReady(true)
        const email = session?.user?.email ?? null
        if (email) setAccountEmail(email)
      })
      unsubscribe = () => subscription.unsubscribe()

      const code = readOAuthCode()
      if (code && !codeHandledRef.current) {
        codeHandledRef.current = true
        setStatusText("Completing Google sign-in…")
        const url = new URL(window.location.href)
        url.searchParams.delete("code")
        url.searchParams.delete("state")
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
        try {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (cancelled) return
          if (exchangeError) throw exchangeError
          setHasSession(true)
          setSessionReady(true)
          setAccountEmail(data.session?.user?.email ?? null)
        } catch (err) {
          if (cancelled) return
          setError(err instanceof Error ? err.message : "Sign in failed")
          setPhase("error")
          setSessionReady(true)
        } finally {
          if (!cancelled) setOauthBusy(false)
        }
        return
      }

      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      setHasSession(Boolean(data.session?.user))
      setSessionReady(true)
      setAccountEmail(data.session?.user?.email ?? null)
      setOauthBusy(false)
      if (!data.session?.user) setPhase("login")
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  // 2) Probe local engine only after session is ready
  useEffect(() => {
    if (!hasSession || !sessionReady || oauthBusy) return
    let cancelled = false
    setPhase("checking")
    setStatusText("Looking for CTrack Engine on this PC…")
    setEngineOnline(null)
    void (async () => {
      const health = await probeEngineHealth(ENGINE_BASE)
      if (cancelled) return
      setEngineOnline(health.online)
      setLocalEngineVersion(health.version ?? null)
      if (health.online) markLocalNetworkAccessGranted()
      else setPhase("install")
    })()
    return () => {
      cancelled = true
    }
  }, [hasSession, sessionReady, oauthBusy, pairNonce])

  // 3) Pair once engine is online — no permanent lock (StrictMode-safe via attempt id)
  useEffect(() => {
    if (!hasSession || !sessionReady || oauthBusy) return
    if (engineOnline !== true) return
    if (pairStatusQuery.isLoading) {
      setPhase("checking")
      setStatusText("Checking whether this PC is already linked…")
      return
    }
    if (isPaired) {
      setPhase("ready")
      return
    }

    let cancelled = false
    const attemptId = ++pairAttemptRef.current
    setPhase("linking")
    setError(null)
    setStatusText("Creating a secure link…")

    void (async () => {
      try {
        const init = await initializePairingRequest()
        if (cancelled || attemptId !== pairAttemptRef.current) return

        setStatusText("Connecting engine to your account…")
        try {
          await completePairingRequest(init.pairToken)
          if (cancelled || attemptId !== pairAttemptRef.current) return
          markLocalNetworkAccessGranted()
          setPhase("ready")
          return
        } catch {
          if (cancelled || attemptId !== pairAttemptRef.current) return
          setStatusText("Opening local engine to finish linking…")
          window.location.replace(buildPairRedirectUrl(init.pairToken))
        }
      } catch (err) {
        if (cancelled || attemptId !== pairAttemptRef.current) return
        const message = err instanceof Error ? err.message : "Could not link this workstation"
        const health = await probeEngineHealth(ENGINE_BASE)
        if (cancelled || attemptId !== pairAttemptRef.current) return
        if (!health.online) {
          setEngineOnline(false)
          setPhase("install")
          setError("Engine is not running on this PC. Install and start the tray, then retry linking.")
          return
        }
        setError(message)
        setPhase("error")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hasSession, sessionReady, oauthBusy, engineOnline, pairStatusQuery.isLoading, isPaired, pairNonce])

  const handleGoogleSignIn = async () => {
    setError(null)
    setStatusText("Opening Google…")
    const ok = await initializeSupabase()
    if (!ok) {
      setError(
        "Missing Supabase config. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (same project as ctrack_v0)."
      )
      setPhase("error")
      return
    }
    const redirectTo = `${window.location.origin}/link-engine`
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    })
    if (signInError) {
      setError(signInError.message)
      setPhase("error")
    }
  }

  const handleDownloadInstaller = async () => {
    try {
      setDownloadError(null)
      setIsDownloadBusy(true)
      const result = await requestEngineInstallerDownloadUrl()
      openInstallerDownload(result.downloadUrl)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed")
    } finally {
      setIsDownloadBusy(false)
    }
  }

  const handleRetryLinking = () => {
    setError(null)
    setDownloadError(null)
    setEngineOnline(null)
    setPhase("checking")
    setStatusText("Retrying…")
    setPairNonce((n) => n + 1)
  }

  if (phase === "error") {
    const isConfigError = !supabaseReady
    return (
      <PageShell>
        <p className="max-w-md text-center text-red-300">{error ?? "Something went wrong"}</p>
        {isConfigError ? (
          <Button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-[#0096D6] hover:bg-[#0096D6]/90"
          >
            Retry
          </Button>
        ) : (
          <>
            <Button type="button" onClick={handleRetryLinking} className="bg-[#0096D6] hover:bg-[#0096D6]/90">
              Try again
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError(null)
                setPhase("login")
              }}
              className="border-white/20 text-white"
            >
              Sign in again
            </Button>
          </>
        )}
      </PageShell>
    )
  }

  if (!supabaseReady || !sessionReady || oauthBusy || phase === "boot") {
    return (
      <PageShell>
        <Spinner className="h-8 w-8 text-[#24E1B1]" />
        <p className="text-gray-300">{statusText || "Completing sign in…"}</p>
      </PageShell>
    )
  }

  if (phase === "ready") {
    const email = pairStatusQuery.data?.email ?? accountEmail
    return (
      <PageShell>
        <p className="text-2xl font-semibold text-[#24E1B1]">Engine linked</p>
        <p className="max-w-sm text-center text-gray-300">
          This workstation is connected. Close this tab — the engine tray will show Ready.
        </p>
        {email && <p className="text-sm text-gray-500">Signed in as {email}</p>}
      </PageShell>
    )
  }

  if (phase === "install") {
    return (
      <PageShell>
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-bold text-[#24E1B1]">Install CTrack Engine</h1>
          <p className="text-sm text-gray-400">
            We could not reach the engine on this PC. Download and run the latest installer, then start the CTrack
            Engine Tray from the Start Menu. Allow local network access if Chrome asks.
          </p>
          {latestVersion && (
            <p className="rounded border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
              Latest published engine: <span className="font-semibold">v{latestVersion}</span>
            </p>
          )}
          {localEngineVersion && (
            <p className="text-xs text-gray-500">Detected local version before offline: v{localEngineVersion}</p>
          )}
        </div>
        <Button
          type="button"
          onClick={() => void handleDownloadInstaller()}
          disabled={isDownloadBusy}
          className="min-w-[220px] bg-[#0096D6] hover:bg-[#0096D6]/90"
        >
          {isDownloadBusy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download engine installer
        </Button>
        <Button type="button" variant="outline" onClick={handleRetryLinking} className="border-white/20 text-white">
          I installed it — retry linking
        </Button>
        {downloadError && <p className="max-w-md text-center text-sm text-red-300">{downloadError}</p>}
        {error && <p className="max-w-md text-center text-sm text-amber-200">{error}</p>}
      </PageShell>
    )
  }

  if (phase === "checking" || phase === "linking") {
    return (
      <PageShell>
        <Spinner className="h-8 w-8 text-[#24E1B1]" />
        <p className="text-gray-300">{statusText}</p>
        <p className="max-w-sm text-center text-xs text-gray-500">
          Keep CTrack Engine running on this PC. If Chrome asks for local network access, choose Allow.
        </p>
        <Button type="button" variant="outline" onClick={handleRetryLinking} className="border-white/20 text-white">
          Cancel / retry
        </Button>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold text-[#24E1B1]">Link CTrack Engine</h1>
        <p className="max-w-sm text-sm text-gray-400">
          Sign in once to connect this workstation for updates and account linking.
        </p>
      </div>
      <Button
        type="button"
        onClick={() => void handleGoogleSignIn()}
        className="min-w-[220px] bg-white text-black hover:bg-gray-100"
      >
        Sign in with Google
      </Button>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </PageShell>
  )
}
