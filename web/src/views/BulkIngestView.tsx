"use client"

import { useMemo, useState } from "react"
import { ProjectCreationWizard } from "@/components/project-creation-wizard/ProjectCreationWizard"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { usePublishQueue } from "@/hooks/usePublishQueue"
import { canOpenProjectCreationWizard } from "@/lib/publisher-permissions"
import { useContextStore } from "@/hooks/use-context-store"
import { useShots, type DBShot } from "@/hooks/use-ctrack-data"
import { parsePathContext } from "@/lib/path-context"
import { ContextBar } from "@/components/layout/ContextBar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CheckCircle2, AlertTriangle, FolderOpen, RefreshCw, FileVideo, Layers, Copy, Download, Send, FileText } from "lucide-react"

const BULK_SUBMISSION_NOTES_TEMPLATE = `Done:
-

To Do:
-`

type ScanMediaType = "sequence" | "video"
type PublishTarget = "elements" | "versions" | "both"
type ElementType = "plate" | "edit_ref" | "other"
type RowStatus = "matched" | "unmatched" | "error"
type RowFilter = "all" | "matched" | "unmatched" | "error"
type MediaKindFilter = "all" | "video" | "sequence"

const UNASSIGNED_SHOT_ID = "__UNASSIGNED_SHOT__"

interface RawScanItem {
  type: ScanMediaType
  name: string
  folder?: string
  path?: string
  prefix?: string
  extension?: string
  start?: number
  end?: number
  count?: number
  total_size_bytes?: number
  total_expected?: number
  missing?: number[]
  status: "ready" | "error"
  file_pattern?: string
}

interface ScanFolderResponse {
  status: "success" | "error"
  message?: string
  data?: RawScanItem[]
}

interface BulkMappingRow {
  id: string
  mediaType: ScanMediaType
  /** Lowercase extension without dot (.exr → exr). From scanner sequence `extension` or video path. */
  fileExtension: string | null
  displayName: string
  sourcePath: string
  inputPath: string | null
  frameStart?: number
  frameEnd?: number
  frameCount?: number
  expectedFrameCount?: number
  frameRange?: string | null
  missingFrames?: number[]
  scanStatus: "ready" | "error"
  scanIssue: string | null
  matchedShotId: string | null
  projectCode: string | null
  episodeCode: string | null
  sequenceName: string | null
  shotCode: string | null
  shotRootPath: string | null
  versionsBasePath: string | null
  elementsBasePath: string | null
  publishTarget: PublishTarget
  elementType: ElementType
  status: RowStatus
  statusReason: string
  validationErrors: string[]
}

interface BulkIngestViewProps {
  onNavigateToQueue?: () => void
}

interface IpcRendererLike {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

function normalizeToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function createStableId(item: RawScanItem): string {
  const raw = [item.type, item.path, item.folder, item.name, item.start, item.end].join("|")
  let hash = 0
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(i)
    hash |= 0
  }
  return `bulk_${Math.abs(hash)}`
}

