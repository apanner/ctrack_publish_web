import { useEffect, useMemo, useState } from "react"
import { DEFAULT_ENGINE_ORIGIN } from "@/lib/engine-base"
import {
  buildEngineOfflineMessage,
  probeEngineConnection,
  type EngineHealthPayload,
  type EngineProbeResult,
} from "@/lib/engine-connection"

export interface EngineHealthState {
  engineBase: string
  isChecking: boolean
  isOnline: boolean
  offlineHelpText: string | null
  isSetupComplete: boolean
  isPythonReady: boolean
  areDependenciesReady: boolean
  missingDependencies: string[]
  activeExrBackend: string | null
  nukeInstallCount: number
  lastCheckedAt: string | null
  error: string | null
  health: EngineHealthPayload | null
}

const CHECK_INTERVAL_MS = 10000

function mapProbeToState(probe: EngineProbeResult, isChecking: boolean): EngineHealthState {
  const health = probe.health
  return {
    engineBase: probe.engineBase,
    isChecking,
    isOnline: probe.online,
    offlineHelpText: probe.online ? null : buildEngineOfflineMessage(probe.engineBase, probe.error),
    isSetupComplete: !!health?.setupComplete,
    isPythonReady: !!health?.pythonReady,
    areDependenciesReady: probe.online && probe.missingDependencies.length === 0,
    missingDependencies: probe.missingDependencies,
    activeExrBackend: probe.activeExrBackend,
    nukeInstallCount: probe.nukeInstallCount,
    lastCheckedAt: new Date().toISOString(),
    error: probe.error,
    health,
  }
}

export function useEngineHealth(): EngineHealthState {
  const [probe, setProbe] = useState<EngineProbeResult | null>(null)
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function runCheck(): Promise<void> {
      setIsChecking(true)
      const next = await probeEngineConnection()
      if (!isMounted) return
      setProbe(next)
      setIsChecking(false)
    }

    void runCheck()
    const intervalId = window.setInterval(runCheck, CHECK_INTERVAL_MS)
    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  return useMemo(() => {
    if (!probe) {
      return {
        engineBase: DEFAULT_ENGINE_ORIGIN,
        isChecking: true,
        isOnline: false,
        offlineHelpText: null,
        isSetupComplete: false,
        isPythonReady: false,
        areDependenciesReady: false,
        missingDependencies: [],
        activeExrBackend: null,
        nukeInstallCount: 0,
        lastCheckedAt: null,
        error: null,
        health: null,
      }
    }
    return mapProbeToState(probe, isChecking)
  }, [probe, isChecking])
}
