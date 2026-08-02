import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useEnginePairing } from "@/hooks/use-engine-pairing"
import { useEngineRelease } from "@/hooks/use-engine-release"
import { ENGINE_BASE } from "@/lib/engine-ipc-shim"
import {
  openInstallerDownload,
  probeEngineHealth,
  requestEngineInstallerDownloadUrl,
} from "@/lib/engine-installer"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

type LinkPhase = "login" | "install" | "linking" | "ready" | "error"

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
  const linkingStartedRef = useRef(false)
  const [hasSession, setHasSession] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [phase, setPhase] = useState<LinkPhase>(() => (readOAuthCode() ? "linking" : "login"))
  const [error, setError] = useState<string | null>(null)
  const [oauthBusy, setOauthBusy] = useState(() => !!readOAuthCode())
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null)
  const [localEngineVersion, setLocalEngineVersion] = useState<string | null>(null)
  const [isDownloadBusy, setIsDownloadBusy] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const { pairStatusQuery, initializePairingMutation } = useEnginePairing({
    enabled: hasSession,
  })
  const latestReleaseQuery = useEngineRelease({ enabled: hasSession })
  const latestVersion = latestReleaseQuery.data?.version?.trim() ?? ""

  useEffect(() => {
    void import("@/lib/supabase").then(({ initializeSupabase }) => initializeSupabase())
    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session?.user))
      setSessionReady(true)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session?.user))
      setSessionReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useLayoutEffect(() => {
    const code = readOAuthCode()
    if (!code || codeHandledRef.current) return
    codeHandledRef.current = true
    const url = new URL(window.location.href)
    url.searchParams.delete("code")
    url.searchParams.delete("state")
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
    void (async () => {
      try {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) throw exchangeError
        setHasSession(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign in failed")
        setPhase("error")
      } finally {
        setOauthBusy(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!hasSession || !sessionReady || oauthBusy) return
    let cancelled = false
    void (async () => {
      const health = await probeEngineHealth(ENGINE_BASE)
      if (cancelled) return
      setEngineOnline(health.online)
      setLocalEngineVersion(health.version ?? null)
      if (!health.online) {
        linkingStartedRef.current = false
        setPhase("install")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasSession, sessionReady, oauthBusy])

  useEffect(() => {
    if (!hasSession || !sessionReady || oauthBusy) return
    if (engineOnline === false) return
    if (pairStatusQuery.data?.paired) {
      setPhase("ready")
      return
    }
    if (linkingStartedRef.current) return
    let cancelled = false
    linkingStartedRef.current = true
    setPhase("linking")
    setError(null)
    void (async () => {
      try {
        const init = await initializePairingMutation.mutateAsync()
        if (cancelled) return
        const engineBase = ENGINE_BASE.replace(/\/+$/, "")
        const redirectUrl = `${engineBase}/api/auth/pair-redirect?pairToken=${encodeURIComponent(init.pairToken)}`
        window.location.replace(redirectUrl)
      } catch (err) {
        if (cancelled) return
        linkingStartedRef.current = false
        const message = err instanceof Error ? err.message : "Could not link this workstation"
        const health = await probeEngineHealth(ENGINE_BASE)
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
  }, [
    hasSession,
    sessionReady,
    oauthBusy,
    engineOnline,
    pairStatusQuery.data?.paired,
    initializePairingMutation,
  ])

  const handleGoogleSignIn = async () => {
    setError(null)
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

  const handleRetryLinking = async () => {
    linkingStartedRef.current = false
    setError(null)
    setDownloadError(null)
    const health = await probeEngineHealth(ENGINE_BASE)
    setEngineOnline(health.online)
    setLocalEngineVersion(health.version ?? null)
    if (!health.online) {
      setPhase("install")
      return
    }
    setPhase("linking")
  }

  if (!sessionReady || oauthBusy) {
    return (
      <PageShell>
        <Spinner className="h-8 w-8 text-[#24E1B1]" />
        <p className="text-gray-300">Completing sign in…</p>
      </PageShell>
    )
  }

  if (phase === "ready") {
    return (
      <PageShell>
        <p className="text-2xl font-semibold text-[#24E1B1]">Engine linked</p>
        <p className="max-w-sm text-center text-gray-300">
          This workstation is connected. Close this tab — the engine tray will show Ready.
        </p>
        {pairStatusQuery.data?.email && (
          <p className="text-sm text-gray-500">Signed in as {pairStatusQuery.data.email}</p>
        )}
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
            Engine Tray from the Start Menu.
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
        <Button type="button" variant="outline" onClick={() => void handleRetryLinking()} className="border-white/20 text-white">
          I installed it — retry linking
        </Button>
        {downloadError && <p className="max-w-md text-center text-sm text-red-300">{downloadError}</p>}
        {error && <p className="max-w-md text-center text-sm text-amber-200">{error}</p>}
      </PageShell>
    )
  }

  if (phase === "linking") {
    return (
      <PageShell>
        <Spinner className="h-8 w-8 text-[#24E1B1]" />
        <p className="text-gray-300">Linking engine to your account…</p>
        <p className="max-w-sm text-center text-xs text-gray-500">
          Keep CTrack Engine running. Your browser will open the local engine to finish linking.
        </p>
      </PageShell>
    )
  }

  if (phase === "error") {
    return (
      <PageShell>
        <p className="max-w-md text-center text-red-300">{error ?? "Something went wrong"}</p>
        <Button type="button" onClick={() => void handleRetryLinking()} className="bg-[#0096D6] hover:bg-[#0096D6]/90">
          Try again
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
