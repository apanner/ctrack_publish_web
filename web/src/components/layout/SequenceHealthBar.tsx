"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ScanSequenceItem {
  type: "sequence"
  name: string
  status: "ready" | "error"
  missing?: number[]
  count?: number
  total_expected?: number
  start?: number
  end?: number
}

interface SequenceHealthBarProps {
  /** Directory path to scan (e.g. from first staged sequence file). */
  dirPath: string | null
  className?: string
}

export function SequenceHealthBar({ dirPath, className }: SequenceHealthBarProps) {
  const [result, setResult] = useState<{ status: "ready" | "error"; missing: number[]; count: number; totalExpected: number } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!dirPath || !dirPath.trim()) {
      setResult(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setResult(null)
    ;(window as any).ipcRenderer
      .invoke("python-command", { command: "scan_folder", params: { folder_path: dirPath } })
      .then((res: { status?: string; data?: ScanSequenceItem[] }) => {
        if (cancelled) return
        setLoading(false)
        if (res.status !== "success" || !Array.isArray(res.data)) return
        const sequences = res.data.filter((d) => d.type === "sequence") as ScanSequenceItem[]
        const first = sequences[0]
        if (!first) return
        const missing = first.missing ?? []
        setResult({
          status: first.status,
          missing,
          count: first.count ?? 0,
          totalExpected: first.total_expected ?? first.count ?? 0,
        })
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dirPath])

  if (!dirPath) return null
  if (loading) {
    return (
      <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#2A2A2A] border border-[#404040]", className)}>
        <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
        <span className="text-[10px] font-semibold uppercase text-gray-400">QC scanning…</span>
      </div>
    )
  }
  if (!result) return null

  const isReady = result.status === "ready"
  const missingCount = result.missing.length

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg border",
        isReady
          ? "bg-[#24E1B1]/10 border-[#24E1B1]/30"
          : "bg-red-500/10 border-red-500/30",
        className
      )}
    >
      {isReady ? (
        <CheckCircle2 className="w-4 h-4 text-[#24E1B1]" />
      ) : (
        <AlertTriangle className="w-4 h-4 text-red-400" />
      )}
      <span className={cn("text-[10px] font-bold uppercase", isReady ? "text-[#24E1B1]" : "text-red-400")}>
        {isReady ? "Sequence OK" : `Missing ${missingCount} frame(s)`}
      </span>
      {!isReady && missingCount > 0 && missingCount <= 5 && (
        <span className="text-[9px] text-gray-400 tabular-nums">
          ({result.missing.slice(0, 5).join(", ")})
        </span>
      )}
      {!isReady && missingCount > 5 && (
        <span className="text-[9px] text-gray-400">e.g. {result.missing.slice(0, 3).join(", ")}…</span>
      )}
    </div>
  )
}
