"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/hooks/use-auth"
import { useContextStore } from "@/hooks/use-context-store"
import { usePublishQueue } from "@/hooks/usePublishQueue"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Sparkles,
  X,
} from "lucide-react"
import {
  createProjectFromWizard,
  loadTaskOptions,
  type WizardData,
  type WizardSequenceData,
  type WizardShotData,
  type CreateProjectResult,
} from "@/lib/project-wizard-service"
import {
  COL_AUTO,
  MAPPING_LABELS,
  parseStructuredWorkDescription,
  parseHtmlTableToRows,
  parsePlainTextToRows,
  detectShotPatternsFromRows,
  applyColumnMapping,
  getShotNameMatchedRows,
  computeWizardShotCode,
  type ColumnMapping,
  type ParsedShotRow,
} from "@/lib/smart-paste"
import { parsePathContext } from "@/lib/path-context"
import { cn } from "@/lib/utils"
import { getErrorMessage } from "@/lib/error-message"
import { canOpenProjectCreationWizard } from "@/lib/publisher-permissions"

interface TaskOption {
  code: string
  label: string
}

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6

interface IpcRendererLike {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

type ScanMediaType = "sequence" | "video"
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

function normalizeToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function findBestShotMatch(
  item: RawScanItem,
  shots: Array<{ id: string; shot_code: string; sequence_name: string; episode_id?: string | null; episode_code?: string | null }>
): (typeof shots)[0] | null {
  if (!shots.length) return null
  const shotsByCode = new Map<string, (typeof shots)[0]>()
  shots.forEach((s) => shotsByCode.set(normalizeToken(s.shot_code), s))

  const pathCandidates = [item.path, item.folder, item.name].filter((v): v is string => Boolean(v))
  for (const candidate of pathCandidates) {
    const parsed = parsePathContext(candidate)
    if (parsed.shotCode) {
      const exact = shotsByCode.get(normalizeToken(parsed.shotCode))
      if (exact) return exact
    }
  }

  const normalizedName = normalizeToken(item.name)
  const ranked = shots
    .map((s) => ({ shot: s, key: normalizeToken(s.shot_code) }))
    .filter((e) => normalizedName.includes(e.key) || e.key.includes(normalizedName))
    .sort((a, b) => b.key.length - a.key.length)

  return ranked[0]?.shot ?? null
}

function buildSequenceInputPath(item: RawScanItem): string | null {
  if (!item.folder || !item.prefix || !item.extension || item.start == null) return null
  const padding = item.file_pattern?.match(/#+/)?.[0]?.length ?? String(item.start).length
  const frame = String(item.start).padStart(padding, "0")
  const sep = item.folder.endsWith("\\") || item.folder.endsWith("/") ? "" : "\\"
  return `${item.folder}${sep}${item.prefix}${frame}.${item.extension}`
}

export interface ProjectCreationWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  onNavigateToQueue?: () => void
}

export function ProjectCreationWizard({
  open,
  onOpenChange,
  onSuccess,
  onNavigateToQueue,
}: ProjectCreationWizardProps) {
  const { profile, user } = useAuth()
  const { setProjectId } = useContextStore()
  const { addJob, processNextJob } = usePublishQueue()
  const queryClient = useQueryClient()

  const [currentStep, setCurrentStep] = useState<WizardStep>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [taskOptions, setTaskOptions] = useState<TaskOption[]>([])

  const [projectType, setProjectType] = useState<"Film" | "TV Episode">("Film")
  const [projectInfo, setProjectInfo] = useState({
    name: "",
    code: "",
    description: "",
    start_date: new Date().toISOString().split("T")[0],
    delivery_date: "",
    client_name: "",
    status: "Active" as const,
  })
  const [episodes, setEpisodes] = useState<Array<{ episode_number: number; code: string; name: string | null; air_date: string | null }>>([])
  const [selectedEpisodeForSequences, setSelectedEpisodeForSequences] = useState("")
  const [selectedEpisodeForShots, setSelectedEpisodeForShots] = useState("")
  const [sequences, setSequences] = useState<WizardSequenceData[]>([])
  const [selectedSequenceForShots, setSelectedSequenceForShots] = useState("")
  const [allShots, setAllShots] = useState<WizardShotData[]>([])
  const [detectedShots, setDetectedShots] = useState<WizardShotData[]>([])
  const [creationProgress, setCreationProgress] = useState<{ current: number; total: number; shotCode: string } | null>(null)

  // Step 6: Bulk Ingest
  const [createResult, setCreateResult] = useState<CreateProjectResult | null>(null)
  const [ingestLoading, setIngestLoading] = useState(false)

  const pasteTargetRef = useRef<HTMLDivElement>(null)
  const [pastedRows, setPastedRows] = useState<string[][]>([])
  const [exampleShotName, setExampleShotName] = useState("")
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(false)
  const [showSmartPaste, setShowSmartPaste] = useState(false)
  const [pendingParsedRows, setPendingParsedRows] = useState<ParsedShotRow[] | null>(null)
  const [smartPasteColumnMapping, setSmartPasteColumnMapping] = useState<ColumnMapping | null>(null)
  const [smartPasteRawRows, setSmartPasteRawRows] = useState<string[][]>([])
  const [isSmartPasteConfirmed, setIsSmartPasteConfirmed] = useState(false)

  /** Clears detection results so counts stay in sync with the current paste (avoids stale "Populate N rows" after re-paste). */
  const resetSmartPasteDetection = useCallback(() => {
    setPendingParsedRows(null)
    setSmartPasteRawRows([])
    setSmartPasteColumnMapping(null)
    setIsSmartPasteConfirmed(false)
  }, [])

  const canUseWizard = canOpenProjectCreationWizard(profile?.role)

  useEffect(() => {
    if (open && canUseWizard) {
      loadTaskOptions().then((opts) => setTaskOptions(opts))
    }
  }, [open, canUseWizard])

  useEffect(() => {
    if (!open) {
      setCurrentStep(0)
      setProjectType("Film")
      setProjectInfo({
        name: "",
        code: "",
        description: "",
        start_date: new Date().toISOString().split("T")[0],
        delivery_date: "",
        client_name: "",
        status: "Active",
      })
      setEpisodes([])
      setSelectedEpisodeForSequences("")
      setSelectedEpisodeForShots("")
      setSequences([])
      setSelectedSequenceForShots("")
      setAllShots([])
      setDetectedShots([])
      setPastedRows([])
      setExampleShotName("")
      setError("")
      setCreateResult(null)
      setCreationProgress(null)
      setShowSmartPaste(false)
      setPendingParsedRows(null)
      setSmartPasteColumnMapping(null)
      setSmartPasteRawRows([])
      setIsSmartPasteConfirmed(false)
    }
  }, [open])

  // On Shots step: auto-select first episode and first sequence so dropdowns work (like ctrack_v0 wizard)
  const isShotsStep = (currentStep === 3 && projectType === "Film") || (currentStep === 4 && projectType === "TV Episode")
  useEffect(() => {
    if (!isShotsStep) return
    if (projectType === "TV Episode" && episodes.length > 0 && !selectedEpisodeForShots) {
      setSelectedEpisodeForShots(episodes[0].code)
    }
  }, [isShotsStep, projectType, episodes, selectedEpisodeForShots])
  useEffect(() => {
    if (!isShotsStep) return
    const filteredSeqs = projectType === "TV Episode"
      ? sequences.filter((s) => s.episode_id === selectedEpisodeForShots)
      : sequences
    if (filteredSeqs.length === 0) {
      if (selectedSequenceForShots) setSelectedSequenceForShots("")
      return
    }
    const currentInList = filteredSeqs.some((s) => s.code === selectedSequenceForShots)
    if (!currentInList || !selectedSequenceForShots) {
      setSelectedSequenceForShots(filteredSeqs[0].code)
    }
  }, [isShotsStep, projectType, sequences, selectedEpisodeForShots, selectedSequenceForShots])

  function generateProjectCode(name: string): string {
    if (!name.trim()) return ""
    return name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
  }

  function handleProjectNameChange(name: string) {
    setProjectInfo((p) => ({ ...p, name, code: p.code || generateProjectCode(name) }))
  }

  function handleAddEpisode() {
    const n = episodes.length + 1
    setEpisodes((prev) => [
      ...prev,
      { episode_number: n, code: `EP${String(n).padStart(2, "0")}`, name: null, air_date: null },
    ])
  }

  function handleUpdateEpisode(i: number, field: string, value: unknown) {
    setEpisodes((prev) => prev.map((ep, idx) => (idx === i ? { ...ep, [field]: value } : ep)))
  }

  function handleDeleteEpisode(i: number) {
    setEpisodes((prev) => prev.filter((_, idx) => idx !== i))
  }

  function handleAddSequence() {
    setSequences((prev) => [
      ...prev,
      {
        episode_id: projectType === "TV Episode" ? selectedEpisodeForSequences : undefined,
        name: `Sequence ${prev.length + 1}`,
        code: `SQ${String(prev.length + 1).padStart(2, "0")}`,
        description: null,
      },
    ])
  }

  function handleUpdateSequence(i: number, field: keyof WizardSequenceData, value: string) {
    setSequences((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: field === "episode_id" ? value || undefined : value } : s))
    )
  }

  function handleDeleteSequence(i: number) {
    setSequences((prev) => prev.filter((_, idx) => idx !== i))
  }

  function handlePasteFromClipboard(e: React.ClipboardEvent) {
    e.preventDefault()
    const html = e.clipboardData.getData("text/html")
    const plain = e.clipboardData.getData("text/plain")
    let rows: string[][] = []
    if (html && html.includes("<table")) {
      rows = parseHtmlTableToRows(html)
    }
    if (rows.length === 0 && plain) {
      rows = parsePlainTextToRows(plain)
    }
    if (rows.length > 0) {
      setPastedRows(rows)
      setError("")
      resetSmartPasteDetection()
    }
  }

  function handleSmartPaste() {
    if (pastedRows.length === 0) {
      setError("Paste data first (click the paste area and Ctrl+V from Excel or CSV).")
      return
    }
    const useHeader = firstRowIsHeader
    const useExample = exampleShotName.trim().length > 0
    if (!useHeader && !useExample) {
      setError("Either check 'First row is header' or provide an example shot name so we can detect columns.")
      return
    }
    const { parsed, mapping, dataRows } = detectShotPatternsFromRows(
      pastedRows,
      exampleShotName.trim() || "SH001",
      firstRowIsHeader,
      null
    )
    if (parsed.length === 0 || dataRows.length === 0) {
      setError("Could not detect columns. Try 'First row is header' or add an example shot name (e.g. SH010).")
      return
    }
    setSmartPasteRawRows(dataRows)
    setSmartPasteColumnMapping(mapping)
    setPendingParsedRows(parsed)
    setIsSmartPasteConfirmed(false)
    setError("")
  }

  function handleSmartPasteMappingChange(field: keyof ColumnMapping, value: number) {
    if (!smartPasteColumnMapping || smartPasteRawRows.length === 0) return
    const next: ColumnMapping = { ...smartPasteColumnMapping, [field]: value }
    setSmartPasteColumnMapping(next)
    setPendingParsedRows(applyColumnMapping(smartPasteRawRows, next))
  }

  function handleConfirmSmartPasteAndPopulate() {
    const rowsToPopulate = pendingParsedRows ? getShotNameMatchedRows(pendingParsedRows) : []
    if (rowsToPopulate.length === 0) {
      setError("No rows with a matching shot name. Add an example shot name (e.g. STU101_006_0050) and ensure column mapping is correct.")
      return
    }
    if (!isSmartPasteConfirmed) {
      setError("Please confirm the mapping before populating.")
      return
    }
    const allowedTaskCodes = new Set(taskOptions.map((t) => t.code.toLowerCase()))
    const shots: WizardShotData[] = rowsToPopulate.map((p) => {
      const [startFrame, endFrame] = p.frameRange.includes("-")
        ? p.frameRange.split("-").map((n) => parseInt(n.trim(), 10))
        : [null, null]
      const detectedTaskCode = p.taskCode.trim().toLowerCase()
      const task_codes =
        detectedTaskCode && allowedTaskCodes.has(detectedTaskCode) ? [detectedTaskCode] : []
      const episodeCode = projectType === "TV Episode" ? selectedEpisodeForShots : undefined
      return {
        episode_id: episodeCode || undefined,
        sequence_name: selectedSequenceForShots,
        shot_name: p.shotName,
        shot_code: computeWizardShotCode(selectedSequenceForShots, p.shotName),
        description: p.notes ? parseStructuredWorkDescription(p.notes) || null : null,
        start_frame: Number.isFinite(startFrame) ? startFrame : null,
        end_frame: Number.isFinite(endFrame) ? endFrame : null,
        task_codes,
        enabled: true,
      }
    })
    setDetectedShots(shots)
    setPendingParsedRows(null)
    setIsSmartPasteConfirmed(false)
    setError("")
  }

  function handleAddDetectedShots() {
    setAllShots((prev) => [...prev, ...detectedShots])
    setDetectedShots([])
    setPastedRows([])
    setExampleShotName("")
    setShowSmartPaste(false)
    setSmartPasteRawRows([])
    setSmartPasteColumnMapping(null)
    setPendingParsedRows(null)
  }

  function handleAddManualShot() {
    if (projectType === "TV Episode" && !selectedEpisodeForShots) {
      setError("Select an episode first")
      return
    }
    if (!selectedSequenceForShots) {
      setError("Select a sequence first")
      return
    }
    setDetectedShots((prev) => [
      ...prev,
      {
        episode_id: projectType === "TV Episode" ? selectedEpisodeForShots : undefined,
        sequence_name: selectedSequenceForShots,
        shot_name: "",
        shot_code: selectedSequenceForShots ? `${selectedSequenceForShots}_` : "",
        description: null,
        start_frame: null,
        end_frame: null,
        task_codes: [],
        enabled: true,
      },
    ])
  }

  function handleUpdateDetectedShot(i: number, field: keyof WizardShotData, value: unknown) {
    setDetectedShots((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s
        const u = { ...s, [field]: value }
        if (field === "shot_name" || field === "sequence_name") {
          u.shot_code = computeWizardShotCode(u.sequence_name, u.shot_name)
        }
        return u
      })
    )
  }

  function handleDeleteDetectedShot(i: number) {
    setDetectedShots((prev) => prev.filter((_, idx) => idx !== i))
  }

  function handleNext() {
    setError("")
    if (currentStep === 0) setCurrentStep(1)
    else if (currentStep === 1) {
      if (!projectInfo.name.trim() || !projectInfo.code.trim()) {
        setError("Project name and code are required")
        return
      }
      setCurrentStep(2)
    } else if (currentStep === 2) {
      if (projectType === "TV Episode") {
        if (episodes.length === 0) {
          setError("Add at least one episode")
          return
        }
        if (episodes.length && !selectedEpisodeForSequences) setSelectedEpisodeForSequences(episodes[0].code)
        setCurrentStep(3)
      } else {
        if (sequences.length === 0) {
          setError("Add at least one sequence")
          return
        }
        setCurrentStep(3)
      }
    } else if (currentStep === 3) {
      if (projectType === "TV Episode") {
        if (sequences.length === 0) {
          setError("Add at least one sequence")
          return
        }
        setCurrentStep(4)
      } else {
        const next = detectedShots.length ? [...allShots, ...detectedShots] : allShots
        if (detectedShots.length) {
          setAllShots(next)
          setDetectedShots([])
        }
        if (next.length === 0) {
          setError("Add at least one shot")
          return
        }
        setCurrentStep(4)
      }
    } else if (currentStep === 4) {
      const next = detectedShots.length ? [...allShots, ...detectedShots] : allShots
      if (detectedShots.length) {
        setAllShots(next)
        setDetectedShots([])
      }
      if (next.length === 0) {
        setError("Add at least one shot")
        return
      }
      setCurrentStep(5)
    }
  }

  function handleBack() {
    if (currentStep > 0) setCurrentStep((prev) => (prev - 1) as WizardStep)
    setError("")
  }

  const handleCreateProject = useCallback(async () => {
    setLoading(true)
    setError("")
    setCreationProgress(null)

    const enabledShots = allShots.filter((s) => s.enabled)
    if (enabledShots.length) {
      setCreationProgress({ current: 0, total: enabledShots.length, shotCode: "Starting..." })
    }

    try {
      const wizardData: WizardData = {
        project: {
          project_type: projectType,
          name: projectInfo.name.trim(),
          code: projectInfo.code.trim().toUpperCase(),
          description: projectInfo.description?.trim() || "",
          start_date: projectInfo.start_date?.trim() || null,
          delivery_date: projectInfo.delivery_date?.trim() || null,
          client_name: projectInfo.client_name?.trim() || "",
          status: projectInfo.status,
          thumbnail_url: null,
        },
        episodes: projectType === "TV Episode" ? episodes : [],
        sequences: sequences.map((s) => ({
          ...s,
          episode_id: s.episode_id || undefined,
          name: s.name.trim(),
          code: s.code.trim().toUpperCase(),
          description: s.description?.trim() || null,
        })),
        shots: allShots.map((s) => ({
          ...s,
          episode_id: s.episode_id || undefined,
          shot_code: s.shot_code.toUpperCase(),
          sequence_name: s.sequence_name.toUpperCase(),
        })),
        creator_id: user?.id,
      }

      const result = await createProjectFromWizard(wizardData)
      setCreateResult(result)
      setCreationProgress({ current: enabledShots.length, total: enabledShots.length, shotCode: "Complete!" })

      setProjectId(result.projectId, result.projectCode)
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      queryClient.invalidateQueries({ queryKey: ["shots", result.projectId] })
      queryClient.invalidateQueries({ queryKey: ["episodes", result.projectId] })

      toast.success(`Project "${wizardData.project.name}" created with ${enabledShots.length} shots`)
      setCurrentStep(6)
    } catch (err: unknown) {
      const msg = getErrorMessage(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
      setCreationProgress(null)
    }
  }, [
    projectType,
    projectInfo,
    episodes,
    sequences,
    allShots,
    user?.id,
    setProjectId,
    queryClient,
  ])

  const handleSkipIngest = useCallback(() => {
    onOpenChange(false)
    onSuccess?.()
  }, [onOpenChange, onSuccess])

  const handleSelectFolderAndIngest = useCallback(async () => {
    if (!createResult) return
    const ipc = (window as unknown as { ipcRenderer?: IpcRendererLike }).ipcRenderer
    if (!ipc) {
      toast.error("IPC bridge not available")
      return
    }

    setIngestLoading(true)
    try {
      const folderPath = (await ipc.invoke("select-directory")) as string | null
      if (!folderPath) {
        setIngestLoading(false)
        return
      }

      const response = (await ipc.invoke("python-command", {
        command: "scan_folder",
        params: { folder_path: folderPath },
      })) as ScanFolderResponse

      if (response.status !== "success") {
        toast.error(response.message || "Scan failed")
        setIngestLoading(false)
        return
      }

      const items = response.data ?? []
      let queuedCount = 0

      for (const item of items) {
        const inputPath = item.type === "video" ? item.path ?? null : buildSequenceInputPath(item)
        if (!inputPath) continue

        const matchedShot = findBestShotMatch(item, createResult.shots)
        if (!matchedShot) continue

        const episodeCode = 'episode_code' in matchedShot ? matchedShot.episode_code : null
        const shotRootPath = episodeCode
          ? `Projects/${createResult.projectCode}/${episodeCode}/${matchedShot.sequence_name}/${matchedShot.shot_code}`
          : `Projects/${createResult.projectCode}/${matchedShot.sequence_name}/${matchedShot.shot_code}`

        const versionsBasePath = `${shotRootPath}/Versions`
        const elementsBasePath = `${shotRootPath}/Elements`
        const frameStart = item.start
        const frameEnd = item.end
        const frameRange =
          frameStart != null && frameEnd != null ? `${frameStart}-${frameEnd}` : undefined

        addJob(
          inputPath,
          { burnin: true, gif: true, metadata: { shot: matchedShot.shot_code, version: "v001", artist: "Bulk Ingest" } },
          {
            tab: "element",
            elementCategory: "media",
            elementType: "plate",
            elementNotes: "Bulk ingest",
            frameStart: frameStart ?? undefined,
            frameEnd: frameEnd ?? undefined,
            frameRange,
            storagePlan: {
              shotRootPath,
              versionsBasePath,
              elementsBasePath,
              sourceFrameRange:
                frameStart != null && frameEnd != null
                  ? { start: frameStart, end: frameEnd, count: item.count ?? null }
                  : undefined,
            },
          },
          {
            projectId: createResult.projectId,
            projectCode: createResult.projectCode,
            shotId: matchedShot.id,
            shotCode: matchedShot.shot_code,
            sequenceName: matchedShot.sequence_name,
          }
        )
        queuedCount++
      }

      if (queuedCount > 0) {
        setTimeout(() => processNextJob(), 100)
        toast.success(`Queued ${queuedCount} ingest job(s)`)
        onNavigateToQueue?.()
      } else {
        toast.info("No items matched shots. You can add manually from Bulk Ingest.")
      }

      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      toast.error("Ingest failed")
    } finally {
      setIngestLoading(false)
    }
  }, [createResult, addJob, processNextJob, onOpenChange, onSuccess, onNavigateToQueue])

  if (!open) return null
  if (!canUseWizard) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70">
        <Card className="bg-[#2A2A2A] border-[#404040] p-6 max-w-md">
          <p className="text-gray-300">Only admins and supervisors can create projects in Publisher.</p>
          <Button className="mt-4" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </Card>
      </div>
    )
  }

  const totalSteps = projectType === "TV Episode" ? 7 : 6
  const stepLabels: Record<WizardStep, string> = {
    0: "Project Type",
    1: "Project Info",
    2: projectType === "TV Episode" ? "Episodes" : "Sequences",
    3: projectType === "TV Episode" ? "Sequences" : "Shots",
    4: projectType === "TV Episode" ? "Shots" : "Review",
    5: "Review",
    6: "Bulk Ingest",
  }

  const canProceed: Record<number, boolean> = {
    0: true,
    1: !!projectInfo.name.trim() && !!projectInfo.code.trim(),
    2: projectType === "TV Episode" ? episodes.length > 0 : sequences.length > 0,
    3:
      projectType === "TV Episode"
        ? sequences.length > 0
        : allShots.length > 0 || detectedShots.length > 0,
    4: allShots.length > 0 || detectedShots.length > 0,
    5: true,
    6: true,
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="bg-[#2A2A2A] border border-[#404040] rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto text-white">
        <div className="p-6 border-b border-[#404040] flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">Create New Project</h2>
            <p className="text-gray-400 text-sm mt-1">
              Step {currentStep + 1} of {totalSteps}: {stepLabels[currentStep]}
            </p>
            <div className="flex gap-2 mt-4">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs",
                  currentStep >= i ? "bg-[#0096D6] text-white" : "bg-[#333333] text-gray-500"
                )}
              >
                {i + 1}
              </div>
            ))}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-9 w-9 rounded-lg text-gray-400 hover:text-white hover:bg-[#404040]"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6">
          {error && (
            <Alert className="mb-4 bg-red-900/30 border-red-800 text-red-300">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Step 0: Project Type */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <p className="text-gray-400">Select project type</p>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setProjectType("Film")}
                  className={cn(
                    "flex-1 p-4 rounded-lg border-2 transition-colors text-left",
                    projectType === "Film"
                      ? "border-[#0096D6] bg-[#0096D6]/10"
                      : "border-[#404040] bg-[#333333] hover:border-[#505050]"
                  )}
                >
                  <div className="font-medium text-white">Film</div>
                  <div className="text-sm text-gray-400">Project → Sequences → Shots</div>
                </button>
                <button
                  type="button"
                  onClick={() => setProjectType("TV Episode")}
                  className={cn(
                    "flex-1 p-4 rounded-lg border-2 transition-colors text-left",
                    projectType === "TV Episode"
                      ? "border-[#0096D6] bg-[#0096D6]/10"
                      : "border-[#404040] bg-[#333333] hover:border-[#505050]"
                  )}
                >
                  <div className="font-medium text-white">TV Episode</div>
                  <div className="text-sm text-gray-400">Project → Episodes → Sequences → Shots</div>
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Project Info */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">Project Name *</label>
                <Input
                  value={projectInfo.name}
                  onChange={(e) => handleProjectNameChange(e.target.value)}
                  className="bg-[#333333] border-[#404040] text-white"
                  placeholder="Cosmic Odyssey"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Project Code *</label>
                <Input
                  value={projectInfo.code}
                  onChange={(e) => setProjectInfo({ ...projectInfo, code: e.target.value.toUpperCase() })}
                  className="bg-[#333333] border-[#404040] text-white"
                  placeholder="PRJ_001"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Description</label>
                <textarea
                  value={projectInfo.description}
                  onChange={(e) => setProjectInfo({ ...projectInfo, description: e.target.value })}
                  className="w-full min-h-[80px] rounded-md border border-[#404040] bg-[#333333] px-3 py-2 text-white"
                  placeholder="Project description..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-1">Start Date</label>
                  <Input
                    type="date"
                    value={projectInfo.start_date}
                    onChange={(e) => setProjectInfo({ ...projectInfo, start_date: e.target.value })}
                    className="bg-[#333333] border-[#404040] text-white"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-1">Delivery Date</label>
                  <Input
                    type="date"
                    value={projectInfo.delivery_date}
                    onChange={(e) => setProjectInfo({ ...projectInfo, delivery_date: e.target.value })}
                    className="bg-[#333333] border-[#404040] text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Client Name</label>
                <Input
                  value={projectInfo.client_name}
                  onChange={(e) => setProjectInfo({ ...projectInfo, client_name: e.target.value })}
                  className="bg-[#333333] border-[#404040] text-white"
                  placeholder="Client..."
                />
              </div>
            </div>
          )}

          {/* Step 2: Episodes (TV) or Sequences (Film) */}
          {currentStep === 2 && projectType === "TV Episode" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-gray-400">Episodes</p>
                <Button onClick={handleAddEpisode} variant="outline" className="border-[#404040] bg-[#333333]">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Episode
                </Button>
              </div>
              {episodes.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No episodes. Click Add Episode.</p>
              ) : (
                <div className="space-y-3">
                  {episodes.map((ep, i) => (
                    <Card key={i} className="bg-[#333333] border-[#404040] p-4">
                      <div className="grid grid-cols-4 gap-4">
                        <div>
                          <label className="text-xs text-gray-400">Number</label>
                          <Input
                            type="number"
                            value={ep.episode_number}
                            onChange={(e) => handleUpdateEpisode(i, "episode_number", parseInt(e.target.value, 10) || 1)}
                            className="bg-[#2A2A2A] border-[#404040] text-white h-9"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400">Code</label>
                          <Input
                            value={ep.code}
                            onChange={(e) => handleUpdateEpisode(i, "code", e.target.value.toUpperCase())}
                            className="bg-[#2A2A2A] border-[#404040] text-white h-9"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400">Name</label>
                          <Input
                            value={ep.name || ""}
                            onChange={(e) => handleUpdateEpisode(i, "name", e.target.value)}
                            className="bg-[#2A2A2A] border-[#404040] text-white h-9"
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteEpisode(i)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {currentStep === 2 && projectType === "Film" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-gray-400">Sequences</p>
                <Button onClick={handleAddSequence} variant="outline" className="border-[#404040] bg-[#333333]">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Sequence
                </Button>
              </div>
              {sequences.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No sequences. Click Add Sequence.</p>
              ) : (
                <div className="space-y-3">
                  {sequences.map((seq, i) => (
                    <Card key={i} className="bg-[#333333] border-[#404040] p-4">
                      <div className="flex gap-4">
                        <Input
                          placeholder="Sequence name"
                          value={seq.name}
                          onChange={(e) => handleUpdateSequence(i, "name", e.target.value)}
                          className="bg-[#2A2A2A] border-[#404040] text-white flex-1"
                        />
                        <Input
                          placeholder="Code"
                          value={seq.code}
                          onChange={(e) => handleUpdateSequence(i, "code", e.target.value.toUpperCase())}
                          className="bg-[#2A2A2A] border-[#404040] text-white w-24"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteSequence(i)}
                          className="text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Sequences (TV) */}
          {currentStep === 3 && projectType === "TV Episode" && (
            <div className="space-y-4">
              <div className="mb-4">
                <label className="block text-gray-400 mb-2">Episode for sequences</label>
                <Select value={selectedEpisodeForSequences} onValueChange={setSelectedEpisodeForSequences}>
                  <SelectTrigger className="bg-[#333333] border-[#404040] text-white w-64">
                    <SelectValue placeholder="Select episode" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#2A2A2A] border-[#404040] text-white">
                    {episodes.map((ep) => (
                      <SelectItem key={ep.code} value={ep.code} className="text-white focus:bg-[#0096D6]">
                        {ep.code} - {ep.name || `Episode ${ep.episode_number}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-gray-400">Sequences</p>
                <Button
                  onClick={handleAddSequence}
                  variant="outline"
                  className="border-[#404040] bg-[#333333]"
                  disabled={!selectedEpisodeForSequences}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Sequence
                </Button>
              </div>
              {sequences.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Select episode and add sequences.</p>
              ) : (
                <div className="space-y-3">
                  {sequences.map((seq, i) => (
                    <Card key={i} className="bg-[#333333] border-[#404040] p-4">
                      <div className="flex gap-4">
                        <Input
                          placeholder="Sequence name"
                          value={seq.name}
                          onChange={(e) => handleUpdateSequence(i, "name", e.target.value)}
                          className="bg-[#2A2A2A] border-[#404040] text-white flex-1"
                        />
                        <Input
                          placeholder="Code"
                          value={seq.code}
                          onChange={(e) => handleUpdateSequence(i, "code", e.target.value.toUpperCase())}
                          className="bg-[#2A2A2A] border-[#404040] text-white w-24"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteSequence(i)}
                          className="text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3 (Film) or 4 (TV): Shots */}
          {((currentStep === 3 && projectType === "Film") || (currentStep === 4 && projectType === "TV Episode")) && (
            <div className="space-y-4">
              {projectType === "TV Episode" && (
                <div className="mb-4">
                  <label className="block text-gray-400 mb-2">Episode</label>
                  <Select value={selectedEpisodeForShots} onValueChange={setSelectedEpisodeForShots}>
                    <SelectTrigger className="bg-[#333333] border-[#404040] text-white w-64">
                      <SelectValue placeholder="Select episode" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#2A2A2A] border-[#404040] text-white">
                      {episodes.map((ep) => (
                        <SelectItem key={ep.code} value={ep.code} className="text-white focus:bg-[#0096D6]">
                          {ep.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <label className="block text-gray-400 mb-2">Sequence</label>
                <Select value={selectedSequenceForShots} onValueChange={setSelectedSequenceForShots}>
                  <SelectTrigger className="bg-[#333333] border-[#404040] text-white w-64">
                    <SelectValue placeholder="Select sequence" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#2A2A2A] border-[#404040] text-white max-h-48">
                    {sequences
                      .filter((s) => (projectType === "TV Episode" ? s.episode_id === selectedEpisodeForShots : true))
                      .map((seq) => (
                        <SelectItem key={seq.code} value={seq.code} className="text-white focus:bg-[#0096D6]">
                          {seq.code} - {seq.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => setShowSmartPaste(!showSmartPaste)}
                  variant="outline"
                  className="border-[#404040] bg-[#333333] text-gray-200 hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={
                    (projectType === "TV Episode" && (!selectedEpisodeForShots || !selectedSequenceForShots)) ||
                    (projectType === "Film" && !selectedSequenceForShots)
                  }
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Smart Paste
                </Button>
                <Button onClick={handleAddManualShot} variant="outline" className="border-[#404040] bg-[#333333]">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Shot
                </Button>
              </div>

              {showSmartPaste && (
                <Card className="bg-[#333333] border-[#404040]">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-white text-sm">Smart Paste — Shot import</CardTitle>
                    <CardDescription className="text-gray-400 text-xs">
                      Paste from Excel or CSV (tab, pipe, or comma). Use header row or example shot name. Cells with
                      &quot;Scope:&quot; and &quot;Shot Description:&quot; are parsed automatically. We&apos;ll detect the
                      columns, show the first row, then you confirm to populate all rows.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="first-row-header"
                        checked={firstRowIsHeader}
                        onCheckedChange={(v) => {
                          setFirstRowIsHeader(Boolean(v))
                          resetSmartPasteDetection()
                        }}
                        className="border-gray-400 data-[state=checked]:bg-[#0096D6] h-5 w-5"
                      />
                      <label htmlFor="first-row-header" className="text-gray-300 text-sm cursor-pointer">
                        First row is header (Shot, Task, Notes, etc.)
                      </label>
                    </div>
                    <div>
                      <label className="text-gray-400 mb-1 block text-xs">Paste from Excel or CSV</label>
                      {pastedRows.length === 0 ? (
                        <div
                          ref={pasteTargetRef}
                          tabIndex={0}
                          role="button"
                          onPaste={handlePasteFromClipboard}
                          onClick={() => pasteTargetRef.current?.focus()}
                          onKeyDown={(e) => e.key === "Enter" && pasteTargetRef.current?.focus()}
                          className="border-2 border-dashed border-gray-500 rounded-lg bg-[#2A2A2A] min-h-[100px] flex flex-col items-center justify-center gap-2 py-6 cursor-pointer hover:border-[#0096D6] hover:bg-[#333333] transition-colors outline-none focus:border-[#0096D6]"
                          aria-label="Paste table or text from Excel or CSV"
                        >
                          <p className="text-gray-400 text-sm">Click here, then paste (Ctrl+V)</p>
                          <p className="text-gray-500 text-xs">Table or text — we show columns and rows so you can map them</p>
                        </div>
                      ) : (
                        <div className="rounded-md border border-[#404040] bg-[#1A1A1A] overflow-hidden">
                          <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#404040] bg-[#252525]">
                            <span className="text-gray-400 text-xs">Pasted as table — map columns below</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-[10px] h-7 text-gray-400 hover:text-white"
                              onClick={() => {
                                setPastedRows([])
                                resetSmartPasteDetection()
                              }}
                            >
                              Clear / Paste again
                            </Button>
                          </div>
                          <div className="max-h-52 overflow-auto overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-[#404040]">
                                  <th className="text-gray-500 font-mono w-8 shrink-0 bg-[#252525] sticky left-0 z-10 border-r border-[#404040] px-2 py-1">#</th>
                                  {Array.from({ length: Math.max(...pastedRows.map((r) => r.length), 0) }, (_, i) => (
                                    <th key={i} className="text-[#0096D6] font-mono whitespace-nowrap bg-[#252525] px-2 py-1">
                                      Col {i + 1}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {pastedRows.map((row, rowIdx) => (
                                  <tr key={rowIdx} className="border-[#404040] hover:bg-[#252525]">
                                    <td className="text-gray-500 font-mono w-8 shrink-0 bg-[#222] sticky left-0 z-10 py-1 border-r border-[#404040] px-2">
                                      {rowIdx + 1}
                                    </td>
                                    {Array.from({ length: Math.max(...pastedRows.map((r) => r.length), 0) }, (_, colIdx) => (
                                      <td
                                        key={colIdx}
                                        className="text-white font-mono max-w-[200px] truncate px-2 py-1 whitespace-nowrap"
                                        title={String(row[colIdx] ?? "")}
                                      >
                                        {String(row[colIdx] ?? "").trim() || "—"}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[10px] text-gray-500 px-2 pb-2">
                            {pastedRows.length} rows × {Math.max(...pastedRows.map((r) => r.length), 0)} columns
                          </p>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-gray-400 mb-1 block text-xs">Example shot name (if no header)</label>
                      <Input
                        value={exampleShotName}
                        onChange={(e) => setExampleShotName(e.target.value)}
                        className="bg-[#2A2A2A] border-gray-400 text-white placeholder:text-gray-500"
                        placeholder="e.g. SH010 or SQ01_SH010"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={handleSmartPaste}
                      className="bg-[#0096D6] hover:bg-[#0096D6]/90"
                      disabled={pastedRows.length === 0 || (!firstRowIsHeader && !exampleShotName.trim())}
                    >
                      Detect Pattern
                    </Button>

                    {pendingParsedRows &&
                      pendingParsedRows.length > 0 &&
                      smartPasteColumnMapping &&
                      smartPasteRawRows[0] && (
                        <>
                          <div className="rounded-md border border-[#404040] bg-[#2A2A2A] p-3 space-y-3">
                            <p className="text-xs font-medium text-gray-300">Column mapping — adjust if needed</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {(Object.keys(MAPPING_LABELS) as (keyof ColumnMapping)[]).map((field) => {
                                const numCols = smartPasteRawRows[0].length
                                const value = smartPasteColumnMapping[field]
                                return (
                                  <div key={field} className="flex items-center gap-2">
                                    <label className="text-gray-400 text-xs w-36 shrink-0">{MAPPING_LABELS[field]}</label>
                                    <Select
                                      value={String(value)}
                                      onValueChange={(v) => handleSmartPasteMappingChange(field, Number.parseInt(v, 10))}
                                    >
                                      <SelectTrigger className="bg-[#1A1A1A] border-[#404040] text-white text-xs h-8">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={String(COL_AUTO)} className="text-white">
                                          Don&apos;t use
                                        </SelectItem>
                                        {Array.from({ length: numCols }, (_, i) => (
                                          <SelectItem key={i} value={String(i)} className="text-white">
                                            Column {i + 1}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                )
                              })}
                            </div>
                            <p className="text-xs text-gray-400 pt-1">First row preview:</p>
                            <div className="grid grid-cols-12 gap-2 text-xs">
                              <div className="col-span-4">
                                <span className="text-gray-500">Shot</span>
                                <div className="text-white font-mono truncate">{pendingParsedRows[0].shotName || "—"}</div>
                              </div>
                              <div className="col-span-2">
                                <span className="text-gray-500">Task</span>
                                <div className="text-white font-mono truncate">{pendingParsedRows[0].taskCode || "—"}</div>
                              </div>
                              <div className="col-span-4">
                                <span className="text-gray-500">Notes</span>
                                <div className="text-white truncate">{pendingParsedRows[0].notes || "—"}</div>
                                {pendingParsedRows[0].notes &&
                                  parseStructuredWorkDescription(pendingParsedRows[0].notes) !== pendingParsedRows[0].notes.trim() && (
                                    <div className="text-gray-500 text-[10px] mt-0.5 truncate">
                                      Parsed: {parseStructuredWorkDescription(pendingParsedRows[0].notes)}
                                    </div>
                                  )}
                              </div>
                              <div className="col-span-2">
                                <span className="text-gray-500">Frames</span>
                                <div className="text-white font-mono truncate">{pendingParsedRows[0].frameRange || "—"}</div>
                              </div>
                            </div>
                          </div>
                          {(() => {
                            const matchedRows = getShotNameMatchedRows(pendingParsedRows)
                            const matchedCount = matchedRows.length
                            const noMatches = matchedCount === 0
                            return (
                              <>
                                <p className="text-[10px] text-gray-500">
                                  Paste preview: {pastedRows.length} row{pastedRows.length === 1 ? "" : "s"}
                                  {firstRowIsHeader ? " (first row = header)" : ""} → {smartPasteRawRows.length} data row
                                  {smartPasteRawRows.length === 1 ? "" : "s"} after detection.
                                </p>
                                {noMatches && (
                                  <p className="text-amber-400 text-xs">
                                    No rows have a shot name in the mapped column (or every first cell looks like a header label).
                                    Fix column mapping or paste options.
                                  </p>
                                )}
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={isSmartPasteConfirmed}
                                    onCheckedChange={(v) => setIsSmartPasteConfirmed(Boolean(v))}
                                    className="border-gray-400 data-[state=checked]:bg-[#0096D6] h-5 w-5"
                                  />
                                  <label className="text-white text-sm">
                                    Mapping is correct — import {matchedCount} row{matchedCount === 1 ? "" : "s"} with a shot name
                                  </label>
                                </div>
                                <Button
                                  type="button"
                                  onClick={handleConfirmSmartPasteAndPopulate}
                                  className="bg-[#0096D6] hover:bg-[#0096D6]/90 disabled:opacity-50"
                                  disabled={!isSmartPasteConfirmed || noMatches}
                                >
                                  Populate {matchedCount} rows
                                </Button>
                              </>
                            )
                          })()}
                        </>
                      )}
                  </CardContent>
                </Card>
              )}

              {detectedShots.length > 0 && (
                <div className="space-y-2">
                  <p className="text-gray-400">Detected shots ({detectedShots.length})</p>
                  <div className="max-h-48 overflow-auto space-y-1">
                    {detectedShots.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 bg-[#333333] rounded px-3 py-2 text-sm"
                      >
                        <Input
                          value={s.shot_name}
                          onChange={(e) => handleUpdateDetectedShot(i, "shot_name", e.target.value)}
                          className="flex-1 bg-[#2A2A2A] border-[#404040] text-white h-8 text-xs"
                          placeholder="Shot name"
                        />
                        <span className="text-gray-400 text-xs">{s.shot_code}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDetectedShot(i)}
                          className="text-red-400 h-8 w-8 p-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button onClick={handleAddDetectedShots} className="border-[#0096D6] text-[#0096D6]">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Add to list
                  </Button>
                </div>
              )}

              {allShots.length > 0 && (
                <div>
                  <p className="text-gray-400 text-sm mb-2">
                    Shots already in list: {allShots.length}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 4 (Film) or 5 (TV): Review */}
          {((currentStep === 4 && projectType === "Film") || (currentStep === 5 && projectType === "TV Episode")) && (
            <div className="space-y-4">
              <Card className="bg-[#333333] border-[#404040] p-4">
                <p className="text-white font-medium">Summary</p>
                <div className="text-sm text-gray-400 mt-2 space-y-1">
                  <p>Name: {projectInfo.name}</p>
                  <p>Code: {projectInfo.code}</p>
                  <p>Sequences: {sequences.length}</p>
                  <p>Shots: {allShots.filter((s) => s.enabled).length} enabled</p>
                </div>
              </Card>
              {creationProgress && (
                <div className="space-y-2">
                  <p className="text-gray-400 text-sm">
                    {creationProgress.current} / {creationProgress.total}: {creationProgress.shotCode}
                  </p>
                  <div className="h-2 bg-[#2A2A2A] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#0096D6] transition-all"
                      style={{
                        width: `${Math.min(100, (creationProgress.current / creationProgress.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 6: Bulk Ingest */}
          {currentStep === 6 && createResult && (
            <div className="space-y-4">
              <Card className="bg-[#333333] border-[#404040] p-6">
                <CardTitle className="text-white text-lg">Ingest elements?</CardTitle>
                <CardDescription className="text-gray-400 mt-1">
                  Select a folder to scan and queue media for the {createResult.shots.length} new shots.
                </CardDescription>
                <div className="flex gap-3 mt-6">
                  <Button
                    onClick={handleSkipIngest}
                    variant="outline"
                    className="border-[#404040] bg-[#333333] text-gray-200"
                  >
                    Skip
                  </Button>
                  <Button
                    onClick={handleSelectFolderAndIngest}
                    disabled={ingestLoading}
                    className="bg-[#0096D6] hover:bg-[#0085bd]"
                  >
                    {ingestLoading ? (
                      <Spinner size="sm" className="mr-2" />
                    ) : (
                      <FolderOpen className="h-4 w-4 mr-2" />
                    )}
                    Select Folder & Ingest
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[#404040] flex justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0 || loading || currentStep === 6}
            className="border-[#404040] bg-[#333333] text-gray-200"
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {(projectType === "Film" ? currentStep < 4 : currentStep < 5) ? (
            <Button
              onClick={handleNext}
              disabled={!canProceed[currentStep] || loading}
              className="bg-[#0096D6] hover:bg-[#0096D6]/90"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (projectType === "Film" && currentStep === 4) || (projectType === "TV Episode" && currentStep === 5) ? (
            <Button
              onClick={handleCreateProject}
              disabled={loading || allShots.filter((s) => s.enabled).length === 0}
              className="bg-[#0096D6] hover:bg-[#0096D6]/90"
            >
              {loading ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Project
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
