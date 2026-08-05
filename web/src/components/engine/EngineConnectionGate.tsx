import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Circle, Download, Loader2, LogIn, PlugZap, ShieldAlert, User } from "lucide-react"
import { ENGINE_BASE } from "@/lib/engine-base"
import { useAuth } from "@/hooks/use-auth"
import {
  buildEngineOfflineMessage,
  hasLocalNetworkAccessFlag,
  markLocalNetworkAccessGranted,
  probeEngineConnection,
} from "@/lib/engine-connection"
import {
  buildGithubInstallerDownloadUrl,
  openInstallerDownload,
  requestEngineInstallerDownloadUrl,
} from "@/lib/engine-installer"
import { useEngineRelease } from "@/hooks/use-engine-release"

type EngineStatus = "idle" | "checking" | "connected" | "browser_blocked" | "engine_offline"

interface EngineConnectionGateProps {
  onConnected: () => void
}

function isBrowserBlocked(error: string | null): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("aborted")
}

async function openGoogleSignIn(signInWithGoogle: () => Promise<{ url?: string | null }>): Promise<void> {
  const result = await signInWithGoogle()
  const url = result?.url
  if (!url) {
    throw new Error("No login URL received. Check Supabase Google provider and redirect URLs.")
  }
  const w = window as Window & { ipcRenderer?: { invoke: (ch: string, ...args: unknown[]) => Promise<unknown> } }
  if (w.ipcRenderer) {
    await w.ipcRenderer.invoke("open-external-url", url)
    return
  }
  window.location.assign(url)
}

function StatusRow({
  icon,
  label,
  detail,
  tone,
}: {
  icon: React.ReactNode
  label: string
  detail: string
  tone: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
      {icon}
      <div className="min-w-0">
        <p className={`text-sm font-medium ${tone}`}>{label}</p>
        <p className="truncate text-xs text-gray-500">{detail}</p>
      </div>
    </div>
  )
}

