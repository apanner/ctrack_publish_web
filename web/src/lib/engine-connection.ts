import { ENGINE_BASE } from "@/lib/engine-ipc-shim"

export interface EngineHealthPayload {
  status?: string
  service?: string
  version?: string
  pythonReady?: boolean
  platform?: string
  engineRoot?: string
  setupComplete?: boolean
  paired?: boolean
  ready?: boolean
  email?: string | null
}

export interface EngineRuntimePayload {
  ok?: boolean
  missing?: string[]
  activeExrBackend?: string | null
  nukeInstallations?: { label: string; exePath: string }[]
  error?: string
}

export interface EngineProbeResult {
  engineBase: string
  online: boolean
  health: EngineHealthPayload | null
  runtime: EngineRuntimePayload | null
  missingDependencies: string[]
  activeExrBackend: string | null
  nukeInstallCount: number
  error: string | null
}

const START_ENGINE_HINT =
  "Start CTrack Engine on this PC (tray: scripts\\start-engine-tray.vbs), then allow local network access in Chrome if prompted."

export function buildEngineOfflineMessage(engineBase: string, error: string | null): string {
  if (!error) {
    return `${START_ENGINE_HINT} Expected engine at ${engineBase}.`
  }
  if (error.includes("Failed to fetch") || error.includes("NetworkError") || error.includes("aborted")) {
    return `${START_ENGINE_HINT} Cannot reach ${engineBase} from this browser.`
  }
  return `${START_ENGINE_HINT} ${error}`
}

export async function probeEngineConnection(timeoutMs = 5000): Promise<EngineProbeResult> {
  const engineBase = ENGINE_BASE.replace(/\/+$/, "")
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const healthRes = await fetch(`${engineBase}/health`, {
      cache: "no-store",
      signal: controller.signal,
    })
    if (!healthRes.ok) {
      return {
        engineBase,
        online: false,
        health: null,
        runtime: null,
        missingDependencies: [],
        activeExrBackend: null,
        nukeInstallCount: 0,
        error: `Engine health returned HTTP ${healthRes.status}`,
      }
    }
    const health = (await healthRes.json()) as EngineHealthPayload
    if (health.status !== "ok") {
      const degradedReason =
        health.status === "degraded" && health.pythonReady === false
          ? "Engine process is running but the Python sidecar is not started. Restart CTrack Engine (tray or npm run dev:engine)."
          : "Engine health check did not report ok"
      return {
        engineBase,
        online: false,
        health,
        runtime: null,
        missingDependencies: [],
        activeExrBackend: null,
        nukeInstallCount: 0,
        error: degradedReason,
      }
    }
    if (!health.pythonReady) {
      return {
        engineBase,
        online: false,
        health,
        runtime: null,
        missingDependencies: [],
        activeExrBackend: null,
        nukeInstallCount: 0,
        error:
          "Engine HTTP responded but Python is not ready. Start CTrack Engine on this PC (tray or npm run dev:engine).",
      }
    }

    let runtime: EngineRuntimePayload | null = null
    try {
      const statusRes = await fetch(`${engineBase}/api/engine/status`, {
        cache: "no-store",
        signal: controller.signal,
      })
      if (statusRes.ok) {
        runtime = (await statusRes.json()) as EngineRuntimePayload
      }
    } catch {
      runtime = null
    }

    const missing = Array.isArray(runtime?.missing) ? runtime!.missing! : []
    return {
      engineBase,
      online: true,
      health,
      runtime,
      missingDependencies: missing,
      activeExrBackend: runtime?.activeExrBackend ?? null,
      nukeInstallCount: Array.isArray(runtime?.nukeInstallations) ? runtime!.nukeInstallations!.length : 0,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      engineBase,
      online: false,
      health: null,
      runtime: null,
      missingDependencies: [],
      activeExrBackend: null,
      nukeInstallCount: 0,
      error: message,
    }
  } finally {
    window.clearTimeout(timer)
  }
}
