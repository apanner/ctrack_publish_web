"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, ExternalLink, MonitorSmartphone } from "lucide-react"
import { isLocalEngineOrigin } from "@/lib/engine-base"
import { probeEngineConnection } from "@/lib/engine-connection"
import {
  buildGithubInstallerDownloadUrl,
  openInstallerDownload,
  requestEngineInstallerDownloadUrl,
} from "@/lib/engine-installer"
import { useAuth } from "@/hooks/use-auth"

const LOCAL_UI = "http://127.0.0.1:7777/"
const PROTOCOL_OPEN = "ctrack://open"

/**
 * Shown only on the hosted Vercel site. Artists should use the local gateway —
 * this banner never drives localhost from HTTPS (avoids Chrome PNA).
 */
export function HostedGatewayBanner() {
  const { hasSession } = useAuth()
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => {
    if (isLocalEngineOrigin()) return
    let cancelled = false
    void (async () => {
      // Best-effort: only works if user already granted PNA; failure means "use local app".
      const probe = await probeEngineConnection(2500)
      if (!cancelled) setEngineOnline(probe.online)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenLocal = useCallback(() => {
    // Prefer custom protocol (installer-registered), fall back to http.
    window.location.href = PROTOCOL_OPEN
    window.setTimeout(() => {
      window.open(LOCAL_UI, "_blank", "noopener,noreferrer")
    }, 600)
  }, [])

  const handleInstall = useCallback(async () => {
    setDownloadError(null)
    setDownloadBusy(true)
    try {
      if (hasSession) {
        const result = await requestEngineInstallerDownloadUrl()
        openInstallerDownload(result.downloadUrl)
      } else {
        openInstallerDownload(buildGithubInstallerDownloadUrl())
      }
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e))
      openInstallerDownload(buildGithubInstallerDownloadUrl())
    } finally {
      setDownloadBusy(false)
    }
  }, [hasSession])

  if (isLocalEngineOrigin()) return null

  return (
    <div className="shrink-0 border-b border-cyan-500/30 bg-cyan-950/40 px-4 py-2.5 text-sm text-cyan-100">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <p className="font-medium text-cyan-50">
              {engineOnline
                ? "CTrack Engine is on this PC — open the local app to publish"
                : "Publish runs on your local CTrack Engine (one-time install)"}
            </p>
            <p className="text-xs text-cyan-200/80">
              Use http://127.0.0.1:7777/ (same origin). This website does not talk to localhost from HTTPS.
            </p>
            {downloadError ? <p className="mt-1 text-xs text-amber-200">{downloadError}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleOpenLocal}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#24E1B1] px-3 py-1.5 text-xs font-semibold text-[#041812] hover:bg-[#1FC99E]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open local CTrack
          </button>
          {!engineOnline ? (
            <button
              type="button"
              disabled={downloadBusy}
              onClick={() => void handleInstall()}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              {downloadBusy ? "Preparing…" : "Install engine"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
