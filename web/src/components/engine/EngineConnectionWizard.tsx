import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Download, Link2, Loader2, RefreshCw, Wrench } from "lucide-react"
import { ENGINE_BASE } from "@/lib/engine-ipc-shim"
import {
  openInstallerDownload,
  requestEngineInstallerDownloadUrl,
} from "@/lib/engine-installer"
import { useEnginePairing } from "@/hooks/use-engine-pairing"
import { useEngineRelease } from "@/hooks/use-engine-release"
import { EngineDiagnostics } from "@/components/engine/EngineDiagnostics"

interface EngineConnectionWizardProps {
  onConnected?: () => void
}

type WizardStepId = "detect" | "download" | "install" | "pair" | "verify"

interface WizardStep {
  id: WizardStepId
  title: string
  description: string
}

const WIZARD_STEPS: WizardStep[] = [
  {
    id: "detect",
    title: "Detect offline",
    description: "The web app cannot reach your local engine yet.",
  },
  {
    id: "download",
    title: "Download installer",
    description: "Get the latest signed installer using your current login session.",
  },
  {
    id: "install",
    title: "Install engine",
    description: "Run the installer, then launch the tray shortcut.",
  },
  {
    id: "pair",
    title: "Pair engine",
    description: "Link this workstation to your account for secure downloads and updates.",
  },
  {
    id: "verify",
    title: "Verify connection",
    description: "Retry health checks and confirm the engine is ready.",
  },
]

