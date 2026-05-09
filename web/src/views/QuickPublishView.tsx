"use client"

import { useState, useCallback, useEffect } from "react"
import { ContextBar } from "@/components/layout/ContextBar"
import { StagingZone } from "@/components/layout/StagingZone"
import { usePublishQueue } from "@/hooks/usePublishQueue"
import {
    useTasks,
    useNotificationRecipients,
    useNextVersionNumber,
    useNextElementLabel,
    useNextTrackingNumber,
} from "@/hooks/use-ctrack-data"
import { useContextStore } from "@/hooks/use-context-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { parsePathContext } from "@/lib/path-context"
import { getDirectoryFromFilePath } from "@/lib/path-utils"
import { findShotByCode } from "@/hooks/use-ctrack-data"
import { SequenceHealthBar } from "@/components/layout/SequenceHealthBar"
import { motion, AnimatePresence } from "framer-motion"
import { Layers, Film, Send, AlertTriangle } from "lucide-react"
import { useAppLogStore } from "@/store/app-log-store"
import type { StagingItem, StagingFormData } from "@/types/staging"
import type { StagingDropOptions } from "@/components/layout/StagingZone"

const NOTES_TEMPLATE = `Done:
-

To Do:
-`

interface QuickPublishViewProps {
    onNavigateToQueue?: () => void
}

