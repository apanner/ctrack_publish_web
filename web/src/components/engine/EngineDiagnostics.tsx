import { useMemo, useState } from "react"
import { CheckCircle2, Copy, Download, Loader2, TriangleAlert } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { ENGINE_BASE } from "@/lib/engine-ipc-shim"

type DiagnosticStatus = "idle" | "running" | "pass" | "warn" | "fail"

interface DiagnosticItem {
  id: string
  title: string
  result: string
  status: DiagnosticStatus
}

interface EngineHealthPayload {
  version?: string
}

interface EngineAuthPayload {
  paired?: boolean
  email?: string | null
}

const INITIAL_RESULTS: DiagnosticItem[] = [
  {
    id: "health",
    title: "Local engine health",
    result: "Not tested yet.",
    status: "idle",
  },
  {
    id: "cors-pna",
    title: "Browser CORS/PNA path",
    result: "Not tested yet.",
    status: "idle",
  },
  {
    id: "auth",
    title: "Engine auth pairing",
    result: "Not tested yet.",
    status: "idle",
  },
  {
    id: "edge",
    title: "Supabase edge reachability",
    result: "Not tested yet.",
    status: "idle",
  },
  {
    id: "storage-minio",
    title: "MinIO backup (hybrid primary)",
    result: "Not tested yet.",
    status: "idle",
  },
  {
    id: "storage-s3",
    title: "AWS S3 backup",
    result: "Not tested yet.",
    status: "idle",
  },
]

function resolveSupabaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (fromEnv) return fromEnv
  const fromClient = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl?.trim()
  return fromClient ?? ""
}

function statusColor(status: DiagnosticStatus): string {
  if (status === "pass") return "text-emerald-300"
  if (status === "warn") return "text-amber-200"
  if (status === "fail") return "text-red-200"
  return "text-gray-300"
}

function statusBadgeTone(status: DiagnosticStatus): string {
  if (status === "pass") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
  if (status === "warn") return "border-amber-400/40 bg-amber-500/10 text-amber-100"
  if (status === "fail") return "border-red-400/40 bg-red-500/10 text-red-200"
  return "border-white/15 bg-white/5 text-gray-300"
}

