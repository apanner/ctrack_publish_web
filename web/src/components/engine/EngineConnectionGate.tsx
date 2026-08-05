import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Circle, Download, Loader2, PlugZap, ShieldAlert } from "lucide-react"
import { ENGINE_BASE } from "@/lib/engine-ipc-shim"
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

type ConnectionStatus = "idle" | "checking" | "connected" | "browser_blocked" | "engine_offline"

interface EngineConnectionGateProps {
  onConnected: () => void
}

function isBrowserBlocked(error: string | null): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("aborted")
}

export function EngineConnectionGate({ onConnected }: EngineConnectionGateProps) {
  const [status, setStatus] = useState<ConnectionStatus>("idle")
  const [detail, setDetail] = useState<string | null>(null)
  const [engineVersion, setEngineVersion] = useState<string | null>(null)
  const [isDownloadBusy, setIsDownloadBusy] = useState(false)
  const latestReleaseQuery = useEngineRelease({ enabled: true })
  const latestVersion = latestReleaseQuery.data?.version?.trim() ?? ""

  const tryConnect = useCallback(async (): Promise<boolean> => {
    setStatus("checking")
    setDetail(null)
    const probe = await probeEngineConnection()
    if (probe.online) {
      markLocalNetworkAccessGranted()
      setEngineVersion(probe.health?.version ?? null)
      setStatus("connected")
      onConnected()
      return true
    }
    const message = buildEngineOfflineMessage(probe.engineBase, probe.error)
    setDetail(message)
    setStatus(isBrowserBlocked(probe.error) ? "browser_blocked" : "engine_offline")
    return false
  }, [onConnected])

  useEffect(() => {
    if (!hasLocalNetworkAccessFlag()) return
    void tryConnect()
    const intervalId = window.setInterval(() => {
      void tryConnect()
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [tryConnect])

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

  const statusLabel =
    status === "checking"
      ? "Checking connection…"
      : status === "connected"
        ? `Connected${engineVersion ? ` · v${engineVersion}` : ""}`
        : status === "browser_blocked"
          ? "Browser blocked localhost"
          : status === "engine_offline"
            ? "Engine not running"
            : "Not connected"

  const statusTone =
    status === "connected"
      ? "text-emerald-400"
      : status === "checking"
        ? "text-cyan-300"
        : status === "idle"
          ? "text-gray-400"
          : "text-amber-300"

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1A1A1A] p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#06090d]/95 p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-white">CTrack Publish</h1>
          <p className="mt-1 text-sm text-gray-400">Local engine connection</p>
        </div>

        <div className="mb-6 flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
          {status === "checking" ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-cyan-400" />
          ) : status === "connected" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
          ) : status === "browser_blocked" ? (
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" />
          ) : (
            <Circle className="h-5 w-5 shrink-0 text-gray-500" />
          )}
          <div className="min-w-0">
            <p className={`text-sm font-medium ${statusTone}`}>{statusLabel}</p>
            <p className="truncate font-mono text-xs text-gray-500">{ENGINE_BASE}</p>
          </div>
        </div>

        {status !== "connected" && (
          <button
            type="button"
            onClick={() => void tryConnect()}
            disabled={status === "checking"}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0096D6] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0096D6]/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlugZap className="h-4 w-4" />
            )}
            Connect local engine
          </button>
        )}

        {status === "browser_blocked" && (
          <p className="mt-4 text-xs leading-relaxed text-amber-200/90">
            Chrome must allow this site to reach your PC. Click <span className="font-medium">Connect</span> above,
            then choose <span className="font-medium">Allow</span> in the prompt. If you do not see a prompt: lock icon
            in the address bar → Site settings → Local network access → Allow.
          </p>
        )}

        {status === "engine_offline" && (
          <p className="mt-4 text-xs leading-relaxed text-gray-400">
            Start <span className="text-gray-200">CTrack Engine</span> from the Start Menu, wait for the tray icon,
            then click Connect again.
          </p>
        )}

        {detail && status !== "connected" && (
          <p className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-400">{detail}</p>
        )}

        <details className="mt-6 text-xs text-gray-500">
          <summary className="cursor-pointer text-gray-400 hover:text-gray-300">Need the engine installer?</summary>
          <div className="mt-3 space-y-2">
            {latestVersion && <p>Latest version: v{latestVersion}</p>}
            <button
              type="button"
              onClick={() => void handleDownloadInstaller()}
              disabled={isDownloadBusy}
              className="inline-flex items-center gap-2 text-cyan-300 hover:text-cyan-200"
            >
              {isDownloadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download installer
            </button>
          </div>
        </details>
      </div>
    </div>
  )
}