function buildSequenceInputPath(item: RawScanItem): string | null {
  if (!item.folder || !item.prefix || !item.extension || item.start == null) return null
  const padding = item.file_pattern?.match(/#+/)?.[0]?.length ?? String(item.start).length
  const frame = String(item.start).padStart(padding, "0")
  const separator = item.folder.endsWith("\\") || item.folder.endsWith("/") ? "" : "\\"
  return `${item.folder}${separator}${item.prefix}${frame}.${item.extension}`
}

function normalizeFileExtension(ext: string | null | undefined): string | null {
  if (ext == null || ext === "") return null
  const t = String(ext).trim().toLowerCase().replace(/^\./, "")
  return t.length ? t : null
}

/** Derive a single display/filter extension per scan row (matches python/modules/scanner.py). */
function deriveFileExtension(item: RawScanItem): string | null {
  if (item.type === "sequence") return normalizeFileExtension(item.extension)
  const fromScanner = normalizeFileExtension(item.extension)
  if (fromScanner) return fromScanner
  const path = item.path ?? item.name ?? ""
  const match = path.match(/\.([a-zA-Z0-9]+)$/)
  return match ? normalizeFileExtension(match[1]) : null
}

function getEpisodeCode(shot: DBShot | undefined): string | null {
  if (!shot?.episodes) return null
  if (Array.isArray(shot.episodes)) return shot.episodes[0]?.code ?? null
  return shot.episodes.code ?? null
}

function getProjectCode(shot: DBShot | undefined, fallbackProjectCode: string | null): string | null {
  const joined = shot?.projects
  if (Array.isArray(joined)) return joined[0]?.code ?? fallbackProjectCode
  if (joined?.code) return joined.code
  return fallbackProjectCode
}

function buildCanonicalShotRootPath(projectCode: string, sequenceName: string, shotCode: string, episodeCode?: string | null): string {
  const episodePart = episodeCode ? `/${episodeCode}` : ""
  return `Projects/${projectCode}${episodePart}/${sequenceName}/${shotCode}`
}

function withResolvedStorageContext(row: BulkMappingRow, shot: DBShot | undefined, fallbackProjectCode: string | null): BulkMappingRow {
  if (!shot) {
    return {
      ...row,
      projectCode: fallbackProjectCode,
      episodeCode: null,
      sequenceName: null,
      shotCode: null,
      shotRootPath: null,
      versionsBasePath: null,
      elementsBasePath: null,
    }
  }
  const projectCode = getProjectCode(shot, fallbackProjectCode)
  const episodeCode = getEpisodeCode(shot)
  const sequenceName = shot.sequence_name ?? null
  const shotCode = shot.shot_code ?? null
  if (!projectCode || !sequenceName || !shotCode) {
    return {
      ...row,
      projectCode,
      episodeCode,
      sequenceName,
      shotCode,
      shotRootPath: null,
      versionsBasePath: null,
      elementsBasePath: null,
    }
  }
  const shotRootPath = buildCanonicalShotRootPath(projectCode, sequenceName, shotCode, episodeCode)
  return {
    ...row,
    projectCode,
    episodeCode,
    sequenceName,
    shotCode,
    shotRootPath,
    versionsBasePath: `${shotRootPath}/Versions`,
    elementsBasePath: `${shotRootPath}/Elements`,
  }
}

function deriveRowStatus(inputPath: string | null, scanIssue: string | null, matchedShotId: string | null): { status: RowStatus; reason: string } {
  if (!inputPath) return { status: "error", reason: "Unable to resolve source media path" }
  if (scanIssue) return { status: "error", reason: scanIssue }
  if (!matchedShotId) return { status: "unmatched", reason: "No matching shot found in selected project" }
  return { status: "matched", reason: "Shot mapped" }
}

function validateRow(row: BulkMappingRow): string[] {
  const errors: string[] = []
  if (row.status === "error") errors.push(row.statusReason)
  if (!row.matchedShotId) errors.push("Shot is required")
  if (!row.inputPath) errors.push("Source media path is missing")
  if (row.matchedShotId && !row.shotRootPath) {
    errors.push("Resolved storage path is missing (project/sequence/shot context)")
  }
  if (row.mediaType === "sequence" && (row.frameStart == null || row.frameEnd == null)) {
    errors.push("Sequence frame range is missing")
  }
  if (row.publishTarget !== "versions" && !row.elementType) {
    errors.push("Element type is required for elements publishing")
  }
  return errors
}

function findBestShotMatch(item: RawScanItem, shots: DBShot[]): DBShot | null {
  if (!shots.length) return null
  const shotsByCode = new Map<string, DBShot>()
  shots.forEach((shot) => shotsByCode.set(normalizeToken(shot.shot_code), shot))

  const pathCandidates = [item.path, item.folder, item.name].filter((value): value is string => Boolean(value))
  for (const candidate of pathCandidates) {
    const parsed = parsePathContext(candidate)
    if (parsed.shotCode) {
      const exact = shotsByCode.get(normalizeToken(parsed.shotCode))
      if (exact) return exact
    }
  }

  const normalizedName = normalizeToken(item.name)
  const ranked = shots
    .map((shot) => ({
      shot,
      key: normalizeToken(shot.shot_code),
    }))
    .filter((entry) => normalizedName.includes(entry.key) || entry.key.includes(normalizedName))
    .sort((a, b) => b.key.length - a.key.length)

  return ranked[0]?.shot ?? null
}

export function BulkIngestView({ onNavigateToQueue }: BulkIngestViewProps) {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [rows, setRows] = useState<BulkMappingRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [defaultPublishTarget, setDefaultPublishTarget] = useState<PublishTarget>("versions")
  const [bulkElementNotes, setBulkElementNotes] = useState("")
  const [bulkSubmissionNotes, setBulkSubmissionNotes] = useState(BULK_SUBMISSION_NOTES_TEMPLATE)
  const [activeFilter, setActiveFilter] = useState<RowFilter>("all")
  const [mediaKindFilter, setMediaKindFilter] = useState<MediaKindFilter>("all")
  const [selectedFormatExtensions, setSelectedFormatExtensions] = useState<Set<string>>(() => new Set())
  const [isPublishing, setIsPublishing] = useState(false)

  const { addJob, processNextJob } = usePublishQueue()
  const { profile } = useAuth()
  const { projectId, projectCode } = useContextStore()
  const canCreateProject = canOpenProjectCreationWizard(profile?.role)
  const { data: dbShots } = useShots(projectId || undefined)

  const shots = useMemo(() => dbShots ?? [], [dbShots])
  const shotsById = useMemo(() => {
    return new Map(shots.map((shot) => [shot.id, shot] as const))
  }, [shots])

  const filteredRows = useMemo(() => {
    let out = rows
    if (activeFilter === "matched") out = out.filter((row) => row.status === "matched")
    else if (activeFilter === "unmatched") out = out.filter((row) => row.status === "unmatched")
    else if (activeFilter === "error") out = out.filter((row) => row.status === "error")

    if (mediaKindFilter !== "all") {
      out = out.filter((row) => row.mediaType === mediaKindFilter)
    }
    if (selectedFormatExtensions.size > 0) {
      out = out.filter((row) => {
        const ext = row.fileExtension
        return Boolean(ext && selectedFormatExtensions.has(ext))
      })
    }
    return out
  }, [rows, activeFilter, mediaKindFilter, selectedFormatExtensions])

  const hasNarrowingFilters = useMemo(() => {
    return (
      activeFilter !== "all" ||
      mediaKindFilter !== "all" ||
      selectedFormatExtensions.size > 0
    )
  }, [activeFilter, mediaKindFilter, selectedFormatExtensions])

  const selectedInFilteredView = useMemo(() => {
    let n = 0
    for (const row of filteredRows) {
      if (selectedIds.has(row.id)) n += 1
    }
    return n
  }, [filteredRows, selectedIds])

  const hiddenSelectedCount = selectedIds.size - selectedInFilteredView

  /** Extensions present in scan, optionally narrowed by media kind (for filter chips). */
  const formatOptionsWithCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (mediaKindFilter !== "all" && row.mediaType !== mediaKindFilter) continue
      const ext = row.fileExtension
      if (!ext) continue
      counts.set(ext, (counts.get(ext) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, mediaKindFilter])

  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((row) => selectedIds.has(row.id))

  /** Jobs that would be queued if all selected rows validate (for footer hint). */
  const publishJobPreviewCount = useMemo(() => {
    let n = 0
    for (const row of rows) {
      if (!selectedIds.has(row.id)) continue
      if (row.publishTarget === "elements" || row.publishTarget === "both") n += 1
      if (row.publishTarget === "versions" || row.publishTarget === "both") n += 1
    }
    return n
  }, [rows, selectedIds])

  const jsonPreviewObject = useMemo(() => {
    return {
      projectId,
      projectCode,
      selectedFolder: selectedPath,
      generatedAt: new Date().toISOString(),
      rows: rows.map((row) => {
        const shot = row.matchedShotId ? shotsById.get(row.matchedShotId) : null
        return {
          id: row.id,
          mediaType: row.mediaType,
          fileExtension: row.fileExtension,
          sourcePath: row.sourcePath,
          inputPath: row.inputPath,
          frameStart: row.frameStart ?? null,
          frameEnd: row.frameEnd ?? null,
          frameCount: row.frameCount ?? null,
          expectedFrameCount: row.expectedFrameCount ?? null,
          frameRange: row.frameRange ?? null,
          missingFrames: row.missingFrames ?? [],
          publishTarget: row.publishTarget,
          elementType: row.elementType,
          mappedShotId: row.matchedShotId,
          mappedShotCode: row.shotCode ?? shot?.shot_code ?? null,
          mappingContext: {
            projectCode: row.projectCode,
            episodeCode: row.episodeCode,
            sequenceName: row.sequenceName,
            shotCode: row.shotCode,
          },
          storagePaths: {
            shotRootPath: row.shotRootPath,
            versionsBasePath: row.versionsBasePath,
            elementsBasePath: row.elementsBasePath,
            versionPathTemplate: row.versionsBasePath ? `${row.versionsBasePath}/{tracking_number_or_version}` : null,
            elementPathTemplate: row.elementsBasePath ? `${row.elementsBasePath}/{vLabel}` : null,
          },
          status: row.status,
          statusReason: row.statusReason,
          validationErrors: row.validationErrors,
        }
      }),
    }
  }, [projectId, projectCode, selectedPath, rows, shotsById])

  const jsonPreviewText = useMemo(() => JSON.stringify(jsonPreviewObject, null, 2), [jsonPreviewObject])

  const handleBrowse = async (): Promise<void> => {
    if (!projectId) {
      toast.error("Select a project first in the context bar")
      return
    }
    try {
      const ipcRenderer = (window as unknown as { ipcRenderer?: IpcRendererLike }).ipcRenderer
      if (!ipcRenderer) {
        toast.error("IPC bridge is not available")
        return
      }
      const folderPath = (await ipcRenderer.invoke("select-directory")) as string | null
      if (folderPath) {
        setSelectedPath(folderPath)
        await handleScan(folderPath)
      }
    } catch (_err) {
      toast.error("Failed to open folder picker")
    }
  }

  const handleScan = async (folderPath: string): Promise<void> => {
    if (!projectId) {
      toast.error("Select a project first in the context bar")
      return
    }
    setLoading(true)
    setSelectedIds(new Set())
    setMediaKindFilter("all")
    setSelectedFormatExtensions(new Set())
    try {
      const ipcRenderer = (window as unknown as { ipcRenderer?: IpcRendererLike }).ipcRenderer
      if (!ipcRenderer) {
        toast.error("IPC bridge is not available")
        return
      }
      const response = (await ipcRenderer.invoke("python-command", {
        command: "scan_folder",
        params: { folder_path: folderPath },
      })) as ScanFolderResponse
      if (response.status !== "success") {
        toast.error(response.message || "Failed to scan folder")
        return
      }

      const mappedRows: BulkMappingRow[] = (response.data ?? []).map((item) => {
        const inputPath = item.type === "video" ? item.path ?? null : buildSequenceInputPath(item)
        const scanIssue = item.status === "error"
          ? item.missing?.length
            ? `Sequence has missing frames (${item.missing.length} missing)`
            : "Scanner marked this item as invalid"
          : null
        const matchedShot = findBestShotMatch(item, shots)
        const derived = deriveRowStatus(inputPath, scanIssue, matchedShot?.id ?? null)
        const frameStart = item.start
        const frameEnd = item.end
        const frameCount = item.count ?? (frameStart != null && frameEnd != null ? (frameEnd - frameStart + 1) : undefined)
        const expectedFrameCount = item.total_expected ?? (frameStart != null && frameEnd != null ? (frameEnd - frameStart + 1) : undefined)
        const frameRange = frameStart != null && frameEnd != null ? `${frameStart}-${frameEnd}` : null

        const baseRow: BulkMappingRow = {
          id: createStableId(item),
          mediaType: item.type,
          fileExtension: deriveFileExtension(item),
          displayName: item.name,
          sourcePath: item.type === "sequence"
            ? `${item.folder ?? ""}\\${item.file_pattern ?? item.name}`
            : item.path ?? item.name,
          inputPath,
          frameStart,
          frameEnd,
          frameCount,
          expectedFrameCount,
          frameRange,
          missingFrames: item.missing ?? [],
          scanStatus: item.status,
          scanIssue,
          matchedShotId: matchedShot?.id ?? null,
          projectCode: null,
          episodeCode: null,
          sequenceName: null,
          shotCode: null,
          shotRootPath: null,
          versionsBasePath: null,
          elementsBasePath: null,
          publishTarget: defaultPublishTarget,
          elementType: "plate",
          status: derived.status,
          statusReason: derived.reason,
          validationErrors: [],
        }
        return withResolvedStorageContext(baseRow, matchedShot ?? undefined, projectCode ?? null)
      })

      setRows(mappedRows)
      toast.success(`Scan complete: ${mappedRows.length} media item(s) detected`)
    } catch (_err) {
      toast.error("Scan failed due to an unexpected error")
    } finally {
      setLoading(false)
    }
  }

  const updateRow = (rowId: string, updates: Partial<BulkMappingRow>): void => {
    setRows((prev) => {
      return prev.map((row) => {
        if (row.id !== rowId) return row
        const next = { ...row, ...updates }
        const resolvedShot = next.matchedShotId ? shotsById.get(next.matchedShotId) : undefined
        const withContext = withResolvedStorageContext(next, resolvedShot, projectCode ?? null)
        const status = deriveRowStatus(next.inputPath, next.scanIssue, next.matchedShotId)
        return { ...withContext, status: status.status, statusReason: status.reason, validationErrors: [] }
      })
    })
  }

  const toggleSelect = (rowId: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  const toggleSelectAllVisible = (): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        filteredRows.forEach((row) => next.delete(row.id))
      } else {
        filteredRows.forEach((row) => next.add(row.id))
      }
      return next
    })
  }

  /** Drop checked rows that are not in the current filtered list (e.g. after switching to Video only). */
  const handleKeepSelectionToFilteredOnly = (): void => {
    const visible = new Set(filteredRows.map((row) => row.id))
    setSelectedIds((prev) => {
      const next = new Set<string>()
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id)
      })
      return next
    })
    toast.success("Selection kept to visible rows only")
  }

  const handleDefaultPublishTargetChange = (value: PublishTarget): void => {
    setDefaultPublishTarget(value)
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        publishTarget: value,
        validationErrors: [],
      }))
    )
  }

  const applyDefaultTargetToSelection = (): void => {
    if (selectedIds.size === 0) {
      toast.warning("Select one or more rows first")
      return
    }
    setRows((prev) => {
      return prev.map((row) => {
        if (!selectedIds.has(row.id)) return row
        return { ...row, publishTarget: defaultPublishTarget, validationErrors: [] }
      })
    })
    toast.success(`Applied ${defaultPublishTarget} to ${selectedIds.size} row(s)`)
  }

  const handleMediaKindFilterChange = (value: MediaKindFilter): void => {
    setMediaKindFilter(value)
    setSelectedFormatExtensions(new Set())
  }

  const handleToggleFormatFilter = (ext: string): void => {
    setSelectedFormatExtensions((prev) => {
      const next = new Set(prev)
      if (next.has(ext)) next.delete(ext)
      else next.add(ext)
      return next
    })
  }

  const handleClearFormatFilters = (): void => {
    setSelectedFormatExtensions(new Set())
  }

  const handleCopyJson = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(jsonPreviewText)
      toast.success("JSON copied to clipboard")
    } catch (_err) {
      toast.error("Failed to copy JSON")
    }
  }

  const handleDownloadJson = (): void => {
    try {
      const blob = new Blob([jsonPreviewText], { type: "application/json;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `bulk_ingest_map_${Date.now()}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success("JSON file prepared for download")
    } catch (_err) {
      toast.error("Failed to generate JSON download")
    }
  }

  const handlePublishSelected = (): void => {
    if (isPublishing) return
    if (!projectId) {
      toast.error("Select a project before publishing")
      return
    }
    const selectedRows = rows.filter((row) => selectedIds.has(row.id))
    if (!selectedRows.length) {
      toast.error("Select at least one mapped row")
      return
    }

    setIsPublishing(true)
    const validated = selectedRows.map((row) => ({
      row,
      errors: validateRow(row),
    }))

    const rowErrors = new Map<string, string[]>()
    validated.forEach((entry) => rowErrors.set(entry.row.id, entry.errors))
    setRows((prev) => prev.map((row) => ({
      ...row,
      validationErrors: rowErrors.get(row.id) ?? row.validationErrors,
    })))

    const validRows = validated.filter((entry) => entry.errors.length === 0).map((entry) => entry.row)
    if (!validRows.length) {
      setIsPublishing(false)
      toast.error("No valid rows to publish")
      return
    }

    const elementNotesFinal = bulkElementNotes.trim() || "Bulk ingest"
    const submissionNotesFinal = bulkSubmissionNotes.trim() || "Bulk ingest publish"

    let queuedJobCount = 0
    validRows.forEach((row) => {
      if (!row.matchedShotId || !row.inputPath) return
      const shot = shotsById.get(row.matchedShotId)
      const customContext = {
        projectId,
        projectCode: row.projectCode ?? projectCode ?? null,
        episodeCode: row.episodeCode ?? getEpisodeCode(shot),
        shotId: row.matchedShotId,
        shotCode: row.shotCode ?? shot?.shot_code ?? null,
        sequenceName: row.sequenceName ?? shot?.sequence_name ?? null,
      }
      const options = {
        burnin: true,
        gif: true,
        metadata: {
          shot: shot?.shot_code ?? row.displayName,
          version: "v001",
          artist: "Bulk Ingest",
        },
      }

      if (row.publishTarget === "elements" || row.publishTarget === "both") {
        addJob(row.inputPath, options, {
          tab: "element",
          elementCategory: "media",
          elementType: row.elementType,
          elementNotes: elementNotesFinal,
          frameStart: row.frameStart,
          frameEnd: row.frameEnd,
          frameRange: row.frameRange ?? undefined,
          storagePlan: {
            shotRootPath: row.shotRootPath ?? undefined,
            versionsBasePath: row.versionsBasePath ?? undefined,
            elementsBasePath: row.elementsBasePath ?? undefined,
            sourceFrameRange: row.frameStart != null && row.frameEnd != null ? {
              start: row.frameStart,
              end: row.frameEnd,
              count: row.frameCount ?? null,
            } : undefined,
          },
        }, customContext)
        queuedJobCount += 1
      }

      if (row.publishTarget === "versions" || row.publishTarget === "both") {
        addJob(row.inputPath, options, {
          tab: "version",
          versionName: "v001",
          submissionNotes: submissionNotesFinal,
          frameStart: row.frameStart,
          frameEnd: row.frameEnd,
          frameRange: row.frameRange ?? undefined,
          storagePlan: {
            shotRootPath: row.shotRootPath ?? undefined,
            versionsBasePath: row.versionsBasePath ?? undefined,
            elementsBasePath: row.elementsBasePath ?? undefined,
            sourceFrameRange: row.frameStart != null && row.frameEnd != null ? {
              start: row.frameStart,
              end: row.frameEnd,
              count: row.frameCount ?? null,
            } : undefined,
          },
        }, customContext)
        queuedJobCount += 1
      }
    })

    setTimeout(() => processNextJob(), 100)
    toast.success(`Queued ${queuedJobCount} publish job(s) from ${validRows.length} row(s)`)
    onNavigateToQueue?.()
    setIsPublishing(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#121212]">
      <ContextBar onNavigateToQueue={onNavigateToQueue} />
      <ProjectCreationWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onNavigateToQueue={onNavigateToQueue}
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        <Card className="bg-[#1A1A1A] border border-[#404040]">
          <CardContent className="p-4 md:p-5 space-y-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-1">
                <h1 className="text-2xl font-black tracking-tight text-white">Bulk Ingest</h1>
                <p className="text-xs text-gray-400 uppercase tracking-[0.2em]">Map Plates To Shots And Publish In Batch</p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="space-y-1 min-w-[220px]">
                  <p className="text-[10px] text-gray-400 uppercase tracking-[0.15em] font-bold">Default publish target</p>
                  <Select value={defaultPublishTarget} onValueChange={(value) => handleDefaultPublishTargetChange(value as PublishTarget)} disabled={!projectId}>
                    <SelectTrigger className="h-9 bg-[#121212] border-[#404040] text-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#2A2A2A] border-[#404040] text-white">
                      <SelectItem value="elements">Elements</SelectItem>
                      <SelectItem value="versions">Versions</SelectItem>
                      <SelectItem value="both">Both (2 queue jobs per row)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-gray-500 leading-snug">
                    Both queues an element job and a version job for the same file. Use per-row target to mix.
                  </p>
                </div>

                <Button
                  variant="outline"
                  onClick={handleBrowse}
                  disabled={!projectId || loading}
                  className="h-9 gap-2 border-[#404040] bg-[#121212] hover:bg-[#202020]"
                >
                  {loading ? <Spinner size="sm" /> : <FolderOpen className="w-4 h-4" />}
                  Browse Folder
                </Button>
                <Button
                  variant="outline"
                  onClick={() => selectedPath && handleScan(selectedPath)}
                  disabled={!projectId || !selectedPath || loading}
                  className="h-9 gap-2 border-[#404040] bg-[#121212] hover:bg-[#202020]"
                >
                  <RefreshCw className="w-4 h-4" />
                  Rescan
                </Button>
              </div>
            </div>

            {!projectId && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex flex-wrap items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Select a project first. Mapping only checks shots from the selected project.</span>
                {canCreateProject ? (
                  <button
                    type="button"
                    onClick={() => setWizardOpen(true)}
                    className="text-[#24E1B1] hover:underline font-medium"
                  >
                    Create one
                  </button>
                ) : (
                  <span className="text-amber-300/90">Ask an admin or supervisor if you need a new project.</span>
                )}
              </div>
            )}

            {selectedPath && (
              <div className="rounded-lg border border-[#404040] bg-[#121212] px-3 py-2 text-xs text-gray-300">
                <span className="text-gray-400 mr-2">Source folder:</span>
                <span className="font-mono">{selectedPath}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border border-[#404040]">
          <CardContent className="p-4 md:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#24E1B1]" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Batch notes</h2>
            </div>
            <p className="text-[11px] text-gray-500">
              Used when publishing elements and/or versions from this screen. Element notes map to the element description; submission notes become version review notes.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider" htmlFor="bulk-element-notes">
                  Element notes
                </label>
                <textarea
                  id="bulk-element-notes"
                  className="w-full min-h-[100px] rounded-md bg-[#121212] border border-[#404040] text-white text-xs p-3 placeholder:text-gray-500 focus:ring-1 focus:ring-[#24E1B1] focus:outline-none"
                  placeholder="Description for element publishes (targets: Elements or Both)…"
                  value={bulkElementNotes}
                  onChange={(e) => setBulkElementNotes(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider" htmlFor="bulk-submission-notes">
                  Submission / review notes
                </label>
                <textarea
                  id="bulk-submission-notes"
                  className="w-full min-h-[100px] rounded-md bg-[#121212] border border-[#404040] text-white text-xs p-3 placeholder:text-gray-500 focus:ring-1 focus:ring-[#24E1B1] focus:outline-none"
                  placeholder={BULK_SUBMISSION_NOTES_TEMPLATE}
                  value={bulkSubmissionNotes}
                  onChange={(e) => setBulkSubmissionNotes(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border border-[#404040]">
          <CardContent className="p-0">
            <div className="border-b border-[#404040] p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-[#404040] bg-[#121212] text-xs"
                  onClick={toggleSelectAllVisible}
                  disabled={!filteredRows.length}
                  title="Checks every row in the filtered table only (not the full scan)"
                >
                  {allVisibleSelected
                    ? "Unselect all shown"
                    : `Select all shown (${filteredRows.length})`}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-[#404040] bg-[#121212] text-xs"
                  onClick={handleKeepSelectionToFilteredOnly}
                  disabled={!hasNarrowingFilters || hiddenSelectedCount === 0}
                  title="Remove checks from rows hidden by filters"
                >
                  Keep only visible in selection
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-[#404040] bg-[#121212]"
                  onClick={applyDefaultTargetToSelection}
                  disabled={selectedIds.size === 0}
                >
                  Apply default target
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                {(["all", "matched", "unmatched", "error"] as RowFilter[]).map((filter) => (
                  <Button
                    key={filter}
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveFilter(filter)}
                    className={cn(
                      "h-8 border-[#404040] bg-[#121212] text-xs uppercase",
                      activeFilter === filter && "border-[#0096D6] text-[#24E1B1]"
                    )}
                  >
                    {filter}
                  </Button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center gap-4">
                <Spinner size="lg" />
                <p className="text-xs text-gray-400 uppercase tracking-[0.2em]">Scanning and mapping media...</p>
              </div>
            ) : rows.length === 0 ? (
              <div className="py-20 px-4 text-center text-gray-400 text-sm">
                Scan a project folder to build your ingest mapping table.
              </div>
            ) : (
              <>
                <div className="border-b border-[#404040] px-4 py-3 space-y-3 bg-[#151515]">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-gray-500 font-bold shrink-0">Media type</span>
                    <div className="flex flex-wrap gap-2">
                      {(["all", "video", "sequence"] as const).map((kind) => (
                        <Button
                          key={kind}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleMediaKindFilterChange(kind)}
                          className={cn(
                            "h-8 border-[#404040] bg-[#121212] text-xs capitalize",
                            mediaKindFilter === kind && "border-[#0096D6] text-[#24E1B1]"
                          )}
                        >
                          {kind === "all" ? "All" : kind === "video" ? "Video" : "Sequence"}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {formatOptionsWithCounts.length > 0 && (
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-4">
                      <span className="text-[10px] uppercase tracking-[0.15em] text-gray-500 font-bold shrink-0 lg:pt-1.5">File format</span>
                      <div className="flex flex-wrap gap-2 min-w-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-8 border-[#404040] bg-[#121212] text-xs",
                            selectedFormatExtensions.size === 0 && "border-[#0096D6] text-[#24E1B1]"
                          )}
                          onClick={handleClearFormatFilters}
                        >
                          All formats
                        </Button>
                        {formatOptionsWithCounts.map(([ext, count]) => (
                          <Button
                            key={ext}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleFormatFilter(ext)}
                            className={cn(
                              "h-8 border-[#404040] bg-[#121212] font-mono text-[11px] text-gray-300",
                              selectedFormatExtensions.has(ext) && "border-[#0096D6] text-[#24E1B1]"
                            )}
                            title={`Filter to .${ext} (${count} in scan)`}
                          >
                            .{ext}
                            <span className="ml-1 tabular-nums text-gray-500">({count})</span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-600 leading-relaxed">
                    Showing <span className="text-gray-400 font-mono tabular-nums">{filteredRows.length}</span> of{" "}
                    <span className="text-gray-400 font-mono tabular-nums">{rows.length}</span> row(s). Format chips combine with OR. Use{" "}
                    <span className="text-gray-400">Select all shown</span> for checkboxes in this list; footer shows visible vs scanned totals.
                  </p>
                </div>
                <div className="overflow-auto">
                <table className="w-full min-w-[1220px] text-sm">
                  <thead className="bg-[#121212] border-b border-[#404040]">
                    <tr className="text-left text-[10px] uppercase tracking-[0.15em] text-gray-400">
                      <th className="px-3 py-3 w-12">Sel</th>
                      <th className="px-3 py-3 w-28">Media</th>
                      <th className="px-3 py-3 w-14">Fmt</th>
                      <th className="px-3 py-3 min-w-[180px]">Name</th>
                      <th className="px-3 py-3 min-w-[260px]">Source</th>
                      <th className="px-3 py-3 min-w-[170px]">Shot Mapping</th>
                      <th className="px-3 py-3 w-[160px]">Publish Target</th>
                      <th className="px-3 py-3 w-[150px]">Element Type</th>
                      <th className="px-3 py-3 min-w-[180px]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const mappedShot = row.matchedShotId ? shotsById.get(row.matchedShotId) : null
                      return (
                        <tr key={row.id} className="border-b border-[#2C2C2C] align-top">
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(row.id)}
                              onChange={() => toggleSelect(row.id)}
                              className="w-4 h-4 accent-[#0096D6]"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <div className="inline-flex items-center gap-2 text-xs text-gray-300">
                              {row.mediaType === "video" ? <FileVideo className="w-4 h-4 text-[#24E1B1]" /> : <Layers className="w-4 h-4 text-[#24E1B1]" />}
                              {row.mediaType}
                            </div>
                            {row.frameStart != null && row.frameEnd != null && (
                              <p className="text-[10px] text-gray-500 mt-1 tabular-nums">
                                {row.frameStart}-{row.frameEnd}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-[10px] font-mono text-gray-400 uppercase">
                              {row.fileExtension ? `.${row.fileExtension}` : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <p className="text-white font-medium break-all">{row.displayName}</p>
                            {row.frameCount != null && <p className="text-[10px] text-gray-500">{row.frameCount} frame(s)</p>}
                          </td>
                          <td className="px-3 py-3">
                            <p className="text-xs text-gray-400 break-all">{row.sourcePath}</p>
                          </td>
                          <td className="px-3 py-3">
                            <Select
                              value={row.matchedShotId ?? UNASSIGNED_SHOT_ID}
                              onValueChange={(value) => updateRow(row.id, { matchedShotId: value === UNASSIGNED_SHOT_ID ? null : value })}
                            >
                              <SelectTrigger className="h-8 bg-[#121212] border-[#404040] text-white text-xs">
                                <SelectValue placeholder="Select shot" />
                              </SelectTrigger>
                              <SelectContent className="bg-[#2A2A2A] border-[#404040] text-white max-h-[280px]">
                                <SelectItem value={UNASSIGNED_SHOT_ID}>Unassigned</SelectItem>
                                {shots.map((shot) => (
                                  <SelectItem key={shot.id} value={shot.id}>
                                    {shot.shot_code}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[10px] text-gray-500 mt-1">
                              Auto: {mappedShot?.shot_code ?? "None"}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <Select value={row.publishTarget} onValueChange={(value) => updateRow(row.id, { publishTarget: value as PublishTarget })}>
                              <SelectTrigger className="h-8 bg-[#121212] border-[#404040] text-white text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-[#2A2A2A] border-[#404040] text-white">
                                <SelectItem value="elements">Elements</SelectItem>
                                <SelectItem value="versions">Versions</SelectItem>
                                <SelectItem value="both">Both</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-3">
                            <Select
                              value={row.elementType}
                              onValueChange={(value) => updateRow(row.id, { elementType: value as ElementType })}
                              disabled={row.publishTarget === "versions"}
                            >
                              <SelectTrigger className="h-8 bg-[#121212] border-[#404040] text-white text-xs disabled:opacity-50">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-[#2A2A2A] border-[#404040] text-white">
                                <SelectItem value="plate">plate</SelectItem>
                                <SelectItem value="edit_ref">edit_ref</SelectItem>
                                <SelectItem value="other">other</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-start gap-2">
                              {row.status === "matched" ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                              ) : (
                                <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", row.status === "error" ? "text-red-400" : "text-amber-400")} />
                              )}
                              <div className="text-xs">
                                <p className={cn(
                                  "font-semibold",
                                  row.status === "matched" && "text-green-400",
                                  row.status === "unmatched" && "text-amber-300",
                                  row.status === "error" && "text-red-300"
                                )}>
                                  {row.status}
                                </p>
                                <p className="text-gray-500">{row.statusReason}</p>
                                {row.validationErrors.length > 0 && (
                                  <p className="text-red-300 mt-1">{row.validationErrors[0]}</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border border-[#404040]">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-[0.15em]">JSON Gather / Preview</p>
                <p className="text-[11px] text-gray-500">Review or export mapped payload before publish</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 border-[#404040] bg-[#121212]" onClick={handleCopyJson}>
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  Copy JSON
                </Button>
                <Button variant="outline" size="sm" className="h-8 border-[#404040] bg-[#121212]" onClick={handleDownloadJson}>
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Save JSON
                </Button>
              </div>
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg border border-[#404040] bg-[#121212] p-3 text-[11px] text-gray-300">
              {jsonPreviewText}
            </pre>
          </CardContent>
        </Card>
      </div>

      <div className="flex-shrink-0 border-t border-[#404040] bg-[#1A1A1A] px-6 py-3 flex items-center justify-between gap-3">
        <div className="text-xs text-gray-400 space-y-1 min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
            <span>
              <span className="text-gray-200 font-semibold tabular-nums">{selectedIds.size}</span> checked
            </span>
            {hasNarrowingFilters ? (
              <>
                <span className="text-gray-600">·</span>
                <span>
                  <span className="text-[#24E1B1] font-semibold tabular-nums">{selectedInFilteredView}</span> in view
                </span>
                <span className="text-gray-600">·</span>
                <span>
                  <span className="tabular-nums text-gray-300">{filteredRows.length}</span> visible
                  <span className="text-gray-600"> / </span>
                  <span className="tabular-nums">{rows.length}</span> scanned
                </span>
              </>
            ) : (
              <>
                <span className="text-gray-600">·</span>
                <span>
                  <span className="tabular-nums text-gray-300">{rows.length}</span> in scan
                </span>
              </>
            )}
            {selectedIds.size > 0 && (
              <span className="text-gray-500">
                <span className="text-gray-600"> · </span>~{publishJobPreviewCount} queue job{publishJobPreviewCount !== 1 ? "s" : ""}
              </span>
            )}
          </p>
          {hasNarrowingFilters && hiddenSelectedCount > 0 && (
            <p className="text-[10px] text-amber-400/95 leading-snug">
              {hiddenSelectedCount} checked row{hiddenSelectedCount !== 1 ? "s are" : " is"} hidden by filters and will still publish. Use{" "}
              <span className="font-semibold">Keep only visible in selection</span> to untick them.
            </p>
          )}
        </div>
        <Button
          type="button"
          className="h-10 px-6 bg-[#0096D6] hover:bg-[#0085bd] text-white gap-2"
          onClick={handlePublishSelected}
          disabled={selectedIds.size === 0 || rows.length === 0 || isPublishing}
        >
          {isPublishing ? <Spinner size="sm" /> : <Send className="w-4 h-4" />}
          Publish Selected
        </Button>
      </div>
    </div>
  )
}
