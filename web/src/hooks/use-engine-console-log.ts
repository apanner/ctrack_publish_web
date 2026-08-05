import { useEffect, useRef } from "react"
import type { EngineHealthState } from "@/hooks/use-engine-health"
import { useAppLogStore } from "@/store/app-log-store"

/**
 * Writes engine connection / dependency status to the app console when state changes.
 */
export function useEngineConsoleLog(engineHealth: EngineHealthState): void {
  const addLog = useAppLogStore((s) => s.addLog)
  const lastSignatureRef = useRef<string>("")

  useEffect(() => {
    const signature = [
      engineHealth.isChecking ? "checking" : engineHealth.isOnline ? "online" : "offline",
      engineHealth.health?.version ?? "",
      engineHealth.missingDependencies.join(","),
      engineHealth.error ?? "",
      engineHealth.activeExrBackend ?? "",
    ].join("|")

    if (signature === lastSignatureRef.current) {
      return
    }
    lastSignatureRef.current = signature

    if (engineHealth.isChecking) {
      addLog("info", `[ENGINE] Checking connection to ${engineHealth.engineBase}…`)
      return
    }

    if (!engineHealth.isOnline) {
      addLog(
        "error",
        `[ENGINE] Offline — ${engineHealth.offlineHelpText ?? `Cannot reach ${engineHealth.engineBase}`}`,
      )
      return
    }

    const version = engineHealth.health?.version ? ` v${engineHealth.health.version}` : ""
    const paired = engineHealth.health?.paired ? " | account linked" : " | not paired (use tray Sign in)"
    addLog("info", `[ENGINE] Online${version}${paired} | EXR backend: ${engineHealth.activeExrBackend ?? "none"}`)

    if (engineHealth.missingDependencies.length > 0) {
      addLog("warn", `[ENGINE] Missing tools: ${engineHealth.missingDependencies.join(", ")}`)
      addLog("info", "[ENGINE] Engine will download FFmpeg/OIIO/OCIO automatically on startup or first publish")
    } else {
      addLog("info", "[ENGINE] Dependencies ready (FFmpeg, Python sidecar, runtime tools)")
    }
  }, [addLog, engineHealth])
}