export function EngineDiagnostics() {
  const [results, setResults] = useState<DiagnosticItem[]>(INITIAL_RESULTS)
  const [isRunning, setIsRunning] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [isExportBusy, setIsExportBusy] = useState(false)
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle")

  function updateResult(id: string, patch: Partial<DiagnosticItem>): void {
    setResults((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function runHealthCheck(): Promise<void> {
    updateResult("health", { status: "running", result: "Checking localhost /health..." })
    try {
      const response = await fetch(`${ENGINE_BASE}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      })
      if (!response.ok) {
        updateResult("health", {
          status: "fail",
          result: `Engine responded with HTTP ${response.status}. Start CTrack Engine Tray, then retry.`,
        })
        return
      }
      const payload = (await response.json()) as EngineHealthPayload
      updateResult("health", {
        status: "pass",
        result: `Engine is reachable on localhost${payload.version ? ` (v${payload.version})` : ""}.`,
      })
    } catch {
      updateResult("health", {
        status: "fail",
        result: "Browser cannot reach localhost:7777. Start the tray app and check that nothing else is using port 7777.",
      })
    }
  }

  async function runCorsPnaCheck(): Promise<void> {
    updateResult("cors-pna", { status: "running", result: "Probing CORS + Private Network Access..." })
    try {
      const response = await fetch(`${ENGINE_BASE}/api`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      })
      if (!response.ok) {
        updateResult("cors-pna", {
          status: "fail",
          result: `Local API answered HTTP ${response.status}. If this keeps failing from HTTPS, allow Private Network Access for this site.`,
        })
        return
      }
      updateResult("cors-pna", {
        status: "pass",
        result: "Browser successfully reached localhost API from this page. CORS/PNA path looks healthy.",
      })
    } catch {
      updateResult("cors-pna", {
        status: "fail",
        result:
          "Cross-origin localhost request failed. Allow Private Network Access in browser site settings and confirm engine CORS includes this web origin.",
      })
    }
  }

  async function runAuthStatusCheck(): Promise<void> {
    updateResult("auth", { status: "running", result: "Checking /api/auth/status..." })
    try {
      const response = await fetch(`${ENGINE_BASE}/api/auth/status`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      })
      if (!response.ok) {
        updateResult("auth", {
          status: "fail",
          result: `Auth status endpoint returned HTTP ${response.status}.`,
        })
        return
      }
      const payload = (await response.json()) as EngineAuthPayload
      if (payload.paired) {
        updateResult("auth", {
          status: "pass",
          result: `Engine is paired${payload.email ? ` as ${payload.email}` : ""}.`,
        })
        return
      }
      updateResult("auth", {
        status: "warn",
        result: "Engine is online but not paired yet. Pairing is required for authenticated update downloads.",
      })
    } catch {
      updateResult("auth", {
        status: "fail",
        result: "Could not read local auth status. Confirm the engine process is running.",
      })
    }
  }

  async function runEdgeReachabilityCheck(): Promise<void> {
    updateResult("edge", { status: "running", result: "Checking Supabase edge endpoint reachability..." })
    const supabaseUrl = resolveSupabaseUrl()
    if (!supabaseUrl) {
      updateResult("edge", {
        status: "fail",
        result: "Missing Supabase URL in web environment (VITE_SUPABASE_URL).",
      })
      return
    }
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const response = await fetch(`${supabaseUrl}/functions/v1/engine-download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ product: "engine", version: "latest", channel: "stable", dryRun: true }),
        signal: AbortSignal.timeout(5_000),
      })
      if (response.status >= 500) {
        updateResult("edge", {
          status: "fail",
          result: `Supabase edge endpoint is reachable but returned server error HTTP ${response.status}.`,
        })
        return
      }
      updateResult("edge", {
        status: "pass",
        result: `Supabase edge endpoint is reachable (HTTP ${response.status}).`,
      })
    } catch {
      updateResult("edge", {
        status: "fail",
        result: "Cannot reach Supabase edge from this browser/network. Check VPN/proxy/firewall and Supabase URL.",
      })
    }
  }

  async function runStorageChecks(): Promise<void> {
    updateResult("storage-minio", { status: "running", result: "Probing MinIO / hybrid primary..." })
    updateResult("storage-s3", { status: "running", result: "Probing AWS S3..." })
    try {
      const response = await fetch(`${ENGINE_BASE}/api/storage/test`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        const message = `Storage test HTTP ${response.status}`
        updateResult("storage-minio", { status: "fail", result: message })
        updateResult("storage-s3", { status: "fail", result: message })
        return
      }
      const payload = (await response.json()) as {
        hybridEnabled?: boolean
        storageProvider?: string
        targets?: Array<{
          provider: "s3" | "minio"
          configured: boolean
          ok: boolean
          bucket: string | null
          endpoint: string | null
          latencyMs: number | null
          message: string
        }>
      }
      const minio = payload.targets?.find((target) => target.provider === "minio")
      const s3 = payload.targets?.find((target) => target.provider === "s3")
      if (!payload.hybridEnabled) {
        updateResult("storage-minio", {
          status: "warn",
          result: `Hybrid disabled (STORAGE_PROVIDER=${payload.storageProvider ?? "s3"}). MinIO not used for publish.`,
        })
      } else if (!minio) {
        updateResult("storage-minio", { status: "warn", result: "Hybrid enabled but MinIO probe missing from engine response." })
      } else if (!minio.configured) {
        updateResult("storage-minio", { status: "warn", result: minio.message })
      } else if (minio.ok) {
        updateResult("storage-minio", {
          status: "pass",
          result: `${minio.bucket} @ ${minio.endpoint ?? "minio"} (${minio.latencyMs ?? "?"}ms) — ${minio.message}`,
        })
      } else {
        updateResult("storage-minio", {
          status: "fail",
          result: `${minio.bucket ?? "bucket"} @ ${minio.endpoint ?? "minio"} — ${minio.message}`,
        })
      }
      if (!s3) {
        updateResult("storage-s3", { status: "fail", result: "S3 probe missing from engine response." })
      } else if (!s3.configured) {
        updateResult("storage-s3", { status: "warn", result: s3.message })
      } else if (s3.ok) {
        updateResult("storage-s3", {
          status: "pass",
          result: `${s3.bucket} (${s3.latencyMs ?? "?"}ms) — ${s3.message}`,
        })
      } else {
        updateResult("storage-s3", { status: "fail", result: `${s3.bucket ?? "bucket"} — ${s3.message}` })
      }
    } catch {
      updateResult("storage-minio", {
        status: "fail",
        result: "Could not run storage test. Start the engine tray and retry.",
      })
      updateResult("storage-s3", {
        status: "fail",
        result: "Could not run storage test. Start the engine tray and retry.",
      })
    }
  }

  async function handleRunChecks(): Promise<void> {
    setIsRunning(true)
    await runHealthCheck()
    await runCorsPnaCheck()
    await runAuthStatusCheck()
    await runEdgeReachabilityCheck()
    await runStorageChecks()
    setIsRunning(false)
  }

  async function handleCopyResults(): Promise<void> {
    const body = results.map((item) => `- ${item.title}: ${item.result}`).join("\n")
    try {
      await navigator.clipboard.writeText(body)
      setCopyState("done")
      setTimeout(() => setCopyState("idle"), 1500)
    } catch {
      setCopyState("error")
      setTimeout(() => setCopyState("idle"), 1500)
    }
  }

  async function handleExportDiagnostics(): Promise<void> {
    setIsExportBusy(true)
    setExportError(null)
    try {
      const response = await fetch(`${ENGINE_BASE}/api/diagnostics/export`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) {
        throw new Error(`Export failed with HTTP ${response.status}`)
      }
      const payload = await response.json()
      const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" })
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = "ctrack-engine-diagnostics.json"
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsExportBusy(false)
    }
  }

  const hasFailures = useMemo(() => results.some((item) => item.status === "fail"), [results])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleRunChecks()}
          disabled={isRunning}
          className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TriangleAlert className="h-3.5 w-3.5" />}
          Run connection tests
        </button>
        <button
          type="button"
          onClick={() => void handleCopyResults()}
          className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10"
        >
          <Copy className="h-3.5 w-3.5" />
          {copyState === "done" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy results"}
        </button>
        <button
          type="button"
          onClick={() => void handleExportDiagnostics()}
          disabled={isExportBusy}
          className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isExportBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export engine diagnostics
        </button>
      </div>

      <div className="space-y-2">
        {results.map((item) => (
          <div key={item.id} className={`rounded-md border px-3 py-2 text-xs ${statusBadgeTone(item.status)}`}>
            <p className="font-medium">{item.title}</p>
            <p className={`mt-1 ${statusColor(item.status)}`}>{item.result}</p>
          </div>
        ))}
      </div>

      {hasFailures && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          One or more checks failed. Use the guidance below to fix browser PNA/CORS permissions, pairing, or firewall issues.
        </p>
      )}
      {exportError && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{exportError}</p>
      )}
      {!hasFailures && results.some((item) => item.status === "pass") && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Diagnostics look healthy on this workstation.
        </p>
      )}
    </div>
  )
}