export function QuickPublishView({ onNavigateToQueue }: QuickPublishViewProps) {
    const [activeTab, setActiveTab] = useState<"element" | "version">("version")
    const [deliveryType, setDeliveryType] = useState<"WIP" | "Final" | "Client Review">("WIP")
    const [versionOverride, setVersionOverride] = useState(false)
    const [versionName, setVersionName] = useState("v001")
    const [submissionNotes, setSubmissionNotes] = useState(NOTES_TEMPLATE)
    const [elementNotes, setElementNotes] = useState("")
    const [notifyUserIds, setNotifyUserIds] = useState<Set<string>>(new Set())
    const [staging, setStaging] = useState<StagingItem[]>([])
    const [shotMismatchWarning, setShotMismatchWarning] = useState<{ fileShotCode: string } | null>(null)

    const { addJob, processNextJob } = usePublishQueue()
    const { projectId, projectCode, episodeCode, sequenceName, shotId, shotCode, setProjectId, setShotId, taskId, setTaskId, elementCategory, setElementCategory, elementType, setElementType } = useContextStore()
    const { data: tasks, isLoading: tasksLoading } = useTasks(shotId || undefined)
    const { data: recipients, isLoading: recipientsLoading } = useNotificationRecipients()
    const { data: nextVersionNum } = useNextVersionNumber(shotId || undefined)
    const { data: nextElementLabel } = useNextElementLabel(shotId || undefined, elementType ?? undefined)
    const { data: nextTrackingNumber, status: nextTrackingStatus } = useNextTrackingNumber(projectId || undefined)

    const addLog = useAppLogStore((s) => s.addLog)

    const trackingNumber = nextTrackingNumber

    const canPublish = staging.length > 0 && !!shotId && (activeTab === "version" ? !!taskId : true)

    const suggestedElementLabel = (elementType === 'plate' ? 'v000' : (nextElementLabel ?? 'v001'))
    const versionDisplay = versionOverride ? versionName : (nextVersionNum != null ? `v${String(nextVersionNum).padStart(3, "0")}` : "v001")



    const handleNotifyToggle = useCallback((userId: string) => {
        setNotifyUserIds((prev) => {
            const next = new Set(prev)
            if (next.has(userId)) next.delete(userId)
            else next.add(userId)
            return next
        })
    }, [])

    const handleStagingDrop = useCallback((items: StagingItem[], options?: StagingDropOptions) => {
        const firstPath = options?.firstPath
        if (firstPath) {
            const { shotCode: parsedShotCode } = parsePathContext(firstPath)
            if (parsedShotCode) {
                findShotByCode(parsedShotCode).then((match) => {
                    if (match) {
                        setProjectId(match.projectId, match.projectCode)
                        setShotId(match.shotId, match.shotCode, match.sequenceName, match.episodeCode, match.episodeId)
                        addLog("info", `Smart-Fill: matched path to shot ${match.shotCode}`)
                    }
                }).catch(() => { /* ignore */ })
            }
        }
        // Replace staging with new items (don't accumulate — new drop replaces previous)
        const next = items
        const formData: StagingFormData = {
            projectId,
            shotId,
            taskId,
            tab: activeTab,
            elementType: elementType ?? undefined,
            deliveryType,
            submissionNotes,
            versionOverride,
            versionName: versionOverride ? versionName : versionDisplay,
        }
        ; (window as any).ipcRenderer?.invoke("staging:write", { items: next, formData })
        setStaging(next)
    }, [projectId, shotId, taskId, activeTab, elementNotes, elementCategory, elementType, deliveryType, submissionNotes, versionOverride, versionName, versionDisplay, setProjectId, setShotId, addLog])

    const handleStagingClear = useCallback(() => {
        setStaging([])
        ; (window as any).ipcRenderer?.invoke("staging:clear")
        addLog("info", "Staging cleared. Drop or browse to add files.")
    }, [addLog])

    useEffect(() => {
        ; (window as any).ipcRenderer?.invoke("staging:read").then((data: { items?: StagingItem[] } | null) => {
            if (data?.items?.length) setStaging(data.items)
        })
    }, [])

    const doPublish = useCallback((
        publishProjectId: string | null,
        publishShotId: string | null,
        publishShotCode: string | null,
        publishContext?: {
            projectCode?: string | null
            episodeCode?: string | null
            sequenceName?: string | null
        }
    ) => {
        setShotMismatchWarning(null)
        const meta = {
            tab: activeTab,
            elementNotes,
            elementCategory: elementCategory ?? undefined,
            elementType: elementType ?? undefined,
            deliveryType,
            submissionNotes,
            notifyUserIds: Array.from(notifyUserIds),
            versionOverride,
            versionName: versionOverride ? versionName : versionDisplay,
        }
        const payload = {
            projectId: publishProjectId,
            shotId: publishShotId,
            taskId,
            tab: activeTab,
            element: activeTab === "element" ? { elementNotes, elementCategory, elementType } : undefined,
            version: activeTab === "version" ? { deliveryType, submissionNotes, versionName: versionOverride ? versionName : versionDisplay } : undefined,
            files: staging.map((item) => ({
                filePath: item.filePath,
                fileName: item.fileName,
                size: item.size,
                frameStart: item.frameStart,
                frameEnd: item.frameEnd,
            })),
        }
        console.group("%c 📦 CTRACK PUBLISH PAYLOAD ", "background: #24E1B1; color: black; font-weight: bold; padding: 4px; border-radius: 4px;")
        console.log("Meta:", meta)
        console.table(payload.files)
        console.log("Full Payload:", payload)
        console.groupEnd()
        addLog("info", `Publish: project=${publishProjectId ?? "—"} shot=${publishShotId ?? "—"} tab=${activeTab} files=${staging.length}`)
        const newJobIds: string[] = []

        const selectedTask = (tasks || []).find((t: any) => t.id === taskId)
        const taskName = selectedTask ? selectedTask.name : "Other"

        staging.forEach((item) => {
            const frameRange = item.frameStart != null && item.frameEnd != null
                ? `${item.frameStart}-${item.frameEnd}`
                : undefined
            const jobMeta = {
                ...meta,
                frameStart: item.frameStart,
                frameEnd: item.frameEnd,
                frameRange,
            }
            const id = addJob(item.filePath, undefined, jobMeta, {
                projectId: publishProjectId,
                projectCode: publishContext?.projectCode ?? projectCode,
                episodeCode: publishContext?.episodeCode ?? episodeCode,
                shotId: publishShotId,
                shotCode: publishShotCode,
                sequenceName: publishContext?.sequenceName ?? sequenceName,
                taskId,
                taskName,
                trackingNumber
            })
            newJobIds.push(id)
        })
        setStaging([])
            ; (window as any).ipcRenderer?.invoke("staging:clear")
        onNavigateToQueue?.()
        addLog("info", `Added ${newJobIds.length} job(s) to queue; starting process (one at a time).`)
        setTimeout(() => processNextJob(), 100)
    }, [staging, projectCode, episodeCode, sequenceName, taskId, tasks, activeTab, elementNotes, elementCategory, elementType, deliveryType, submissionNotes, versionOverride, versionName, versionDisplay, trackingNumber, addJob, processNextJob, onNavigateToQueue, addLog])

    const handlePublishClick = useCallback(() => {
        if (staging.length === 0) return
        const firstPath = staging[0].filePath
        const { shotCode: fileShotCode } = parsePathContext(firstPath)
        const selectedCode = shotCode?.trim().toUpperCase() ?? ""

        if (fileShotCode && selectedCode && fileShotCode !== selectedCode) {
            addLog("warn", `Shot mismatch: selected "${selectedCode}" but file path suggests "${fileShotCode}"`)
            setShotMismatchWarning({ fileShotCode })
            return
        }
        doPublish(projectId, shotId, shotCode)
    }, [staging, shotCode, projectId, shotId, addLog, doPublish])

    const handleShotMismatchSelectRight = useCallback(async () => {
        if (!shotMismatchWarning) return
        const match = await findShotByCode(shotMismatchWarning.fileShotCode)
        if (match) {
            setProjectId(match.projectId, match.projectCode)
            setShotId(match.shotId, match.shotCode, match.sequenceName, match.episodeCode, match.episodeId)
            addLog("info", `Switched to shot ${match.shotCode} from file path`)
            doPublish(match.projectId, match.shotId, match.shotCode, {
                projectCode: match.projectCode,
                episodeCode: match.episodeCode,
                sequenceName: match.sequenceName,
            })
        } else {
            addLog("warn", `Shot "${shotMismatchWarning.fileShotCode}" not found in database. Select manually or Override.`)
        }
    }, [shotMismatchWarning, setProjectId, setShotId, addLog, doPublish])

    const handleShotMismatchOverride = useCallback(() => {
        doPublish(projectId, shotId, shotCode)
    }, [projectId, shotId, shotCode, doPublish])

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0f0f0f]">
            <ContextBar onNavigateToQueue={onNavigateToQueue} />

            <div className="shrink-0 border-b border-white/[0.06] bg-[#111]/90">
                <div className="mx-auto flex max-w-[1320px] items-center px-4 py-2.5 sm:px-6 lg:px-8">
                    <div className="inline-flex rounded-xl bg-[#0a0a0a] p-1 ring-1 ring-white/[0.06]">
                    <button
                        type="button"
                        onClick={() => setActiveTab("element")}
                        className={cn(
                            "rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition-all sm:px-5 sm:text-sm",
                            activeTab === "element"
                                ? "bg-white/[0.08] text-[#24E1B1] shadow-sm ring-1 ring-[#24E1B1]/30"
                                : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        <Layers className="mr-2 inline-block h-4 w-4 align-middle" />
                        Element
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab("version")}
                        className={cn(
                            "rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition-all sm:px-5 sm:text-sm",
                            activeTab === "version"
                                ? "bg-white/[0.08] text-[#24E1B1] shadow-sm ring-1 ring-[#24E1B1]/30"
                                : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        <Film className="mr-2 inline-block h-4 w-4 align-middle" />
                        Version
                    </button>
                    </div>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto flex max-w-[1320px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
                    <div className="sticky top-0 z-10 space-y-3 bg-[#0f0f0f]/95 pb-1 pt-0 backdrop-blur-md">
                        <StagingZone onDropItems={handleStagingDrop} onClear={handleStagingClear} items={staging} />
                        {staging.length > 0 && shotId && (() => {
                            const fc = parsePathContext(staging[0].filePath).shotCode
                            const sc = shotCode?.trim().toUpperCase() ?? ""
                            if (!fc || !sc || fc === sc) return null
                            return (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                                    <span className="text-[10px] text-amber-200">
                                        Shot mismatch: files from <strong>{fc}</strong> but <strong>{sc}</strong> selected. You’ll be prompted at Publish.
                                    </span>
                                </div>
                            )
                        })()}
                    </div>

                    <AnimatePresence mode="wait">
                        {activeTab === "element" && (
                            <motion.div
                                key="element"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                className="rounded-2xl border border-white/[0.07] bg-[#141414]/90 p-5 shadow-xl shadow-black/30 ring-1 ring-white/[0.04] backdrop-blur-sm space-y-4"
                            >
                                <div className="flex items-center justify-between">
                                    <h3 className="text-[11px] font-black text-white uppercase tracking-wider flex items-center gap-2">
                                        <Layers className="w-3.5 h-3.5 text-[#24E1B1]" />
                                        Element details
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {projectId && (
                                            <div className="flex items-center gap-2 px-2 py-1 bg-[#0096D6]/10 border border-[#0096D6]/20 rounded-md">
                                                <span className="text-[9px] font-black text-[#0096D6] uppercase">CTS</span>
                                                <span className="text-xs font-black text-white">
                                                    {trackingNumber || (nextTrackingStatus === 'pending' ? '…' : nextTrackingStatus === 'error' ? '!' : '…')}
                                                </span>
                                            </div>
                                        )}
                                        {staging.length > 0 && staging[0].frameStart != null && (
                                            <>
                                                <div className="flex items-center gap-2 px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded-md">
                                                    <span className="text-[9px] font-black text-purple-400 uppercase">Frames</span>
                                                    <span className="text-[10px] font-black text-white tabular-nums">
                                                        {staging[0].frameStart}–{staging[0].frameEnd}
                                                    </span>
                                                </div>
                                                <SequenceHealthBar dirPath={getDirectoryFromFilePath(staging[0].filePath)} />
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Category</label>
                                        <Select value={elementCategory ?? "media"} onValueChange={(v) => setElementCategory(v as "media" | "document")}>
                                            <SelectTrigger className="h-8 bg-[#0a0a0a] border-white/[0.08] text-white text-xs rounded-lg">
                                                <SelectValue placeholder="Media / Document" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#1a1a1a] border-white/[0.08]">
                                                <SelectItem value="media" className="text-xs text-white focus:bg-[#0096D6]">Media</SelectItem>
                                                <SelectItem value="document" className="text-xs text-white focus:bg-[#0096D6]">Document</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Type</label>
                                        <Select
                                            value={elementType ?? "plate"}
                                            onValueChange={(v) => {
                                                setElementType(v as "plate" | "edit_ref" | "other")
                                                if (v === "plate") setElementNotes("input scan plate")
                                            }}
                                        >
                                            <SelectTrigger className="h-8 bg-[#0a0a0a] border-white/[0.08] text-white text-xs rounded-lg">
                                                <SelectValue placeholder="Type" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#1a1a1a] border-white/[0.08]">
                                                <SelectItem value="plate" className="text-xs text-white focus:bg-[#0096D6]">Plate</SelectItem>
                                                <SelectItem value="edit_ref" className="text-xs text-white focus:bg-[#0096D6]">Edit ref</SelectItem>
                                                <SelectItem value="other" className="text-xs text-white focus:bg-[#0096D6]">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Version (Auto)</label>
                                        <Input
                                            className="h-8 bg-[#0a0a0a] border-white/[0.08] text-white text-xs opacity-50 cursor-not-allowed font-bold rounded-lg"
                                            value={suggestedElementLabel}
                                            readOnly
                                            disabled
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] text-gray-400 font-bold uppercase tracking-wider flex justify-between">
                                        <span>Notes</span>
                                        <span className="text-gray-600 italic normal-case font-normal text-[10px] truncate max-w-[200px]">{staging.length > 0 ? staging[0].fileName : ""}</span>
                                    </label>
                                    <textarea
                                        className="min-h-[100px] w-full rounded-xl border border-white/[0.08] bg-[#0a0a0a] p-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#24E1B1]/70"
                                        placeholder="Add notes..."
                                        value={elementNotes}
                                        onChange={(e) => setElementNotes(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Notify</label>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                        {recipientsLoading ? (
                                            <span className="text-[10px] text-gray-500">Loading…</span>
                                        ) : (
                                            recipients?.map((r: any) => (
                                                <label key={r.id} className="flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer hover:text-white transition-colors">
                                                    <Checkbox
                                                        checked={notifyUserIds.has(r.id)}
                                                        onCheckedChange={() => handleNotifyToggle(r.id)}
                                                        className="h-3.5 w-3.5 border-[#404040] data-[state=checked]:bg-[#24E1B1] data-[state=checked]:border-[#24E1B1]"
                                                    />
                                                    {r.full_name}
                                                </label>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {activeTab === "version" && (
                            <motion.div
                                key="version"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                className="rounded-2xl border border-white/[0.07] bg-[#141414]/90 p-5 shadow-xl shadow-black/30 ring-1 ring-white/[0.04] backdrop-blur-sm space-y-4"
                            >
                                <div className="flex items-center justify-between">
                                    <h3 className="text-[11px] font-black text-white uppercase tracking-wider flex items-center gap-2">
                                        <Film className="w-3.5 h-3.5 text-[#24E1B1]" />
                                        Version details
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {projectId && (
                                            <div className="flex items-center gap-2 px-2 py-1 bg-[#0096D6]/10 border border-[#0096D6]/20 rounded-md">
                                                <span className="text-[9px] font-black text-[#0096D6] uppercase">CTS</span>
                                                <span className="text-xs font-black text-white">
                                                    {trackingNumber || (nextTrackingStatus === 'pending' ? '…' : nextTrackingStatus === 'error' ? '!' : '…')}
                                                </span>
                                            </div>
                                        )}
                                        {staging.length > 0 && staging[0].frameStart != null && (
                                            <>
                                                <div className="flex items-center gap-2 px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded-md">
                                                    <span className="text-[9px] font-black text-purple-400 uppercase">Frames</span>
                                                    <span className="text-[10px] font-black text-white tabular-nums">
                                                        {staging[0].frameStart}–{staging[0].frameEnd}
                                                    </span>
                                                </div>
                                                <SequenceHealthBar dirPath={getDirectoryFromFilePath(staging[0].filePath)} />
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 py-2">
                                    <div className="md:col-span-5 space-y-2">
                                        <label className="text-[10px] text-gray-400 font-black uppercase tracking-[0.15em] ml-0.5">Type</label>
                                        <div className="flex gap-2">
                                            {(["WIP", "Final", "Client Review"] as const).map((t) => (
                                                <Button
                                                    key={t}
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className={cn(
                                                        "flex-1 h-9 px-0 text-[10px] font-black uppercase tracking-widest transition-all duration-200",
                                                        deliveryType === t
                                                            ? "bg-[#0096D6] border-[#0096D6] text-white shadow-[0_4px_12px_rgba(0,150,214,0.3)] scale-[1.02]"
                                                            : "border-white/[0.06] bg-[#0a0a0a] text-gray-500 hover:border-white/15 hover:text-gray-300"
                                                    )}
                                                    onClick={() => setDeliveryType(t)}
                                                >
                                                    {t === "WIP" ? "WIP" : t === "Final" ? "Final" : "Client"}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="md:col-span-4 space-y-2">
                                        <label className="text-[10px] text-gray-400 font-black uppercase tracking-[0.15em] ml-0.5">Task</label>
                                        <Select disabled={!shotId || tasksLoading} value={taskId ?? ""} onValueChange={setTaskId}>
                                            <SelectTrigger className="h-9 rounded-lg border-white/[0.08] bg-[#0a0a0a] text-[11px] font-bold text-white ring-offset-0 transition-all focus:ring-1 focus:ring-[#0096D6]">
                                                <SelectValue placeholder={tasksLoading ? "…" : "Select task"} />
                                            </SelectTrigger>
                                            <SelectContent className="border-white/[0.08] bg-[#1a1a1a]">
                                                {tasks?.map((t) => (
                                                    <SelectItem key={t.id} value={t.id} className="text-xs text-white focus:bg-[#0096D6] focus:text-white">
                                                        {t.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="md:col-span-3 space-y-2">
                                        <div className="flex items-center justify-between ml-0.5">
                                            <label className="text-[10px] text-gray-400 font-black uppercase tracking-[0.15em]">Version</label>
                                            <label className="flex items-center gap-1.5 text-[9px] text-gray-500 cursor-pointer hover:text-gray-300 transition-colors">
                                                <Checkbox
                                                    checked={versionOverride}
                                                    onCheckedChange={(c) => setVersionOverride(!!c)}
                                                    className="h-3 w-3 border-white/10 data-[state=checked]:bg-[#0096D6] data-[state=checked]:border-[#0096D6]"
                                                />
                                                <span className="font-bold uppercase tracking-tighter">Override</span>
                                            </label>
                                        </div>
                                        <Input
                                            className={cn(
                                                "h-9 rounded-lg border-white/[0.08] bg-[#0a0a0a] text-xs font-black tracking-widest text-white transition-all",
                                                versionOverride ? "border-[#0096D6]/30 ring-1 ring-[#0096D6]/20" : "opacity-60 cursor-not-allowed"
                                            )}
                                            value={versionOverride ? versionName : versionDisplay}
                                            onChange={(e) => setVersionName(e.target.value)}
                                            disabled={!versionOverride}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2 pt-2 max-w-2xl">
                                    <label className="text-[10px] text-gray-400 font-black uppercase tracking-[0.15em] ml-0.5 flex justify-between items-end">
                                        <span>Submission Notes</span>
                                        <span className="text-gray-600 italic normal-case font-bold text-[10px] opacity-60">Templates auto-applied</span>
                                    </label>
                                    <textarea
                                        className="w-full min-h-[140px] rounded-xl bg-[#0a0a0a] border border-white/[0.08] text-white text-sm p-4 placeholder:text-gray-600 focus:ring-1 focus:ring-[#24E1B1]/80 focus:border-[#24E1B1]/40 focus:outline-none resize-y leading-relaxed shadow-inner transition-all"
                                        placeholder={NOTES_TEMPLATE}
                                        value={submissionNotes}
                                        onChange={(e) => setSubmissionNotes(e.target.value)}
                                    />
                                </div>

                                <div className="space-y-3 pt-2 max-w-3xl">
                                    <label className="text-[10px] text-gray-400 font-black uppercase tracking-[0.15em] ml-0.5">Notify Producers & Leads</label>
                                    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-white/[0.06] bg-[#0a0a0a]/50 p-4">
                                        {recipientsLoading ? (
                                            <span className="text-[10px] text-gray-500 animate-pulse">Loading recipients…</span>
                                        ) : (
                                            recipients?.map((r: any) => (
                                                <label key={r.id} className="flex items-center gap-2.5 text-[11px] font-bold text-gray-400 cursor-pointer hover:text-white transition-all group">
                                                    <Checkbox
                                                        checked={notifyUserIds.has(r.id)}
                                                        onCheckedChange={() => handleNotifyToggle(r.id)}
                                                        className="h-4 w-4 border-white/10 data-[state=checked]:bg-[#24E1B1] data-[state=checked]:border-[#24E1B1] transition-transform group-hover:scale-110"
                                                    />
                                                    {r.full_name}
                                                </label>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

            </div>

            {/* Footer: Publish adds to queue and navigates to Queue tab */}
            <div className="flex-shrink-0 border-t border-white/[0.06] bg-[#121212]/95 backdrop-blur-md">
                <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
                {staging.length > 0 && (
                    <span className="text-xs text-gray-400">
                        {staging.length} file{staging.length !== 1 ? "s" : ""} staged — Publish to add to queue
                    </span>
                )}
                <Button
                    size="lg"
                    disabled={!canPublish}
                    className={cn(
                        "h-10 px-6 rounded-lg font-semibold text-sm tracking-tight gap-2 transition-all",
                        canPublish
                            ? "bg-[#0096D6] text-white hover:bg-[#0085bd] shadow-[0_0_20px_rgba(0,150,214,0.45)] hover:shadow-[0_0_24px_rgba(0,150,214,0.55)]"
                            : "bg-[#2A2A2A] text-gray-500 border border-[#404040] cursor-not-allowed"
                    )}
                    onClick={handlePublishClick}
                >
                    <Send className="w-4 h-4" />
                    {activeTab === "element" ? "Publish Element" : "Publish Version"}
                </Button>
                </div>
            </div>

            {/* Shot mismatch warning modal */}
            {shotMismatchWarning && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-[#2A2A2A] border border-amber-500/50 rounded-xl p-6 max-w-md w-full shadow-xl">
                        <div className="flex items-center gap-3 mb-4">
                            <AlertTriangle className="w-8 h-8 text-amber-500 shrink-0" />
                            <div>
                                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Shot mismatch</h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Selected shot: <span className="text-white font-bold">{shotCode}</span>
                                </p>
                                <p className="text-xs text-gray-400">
                                    File path suggests: <span className="text-amber-400 font-bold">{shotMismatchWarning.fileShotCode}</span>
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-gray-400 mb-4">
                            Uploading files from a different shot may cause confusion. Select the correct shot or override to continue.
                        </p>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                onClick={handleShotMismatchSelectRight}
                                className="flex-1 h-9 bg-[#24E1B1]/20 border border-[#24E1B1]/50 text-[#24E1B1] hover:bg-[#24E1B1]/30 text-xs font-bold uppercase"
                            >
                                Select right shot
                            </Button>
                            <Button
                                type="button"
                                onClick={handleShotMismatchOverride}
                                variant="outline"
                                className="flex-1 h-9 border-amber-500/50 text-amber-400 hover:bg-amber-500/10 text-xs font-bold uppercase"
                            >
                                Override
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setShotMismatchWarning(null)}
                                className="h-9 px-4 text-gray-400 hover:text-white text-xs"
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