async function verifyEngineHealth(): Promise<{ version?: string; activeExrBackend?: string }> {
  const response = await fetch(`${ENGINE_BASE}/health`, {
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`)
  }
  return (await response.json()) as { version?: string; activeExrBackend?: string }
}

export function EngineConnectionWizard({ onConnected }: EngineConnectionWizardProps) {
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [pairToken, setPairToken] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [engineVersion, setEngineVersion] = useState<string | null>(null)
  const [exrBackend, setExrBackend] = useState<string | null>(null)
  const [isDownloadBusy, setIsDownloadBusy] = useState(false)
  const [isVerifyBusy, setIsVerifyBusy] = useState(false)
  const { pairStatusQuery, initializePairingMutation, completePairingMutation } = useEnginePairing({
    enabled: true,
  })
  const latestReleaseQuery = useEngineRelease({ enabled: true })
  const latestVersion = latestReleaseQuery.data?.version?.trim() ?? ""

  const activeStep = WIZARD_STEPS[activeStepIndex]
  const isPaired = pairStatusQuery.data?.paired ?? false

  async function handleDownloadInstaller(): Promise<void> {
    try {
      setDownloadError(null)
      setIsDownloadBusy(true)
      const result = await requestEngineInstallerDownloadUrl()
      openInstallerDownload(result.downloadUrl)
      setActiveStepIndex((current) => Math.max(current, 2))
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsDownloadBusy(false)
    }
  }

  async function handleInitPairing(): Promise<void> {
    const result = await initializePairingMutation.mutateAsync()
    setPairToken(result.pairToken)
    setPairingCode(result.pairingCode ?? null)
    setActiveStepIndex((current) => Math.max(current, 3))
  }

  async function handleCompletePairing(): Promise<void> {
    if (!pairToken) {
      throw new Error("Start pairing first to request a pair token.")
    }
    await completePairingMutation.mutateAsync({ pairToken })
    await pairStatusQuery.refetch()
    setActiveStepIndex((current) => Math.max(current, 4))
  }

  async function handleVerifyConnection(): Promise<void> {
    try {
      setVerifyError(null)
      setIsVerifyBusy(true)
      const health = await verifyEngineHealth()
      setEngineVersion(health.version ?? null)
      setExrBackend(health.activeExrBackend ?? null)
      onConnected?.()
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsVerifyBusy(false)
    }
  }

  const canMovePrev = activeStepIndex > 0
  const canMoveNext = activeStepIndex < WIZARD_STEPS.length - 1

  const statusTone = useMemo(() => {
    if (activeStep.id === "verify" && !verifyError && engineVersion) return "ok"
    if (activeStep.id === "pair" && isPaired) return "ok"
    return "warn"
  }, [activeStep.id, engineVersion, isPaired, verifyError])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1A1A1A] p-6 text-gray-100">
      <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-[#06090d]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Connect your local engine</h1>
            <p className="mt-2 text-sm text-gray-400">
              The browser is signed in, but it cannot reach `{ENGINE_BASE}` yet. Follow the steps below to install and
              pair this workstation.
            </p>
          </div>
          <div
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-medium ${
              statusTone === "ok"
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                : "border-amber-400/40 bg-amber-500/10 text-amber-200"
            }`}
          >
            {statusTone === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {statusTone === "ok" ? "Ready to continue" : "Action required"}
          </div>
        </div>

        <ol className="mb-6 grid gap-2 sm:grid-cols-5">
          {WIZARD_STEPS.map((step, index) => {
            const isActive = index === activeStepIndex
            const isComplete = index < activeStepIndex
            return (
              <li
                key={step.id}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  isActive
                    ? "border-[#0096D6]/70 bg-[#0096D6]/15 text-white"
                    : isComplete
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                      : "border-white/10 bg-white/5 text-gray-400"
                }`}
              >
                <div className="font-semibold">{step.title}</div>
                <div className="mt-1 leading-relaxed">{step.description}</div>
              </li>
            )
          })}
        </ol>

        <section className="rounded-xl border border-white/10 bg-black/20 p-4">
          {activeStep.id === "detect" && (
            <div className="space-y-3 text-sm">
              <p className="text-gray-300">
                We could not connect to your engine over localhost. This usually means the engine is not installed,
                the tray process is not running, or localhost access is blocked.
              </p>
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                <p className="font-medium">Troubleshoot quickly</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  <li>Confirm CTrack Engine is installed on this machine.</li>
                  <li>Start "CTrack Engine Tray" from the Start Menu.</li>
                  <li>Allow browser private-network access to localhost when prompted.</li>
                </ul>
              </div>
            </div>
          )}

          {activeStep.id === "download" && (
            <div className="space-y-3 text-sm">
              <p className="text-gray-300">
                Download the latest installer using your authenticated session. The download link is short-lived and
                generated by the `engine-download` edge function.
              </p>
              {latestVersion && (
                <p className="rounded border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
                  Latest published engine: <span className="font-semibold">v{latestVersion}</span>
                  {latestReleaseQuery.data?.releaseNotes ? (
                    <span className="mt-1 block text-gray-300">{latestReleaseQuery.data.releaseNotes}</span>
                  ) : null}
                </p>
              )}
              {latestReleaseQuery.isError && (
                <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Could not load release metadata. You can still try downloading the latest installer.
                </p>
              )}
              <button
                type="button"
                onClick={() => void handleDownloadInstaller()}
                disabled={isDownloadBusy}
                className="inline-flex items-center gap-2 rounded-md bg-[#0096D6] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0096D6]/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDownloadBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download latest installer
              </button>
              {downloadError && (
                <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{downloadError}</p>
              )}
            </div>
          )}

          {activeStep.id === "install" && (
            <div className="space-y-3 text-sm text-gray-300">
              <p>Run the downloaded `.exe` and complete setup with default options.</p>
              <ol className="list-decimal space-y-1 pl-5 text-xs">
                <li>Open the installer from your Downloads folder.</li>
                <li>Finish setup, then launch the "CTrack Engine Tray" shortcut.</li>
                <li>Wait until the tray icon appears, then continue to pairing.</li>
              </ol>
            </div>
          )}

          {activeStep.id === "pair" && (
            <div className="space-y-3 text-sm">
              <p className="text-gray-300">
                Pairing links this engine to your account so future updates can use secure device credentials.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleInitPairing()}
                  disabled={initializePairingMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {initializePairingMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  Request pair token
                </button>
                <button
                  type="button"
                  onClick={() => void handleCompletePairing()}
                  disabled={completePairingMutation.isPending || !pairToken}
                  className="inline-flex items-center gap-2 rounded-md bg-[#0096D6] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#0096D6]/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {completePairingMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Pair localhost engine
                </button>
              </div>
              {pairingCode && (
                <p className="rounded border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
                  Pairing code: <span className="font-semibold tracking-wider">{pairingCode}</span>
                </p>
              )}
              {(initializePairingMutation.error || completePairingMutation.error) && (
                <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {(initializePairingMutation.error || completePairingMutation.error) instanceof Error
                    ? (initializePairingMutation.error || completePairingMutation.error)?.message
                    : "Pairing failed. Confirm the engine tray is running and retry."}
                </p>
              )}
              {isPaired && (
                <p className="rounded border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  Engine paired{pairStatusQuery.data?.email ? ` as ${pairStatusQuery.data.email}` : ""}.
                </p>
              )}
            </div>
          )}

          {activeStep.id === "verify" && (
            <div className="space-y-3 text-sm">
              <p className="text-gray-300">Retry localhost health checks to verify install and pairing are complete.</p>
              <button
                type="button"
                onClick={() => void handleVerifyConnection()}
                disabled={isVerifyBusy}
                className="inline-flex items-center gap-2 rounded-md bg-[#0096D6] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0096D6]/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isVerifyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Retry engine connection
              </button>
              {verifyError && (
                <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{verifyError}</p>
              )}
              {engineVersion && (
                <div className="rounded border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  <p>Engine reachable: v{engineVersion}</p>
                  <p>EXR backend: {exrBackend ?? "unknown"}</p>
                </div>
              )}
            </div>
          )}
        </section>

        <details className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-gray-300">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-gray-200">
            <Wrench className="h-3.5 w-3.5" />
            Troubleshoot
          </summary>
          <div className="mt-3 space-y-3">
            <EngineDiagnostics />
            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-gray-300">
              <p className="font-semibold text-gray-100">Browser + firewall guidance</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <span className="font-medium text-gray-100">PNA/CORS:</span> allow Private Network Access for this
                  site and ensure engine `CTRACK_WEB_ORIGINS` includes the current web URL.
                </li>
                <li>
                  <span className="font-medium text-gray-100">Windows Firewall:</span> allow inbound TCP `127.0.0.1:7777`
                  for CTrack Engine if your security policy blocks localhost loopback.
                </li>
                <li>
                  <span className="font-medium text-gray-100">Port conflicts:</span> close any process already using
                  port `7777`, then relaunch the tray from Start Menu.
                </li>
              </ul>
            </div>
          </div>
        </details>

        <div className="mt-4 flex justify-between">
          <button
            type="button"
            onClick={() => canMovePrev && setActiveStepIndex((current) => current - 1)}
            disabled={!canMovePrev}
            className="rounded-md border border-white/20 px-3 py-2 text-xs text-gray-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => canMoveNext && setActiveStepIndex((current) => current + 1)}
            disabled={!canMoveNext}
            className="rounded-md border border-white/20 px-3 py-2 text-xs text-gray-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
