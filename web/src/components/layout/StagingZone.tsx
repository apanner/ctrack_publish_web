"use client"

import { useCallback, useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { UploadCloud, MousePointer2, FolderOpen, FileUp, AlertTriangle, Check, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppLogStore } from '@/store/app-log-store'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import type { StagingItem } from '@/types/staging'
import { ENGINE_BASE } from '@/lib/engine-ipc-shim'

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B"
    const k = 1024
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Number((bytes / Math.pow(k, i)).toFixed(1))} ${["B", "KB", "MB", "GB"][i]}`
}

export interface StagingDropOptions {
    /** First file path in the drop; used for Smart-Fill (e.g. detect SH010 from path). */
    firstPath?: string
}

interface StagingZoneProps {
    onDropItems: (items: StagingItem[], options?: StagingDropOptions) => void
    onClear?: () => void
    items?: StagingItem[]
}

/** Resolve IPC result: new shape { items, unsupported } or legacy array. */
function resolveProcessResult(raw: unknown): { items: StagingItem[]; unsupported: { fileName: string }[] } {
    if (raw && typeof raw === 'object' && 'items' in raw) {
        const r = raw as { items?: StagingItem[]; unsupported?: { fileName: string }[] }
        return { items: r.items ?? [], unsupported: r.unsupported ?? [] }
    }
    return { items: Array.isArray(raw) ? raw : [], unsupported: [] }
}

async function uploadFilesToEngineForStaging(files: File[]): Promise<{ items: StagingItem[]; unsupported: { fileName: string }[]; firstPath?: string }> {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    const res = await fetch(`${ENGINE_BASE}/api/stage/files`, { method: 'POST', body: fd })
    if (!res.ok) {
        throw new Error(await res.text())
    }
    const data = (await res.json()) as { items: StagingItem[]; unsupported: { fileName: string }[] }
    const firstPath = data.items[0]?.filePath
    return { items: data.items ?? [], unsupported: data.unsupported ?? [], firstPath }
}

export function StagingZone({ onDropItems, onClear, items = [] }: StagingZoneProps) {
    const addLog = useAppLogStore((s) => s.addLog)
    const [sequencePicker, setSequencePicker] = useState<{
        candidates: StagingItem[]
        unsupported: { fileName: string }[]
        firstPath?: string
    } | null>(null)

    const applyItems = useCallback((items: StagingItem[], options?: StagingDropOptions) => {
        if (items.length > 0) {
            items.forEach(it => addLog("info", it.frameStart != null ? `Added sequence: ${it.fileName} [${it.frameStart}-${it.frameEnd}]` : `Added: ${it.fileName}`))
            onDropItems(items, options)
            addLog("info", "Files staged. Click Publish to add to queue and go to Queue tab.")
        }
    }, [onDropItems, addLog])

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const paths = acceptedFiles
            .map(file => (file as File & { path?: string }).path)
            .filter((p): p is string => !!p)

        let resolvedItems: StagingItem[] = []
        let unsupported: { fileName: string }[] = []
        let firstPath: string | undefined

        if (paths.length > 0) {
            const raw = await (window as any).ipcRenderer.invoke('staging:process-paths-or-folders', { paths })
            const r = resolveProcessResult(raw)
            resolvedItems = r.items
            unsupported = r.unsupported
            firstPath = paths[0]
        } else if (acceptedFiles.length > 0) {
            try {
                const r = await uploadFilesToEngineForStaging(acceptedFiles)
                resolvedItems = r.items
                unsupported = r.unsupported
                firstPath = r.firstPath
            } catch (err) {
                addLog('error', `Could not stage files (is the CTrack engine running?). ${err instanceof Error ? err.message : String(err)}`)
                return
            }
        } else {
            addLog("warn", 'No files selected')
            return
        }

        if (unsupported.length > 0) {
            addLog("warn", `Unsupported files (${unsupported.length}): ${unsupported.map(u => u.fileName).slice(0, 3).join(', ')}${unsupported.length > 3 ? '…' : ''}`)
        }

        if (resolvedItems.length === 0) {
            addLog("warn", `No supported sequences found. Supported: EXR • MOV • MP4 • JPG • PNG • TIF • DPX`)
            return
        }

        if (resolvedItems.length > 1) {
            setSequencePicker({ candidates: resolvedItems, unsupported, firstPath })
            return
        }

        applyItems(resolvedItems, { firstPath })
    }, [addLog, applyItems])

    const handleBrowseFiles = useCallback(() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = '.exr,.mp4,.mov,.mkv,.mxf,.avi,.jpg,.jpeg,.png,.tif,.tiff,.dpx'
        input.onchange = () => {
            void (async () => {
                const files = Array.from(input.files || [])
                input.remove()
                if (files.length === 0) return
                try {
                    const { items: resolvedItems, unsupported, firstPath } = await uploadFilesToEngineForStaging(files)
                    if (unsupported.length > 0) {
                        addLog("warn", `Unsupported files (${unsupported.length}): ${unsupported.map(u => u.fileName).slice(0, 3).join(', ')}${unsupported.length > 3 ? '…' : ''}`)
                    }
                    if (resolvedItems.length === 0) {
                        addLog("warn", `No supported sequences found. Supported: EXR • MOV • MP4 • JPG • PNG • TIF • DPX`)
                        return
                    }
                    if (resolvedItems.length > 1) {
                        setSequencePicker({ candidates: resolvedItems, unsupported, firstPath })
                        return
                    }
                    applyItems(resolvedItems, { firstPath })
                } catch (err) {
                    addLog('error', `Browse failed: ${err instanceof Error ? err.message : String(err)}`)
                }
            })()
        }
        input.click()
    }, [addLog, applyItems])

    const handleBrowseFolder = useCallback(() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        ;(input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true
        input.onchange = () => {
            void (async () => {
                const files = Array.from(input.files || [])
                input.remove()
                if (files.length === 0) return
                try {
                    const { items: resolvedItems, unsupported, firstPath } = await uploadFilesToEngineForStaging(files)
                    if (unsupported.length > 0) {
                        addLog("warn", `Unsupported files (${unsupported.length}): ${unsupported.map(u => u.fileName).slice(0, 3).join(', ')}${unsupported.length > 3 ? '…' : ''}`)
                    }
                    if (resolvedItems.length === 0) {
                        addLog("warn", `No supported sequences found. Supported: EXR • MOV • MP4 • JPG • PNG • TIF • DPX`)
                        return
                    }
                    if (resolvedItems.length > 1) {
                        setSequencePicker({ candidates: resolvedItems, unsupported, firstPath })
                        return
                    }
                    applyItems(resolvedItems, { firstPath })
                } catch (err) {
                    addLog('error', `Folder staging failed: ${err instanceof Error ? err.message : String(err)}`)
                }
            })()
        }
        input.click()
    }, [addLog, applyItems])

    const handleSelectSequence = useCallback((item: StagingItem) => {
        if (!sequencePicker) return
        applyItems([item], { firstPath: sequencePicker.firstPath ?? item.filePath })
        setSequencePicker(null)
    }, [sequencePicker, applyItems])

    const handleDismissPicker = useCallback(() => {
        setSequencePicker(null)
    }, [])

    // Dismiss sequence picker when staging is cleared (e.g. via Reset)
    useEffect(() => {
        if (items.length === 0) setSequencePicker(null)
    }, [items.length])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        noClick: false
    })

    // Separate dropzone props from motion props to avoid handler collision
    const { onDragEnter, onDragLeave, onDragOver, onDrop: handleDrop, ...rootProps } = getRootProps()

    return (
        <div className="w-full flex flex-col items-stretch gap-4 flex-shrink-0">
            <div
                className={cn(
                    "w-full min-h-[90px] border-2 border-dashed rounded-2xl flex flex-row items-center justify-center gap-4 px-5 py-3 transition-all duration-300 cursor-pointer group relative overflow-hidden",
                    isDragActive ? "border-[#24E1B1] shadow-[0_0_40px_rgba(36,225,177,0.12)] bg-[#24E1B1]/5 scale-[1.01]" : "border-[#404040] hover:border-gray-500 bg-white/[0.02] scale-100"
                )}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDragOver={onDragOver}
                onDrop={handleDrop}
                {...rootProps}
            >
                <input {...getInputProps()} />
                <div className="absolute inset-0 bg-gradient-to-r from-[#24E1B1]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                <div className="relative flex-shrink-0">
                    <motion.div
                        animate={isDragActive ? { y: [0, -4, 0] } : {}}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="w-10 h-10 rounded-lg bg-[#2A2A2A] border border-[#404040] flex items-center justify-center group-hover:bg-[#24E1B1]/10 group-hover:border-[#24E1B1]/40 transition-all shadow-lg"
                    >
                        <UploadCloud className={cn("w-5 h-5 transition-colors", isDragActive ? "text-[#24E1B1]" : "text-gray-400 group-hover:text-[#24E1B1]")} />
                    </motion.div>
                </div>
                <div className="text-left space-y-0.5 relative z-10 flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-white tracking-tight uppercase group-hover:text-[#24E1B1] transition-colors leading-tight">
                        {isDragActive ? "Release to add" : "Drop delivery assets"}
                    </h3>
                    <div className="flex flex-wrap gap-1.5 items-center">
                        <p className="text-gray-400 text-[9px] font-semibold uppercase tracking-wide">
                            EXR • MOV • MP4 • JPG • PNG
                        </p>
                        {items.length > 0 && (
                            <div className="flex items-center gap-1.5 bg-[#24E1B1]/10 border border-[#24E1B1]/20 rounded-md px-2 py-0.5">
                                <span className="text-[9px] font-black text-[#24E1B1] uppercase">Staged:</span>
                                <span className="text-[10px] text-white font-bold truncate max-w-[200px]">
                                    {items[0].fileName}{items.length > 1 ? ` (+${items.length - 1})` : ''}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleBrowseFiles(); }}
                        className="h-8 bg-[#1A1A1A] border-[#404040] text-gray-300 hover:bg-[#24E1B1]/10 hover:border-[#24E1B1]/40 text-[10px] font-bold uppercase"
                    >
                        <FileUp className="w-3.5 h-3.5 mr-1.5" />
                        Browse
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleBrowseFolder(); }}
                        className="h-8 bg-[#1A1A1A] border-[#404040] text-gray-300 hover:bg-[#24E1B1]/10 hover:border-[#24E1B1]/40 text-[10px] font-bold uppercase"
                    >
                        <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                        Folder
                    </Button>
                    {items.length > 0 && onClear && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); onClear(); }}
                            className="h-8 bg-[#1A1A1A] border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/60 text-[10px] font-bold uppercase"
                        >
                            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                            Reset
                        </Button>
                    )}
                </div>
            </div>

            <AnimatePresence>
                {sequencePicker && (
                    <motion.div
                        key="sequence-picker"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="mt-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                            <div className="flex items-center gap-2 mb-3">
                                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                                <h4 className="text-xs font-bold text-amber-200 uppercase tracking-wider">
                                    Multiple sequences found — choose one to publish
                                </h4>
                                {sequencePicker.unsupported.length > 0 && (
                                    <span className="text-[10px] text-amber-400/80 ml-auto">
                                        {sequencePicker.unsupported.length} unsupported file{sequencePicker.unsupported.length !== 1 ? 's' : ''} skipped
                                    </span>
                                )}
                            </div>
                            {sequencePicker.unsupported.length > 0 && (
                                <p className="text-[10px] text-gray-400 mb-2">
                                    Unsupported: {sequencePicker.unsupported.map(u => u.fileName).join(', ')}
                                </p>
                            )}
                            <div className="flex flex-wrap gap-2">
                                {sequencePicker.candidates.map((it) => (
                                    <Button
                                        key={it.filePath}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleSelectSequence(it)}
                                        className="h-9 px-3 text-[10px] font-bold bg-[#1A1A1A] border-[#404040] text-white hover:bg-[#24E1B1]/20 hover:border-[#24E1B1]/50 transition-all"
                                    >
                                        <Check className="w-3 h-3 mr-2 text-[#24E1B1]" />
                                        {it.frameStart != null
                                            ? `${it.fileName} [${it.frameStart}-${it.frameEnd}]`
                                            : it.fileName}
                                    </Button>
                                ))}
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleDismissPicker}
                                className="mt-3 h-7 text-[10px] text-gray-400 hover:text-gray-300"
                            >
                                Cancel
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {!isDragActive && !sequencePicker && (
                <p className="text-[10px] text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                    <MousePointer2 className="w-3 h-3" />
                    Ready for ingestion
                </p>
            )}
        </div>
    )
}