export function EngineConnectionGate({ onConnected }: EngineConnectionGateProps) {
  const { hasSession, user, signInWithGoogle, loading: authLoading } = useAuth()
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("idle")
  const [detail, setDetail] = useState<string | null>(null)
  const [engineVersion, setEngineVersion] = useState<string | null>(null)
  const [isDownloadBusy, setIsDownloadBusy] = useState(false)
  const [signInBusy, setSignInBusy] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const latestReleaseQuery = useEngineRelease({ enabled: hasSession })
  const latestVersion = latestReleaseQuery.data?.version?.trim() ?? ""

  const accountEmail = user?.email ?? user?.user_metadata?.email ?? null
  const isEngineConnected = engineStatus === "connected"

  const tryConnect = useCallback(async (): Promise<boolean> => {
    if (!hasSession) return false
    setEngineStatus("checking")
    setDetail(null)
    const probe = await probeEngineConnection()
    if (probe.online) {
      markLocalNetworkAccessGranted()
      setEngineVersion(probe.health?.version ?? null)
      setEngineStatus("connected")
      onConnected()
      return true
    }
    const message = buildEngineOfflineMessage(probe.engineBase, probe.error)
    setDetail(message)
    setEngineStatus(isBrowserBlocked(probe.error) ? "browser_blocked" : "engine_offline")
    return false
  }, [hasSession, onConnected])

  useEffect(() => {
    if (!hasSession || !hasLocalNetworkAccessFlag()) return
    void tryConnect()
    const intervalId = window.setInterval(() => {
      void tryConnect()
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [hasSession, tryConnect])

  async function handleGoogleSignIn(): Promise<void> {
    try {
      setSignInError(null)
      setSignInBusy(true)
      await openGoogleSignIn(signInWithGoogle)
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : "Sign in failed")
      setSignInBusy(false)
    }
  }

  async function handleDownloadInstaller(): Promise<void> {
    try {
      setIsDownloadBusy(true)
      const result = await requestEngineInstallerDownloadUrl()
      openInstallerDownload(result.downloadUrl)
    } catch {
      openInstallerDownload(buildGithubInstallerDownloadUrl(latestVersion || "latest"))
    } finally {
      setIsDownloadBusy(false)
    }
  }

  const engineLabel =
    engineStatus === "checking"
      ? "Checking engine…"
      : engineStatus === "connected"
        ? `Engine connected${engineVersion ? ` · v${engineVersion}` : ""}`
        : engineStatus === "browser_blocked"
          ? "Browser blocked localhost"
          : engineStatus === "engine_offline"
            ? "Engine not running"
            : "Engine not connected"

  const engineTone =
    engineStatus === "connected"
      ? "text-emerald-400"
      : engineStatus === "checking"
        ? "text-cyan-300"
        : engineStatus === "idle"
          ? "text-gray-400"
          : "text-amber-300"

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1A1A1A] p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#06090d]/95 p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-white">CTrack Publish</h1>
          <p className="mt-1 text-sm text-gray-400">Sign in, then connect your local engine</p>
        </div>

        <div className="mb-4 space-y-3">
          <StatusRow
            icon={
              hasSession ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              ) : (
                <User className="h-5 w-5 shrink-0 text-gray-500" />
              )
            }
            label={hasSession ? "Signed in" : "Not signed in"}
            detail={hasSession ? accountEmail ?? "Google account linked" : "Use your CTrack Google account"}
            tone={hasSession ? "text-emerald-400" : "text-gray-400"}
          />

          <StatusRow
            icon={
              engineStatus === "checking" ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-cyan-400" />
              ) : engineStatus === "connected" ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              ) : engineStatus === "browser_blocked" ? (
                <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-gray-500" />
              )
            }
            label={engineLabel}
            detail={ENGINE_BASE || "http://127.0.0.1:7777"}
            tone={engineTone}
          />
        </div>

        {!hasSession ? (
          <button
            type="button"
            onClick={() => void handleGoogleSignIn()}
            disabled={signInBusy || authLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signInBusy || authLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            Sign in with Google
          </button>
        ) : !isEngineConnected ? (
          <button
            type="button"
            onClick={() => void tryConnect()}
            disabled={engineStatus === "checking"}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0096D6] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0096D6]/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {engineStatus === "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlugZap className="h-4 w-4" />
            )}
            Connect local engine
          </button>
        ) : null}

        {signInError && <p className="mt-3 text-xs text-red-300">{signInError}</p>}

        {hasSession && engineStatus === "browser_blocked" && (
          <p className="mt-4 text-xs leading-relaxed text-amber-200/90">
            Click <span className="font-medium">Connect local engine</span>, then choose{" "}
            <span className="font-medium">Allow</span> when Chrome asks for local network access. Or: lock icon → Site
            settings → Local network access → Allow.
          </p>
        )}

        {hasSession && engineStatus === "engine_offline" && (
          <p className="mt-4 text-xs leading-relaxed text-gray-400">
            Start <span className="text-gray-200">CTrack Engine</span> from the Start Menu (tray can show Signed in
            before the browser is allowed to talk to port 7777).
          </p>
        )}

        {detail && hasSession && !isEngineConnected && (
          <p className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-400">{detail}</p>
        )}

        <details className="mt-6 text-xs text-gray-500">
          <summary className="cursor-pointer text-gray-400 hover:text-gray-300">Need the engine installer?</summary>
          <div className="mt-3 space-y-2">
            {latestVersion && <p>Latest version: v{latestVersion}</p>}
            <button
              type="button"
              onClick={() => void handleDownloadInstaller()}
              disabled={isDownloadBusy || !hasSession}
              className="inline-flex items-center gap-2 text-cyan-300 hover:text-cyan-200 disabled:opacity-50"
            >
              {isDownloadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download installer
            </button>
            {!hasSession && <p className="text-gray-500">Sign in first to download via your account.</p>}
          </div>
        </details>
      </div>
    </div>
  )
}
