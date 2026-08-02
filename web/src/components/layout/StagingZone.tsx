"use client"

import { useCallback, useState, useEffect, useRef, type MouseEvent } from 'react'
import { useDropzone } from 'react-dropzone'
import { MousePointer2, FolderOpen, FileUp, AlertTriangle, Check, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppLogStore } from '@/store/app-log-store'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import type { StagingItem } from '@/types/staging'
import { ENGINE_BASE } from '@/lib/engine-ipc-shim'
import { collectFilesFromDirectoryHandle } from '@/lib/collect-directory-files'
import {
    isLikelyRealDiskPathForEngine,
    scanDeliveryMediaFromFiles,
} from '@/lib/delivery-media-scan'

/**
 * Detection runs in the browser (see `scanDeliveryMediaFromFiles`). The engine reads real disk paths
 * (Electron / engine folder dialog); publish never copies EXRs to the engine.
 */
function isWindowsClient(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent ?? ''
    if (/Windows/i.test(ua)) return true
    const p = navigator.platform ?? ''
    if (/Win/i.test(p)) return true
    const ud = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    if (ud?.platform === 'Windows') return true
    return false
}

function shouldUseBrowserFolderPickerForAddFolder(): boolean {
    return import.meta.env.VITE_USE_BROWSER_FOLDER_PICKER === 'true'
}

/** File System Access API (`showDirectoryPicker`) is only available in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS or http://localhost / 127.0.0.1). */
function canUseFileSystemAccessDirectoryPicker(): boolean {
    if (typeof window === 'undefined') return false
    if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) return false
    const w = window as unknown as { showDirectoryPicker?: unknown }
    return typeof w.showDirectoryPicker === 'function'
}

/**
 * On Windows the product assumes a local engine on this PC: prefer native disk folder (real paths) over browser APIs.
 * Set VITE_USE_ENGINE_FOLDER_DIALOG_FIRST=false to prefer browser folder pickers first instead.
 */
function shouldPreferEngineFolderDialogFirst(): boolean {
    if (import.meta.env.VITE_USE_BROWSER_FOLDER_PICKER === "true") return false
    const env = import.meta.env.VITE_USE_ENGINE_FOLDER_DIALOG_FIRST
    if (env === "false") return false
    if (env === "true") return true
    return isWindowsClient()
}

/**
 * Prefer engine-native folder dialog when configured.
 * We intentionally do not hard-gate on browser UA/platform detection because
 * some environments report non-Windows UA while still talking to a Windows
 * local engine (which is the source of truth for native picker capability).
 */
function shouldUseEngineNativeFolderDialog(): boolean {
    if (import.meta.env.VITE_USE_BROWSER_FOLDER_PICKER === "true") return false
    return import.meta.env.VITE_USE_ENGINE_FOLDER_DIALOG_FIRST !== "false"
}

export interface StagingDropOptions {
    /** First file path in the drop; used for Smart-Fill (e.g. detect SH010 from path). */
    firstPath?: string
}

interface StagingZoneProps {
    onDropItems: (items: StagingItem[], options?: StagingDropOptions) => void
    onClear?: () => void
    items?: StagingItem[]
    /** When several sequences are found, prefer one whose path/name contains this shot code (e.g. SH010). */
    shotCodeHint?: string | null
}

function formatSequenceLine(it: StagingItem): string {
    if (it.frameStart != null && it.frameEnd != null) {
        return `${it.fileName} [${it.frameStart}–${it.frameEnd}]`
    }
    return it.fileName
}

function formatStagingSummary(items: StagingItem[]): string {
    return items.map(formatSequenceLine).join(" · ")
}

/** If the folder contains several sequences, pick the one that matches the context shot when possible. */
function pickSequenceMatchingShotHint(items: StagingItem[], shotCode: string | null | undefined): StagingItem | null {
    if (!shotCode?.trim() || items.length < 2) return null
    const token = shotCode.trim().toUpperCase()
    const matches = items.filter((it) => {
        const blob = `${it.filePath} ${it.fileName}`.toUpperCase()
        return blob.includes(token)
    })
    if (matches.length === 0) return null
    if (matches.length === 1) return matches[0]
    return matches.reduce((a, b) => {
        const ar = (a.frameEnd ?? 0) - (a.frameStart ?? 0)
        const br = (b.frameEnd ?? 0) - (b.frameStart ?? 0)
        return br >= ar ? b : a
    })
}

/** Resolve IPC result: new shape { items, unsupported } or legacy array. */
function resolveProcessResult(raw: unknown): { items: StagingItem[]; unsupported: { fileName: string }[] } {
    if (raw && typeof raw === 'object' && 'items' in raw) {
        const r = raw as { items?: StagingItem[]; unsupported?: { fileName: string }[] }
        return { items: r.items ?? [], unsupported: r.unsupported ?? [] }
    }
    return { items: Array.isArray(raw) ? raw : [], unsupported: [] }
}

export function StagingZone({ onDropItems, onClear, items = [], shotCodeHint = null }: StagingZoneProps) {
    const addLog = useAppLogStore((s) => s.addLog)
    const nativeFolderPickerBusyRef = useRef(false)
    const browserFolderPickerBusyRef = useRef(false)
    const [browserFolderUserHint, setBrowserFolderUserHint] = useState<string | null>(null)
    const [sequencePicker, setSequencePicker] = useState<{
        candidates: StagingItem[]
        unsupported: { fileName: string }[]
        firstPath?: string
    } | null>(null)

    const applyItems = useCallback((items: StagingItem[], options?: StagingDropOptions) => {
        if (items.length === 0) return
        onDropItems(items, options)
        addLog("info", `Ready — ${formatStagingSummary(items)}. Confirm shot/task, then Publish.`)
    }, [onDropItems, addLog])

    const ingestResolvedBrowserFiles = useCallback(async (resolvedItems: StagingItem[], unsupported: { fileName: string }[], firstPath?: string) => {
        if (unsupported.length > 0) {
            addLog("warn", `Skipped (${unsupported.length}): ${unsupported.map(u => u.fileName).slice(0, 3).join(', ')}${unsupported.length > 3 ? '…' : ''}`)
        }
        if (resolvedItems.length === 0) {
            addLog("warn", `No supported sequences. Use: EXR • MOV • MP4 • JPG • PNG • TIF • DPX`)
            return
        }
        if (resolvedItems.length > 1) {
            const auto = pickSequenceMatchingShotHint(resolvedItems, shotCodeHint)
            if (auto) {
                addLog("info", `Using sequence that matches shot ${shotCodeHint}: ${formatSequenceLine(auto)}`)
                applyItems([auto], { firstPath })
                return
            }
            addLog("info", "Several sequences in this folder — pick one below.")
            setSequencePicker({ candidates: resolvedItems, unsupported, firstPath })
            return
        }
        applyItems(resolvedItems, { firstPath })
    }, [addLog, applyItems, shotCodeHint])

    const openBrowserFolderPicker = useCallback(() => {
        if (browserFolderPickerBusyRef.current) return
        browserFolderPickerBusyRef.current = true
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.setAttribute('webkitdirectory', '')
        input.setAttribute('directory', '')
        const safetyUnlock = window.setTimeout(() => {
            browserFolderPickerBusyRef.current = false
        }, 120_000)
        const releaseLock = () => {
            window.clearTimeout(safetyUnlock)
            browserFolderPickerBusyRef.current = false
        }
        input.addEventListener(
            "cancel",
            () => {
                releaseLock()
            },
            { once: true }
        )
        input.onchange = () => {
            void (async () => {
                try {
                    const files = Array.from(input.files || [])
                    input.remove()
                    if (files.length === 0) {
                        addLog('info', 'Folder selection was cancelled or the folder is empty.')
                        return
                    }
                    const scanned = scanDeliveryMediaFromFiles(files)
                    await ingestResolvedBrowserFiles(scanned.items, scanned.unsupported, scanned.firstPath)
                } finally {
                    releaseLock()
                }
            })()
        }
        input.click()
    }, [addLog, ingestResolvedBrowserFiles])

    /** Browsers block `input.click()` for folder chooser unless it runs in the same user-gesture turn — never call from async `.then` / after `await`. */
    const handleOpenBrowserFolderFromHint = useCallback(
        (e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            setBrowserFolderUserHint(null)
            openBrowserFolderPicker()
        },
        [openBrowserFolderPicker]
    )

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const paths = acceptedFiles
            .map((file) => (file as File & { path?: string }).path)
            .filter((p): p is string => typeof p === 'string' && p.length > 0 && isLikelyRealDiskPathForEngine(p))

        let resolvedItems: StagingItem[] = []
        let unsupported: { fileName: string }[] = []
        let firstPath: string | undefined

        if (paths.length > 0 && paths.length === acceptedFiles.length) {
            const ipcRenderer = (window as unknown as { ipcRenderer?: { invoke: (c: string, p?: unknown) => Promise<unknown> } }).ipcRenderer
            if (!ipcRenderer?.invoke) {
                addLog('error', 'Engine bridge missing. Reload the page.')
                return
            }
            const raw = await ipcRenderer.invoke('staging:process-paths-or-folders', { paths })
            const r = resolveProcessResult(raw)
            resolvedItems = r.items
            unsupported = r.unsupported
            firstPath = paths[0]
        } else if (acceptedFiles.length > 0) {
            const scanned = scanDeliveryMediaFromFiles(acceptedFiles)
            resolvedItems = scanned.items
            unsupported = scanned.unsupported
            firstPath = scanned.firstPath
        } else {
            addLog("warn", 'No files selected')
            return
        }

        void ingestResolvedBrowserFiles(resolvedItems, unsupported, firstPath)
    }, [addLog, ingestResolvedBrowserFiles])

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
                const scanned = scanDeliveryMediaFromFiles(files)
                void ingestResolvedBrowserFiles(scanned.items, scanned.unsupported, scanned.firstPath)
            })()
        }
        input.click()
    }, [addLog, ingestResolvedBrowserFiles])

    /** Folder pick: call native pickers synchronously (user activation) — async wrapper breaks file dialogs in many browsers. */
    const handleAddFolder = useCallback(() => {
        if (nativeFolderPickerBusyRef.current) return
        setBrowserFolderUserHint(null)

        if (shouldUseBrowserFolderPickerForAddFolder()) {
            addLog('info', 'Folder mode: choose a folder; detection runs in the browser. Publish uses real disk paths only (no EXR copy to the engine).')
            openBrowserFolderPicker()
            return
        }

        const useFileSystemAccessFirst =
            canUseFileSystemAccessDirectoryPicker() && !shouldPreferEngineFolderDialogFirst()

        if (useFileSystemAccessFirst) {
            addLog('info', 'Opening folder picker…')
            const w = window as unknown as { showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }
            void w.showDirectoryPicker({ mode: 'read' })
                .then(async (dirHandle) => {
                    const files: File[] = []
                    await collectFilesFromDirectoryHandle(dirHandle, '', files)
                    if (files.length === 0) {
                        addLog('warn', 'That folder has no readable files.')
                        return
                    }
                    addLog('info', `Found ${files.length} file(s). Detecting sequences in the browser…`)
                    const scanned = scanDeliveryMediaFromFiles(files)
                    await ingestResolvedBrowserFiles(scanned.items, scanned.unsupported, scanned.firstPath)
                })
                .catch((e: unknown) => {
                    if (e instanceof DOMException && e.name === 'AbortError') {
                        addLog('info', 'Folder picker cancelled.')
                        return
                    }
                    addLog(
                        'warn',
                        `Folder picker failed (${e instanceof Error ? e.message : String(e)}). Use “Open browser folder” below or try Add folder again from http://127.0.0.1 or HTTPS.`
                    )
                    setBrowserFolderUserHint(
                        'The system folder dialog did not run. Click “Open browser folder” below (required: browsers only allow this from a direct click).'
                    )
                })
            return
        }

        if (shouldUseEngineNativeFolderDialog()) {
            const ipc = (window as unknown as { ipcRenderer?: { invoke: (c: string, p?: unknown) => Promise<unknown> } }).ipcRenderer
            if (!ipc?.invoke) {
                addLog(
                    'error',
                    `Engine IPC bridge is unavailable in this page. Cannot open native folder dialog (${ENGINE_BASE}). Start web with the engine bridge and reload; then use Add folder again.`
                )
                setBrowserFolderUserHint(
                    `Native Windows picker needs the local engine bridge (${ENGINE_BASE}). If this page was opened in a standalone browser context without bridge support, run the app via the local dev stack and try Add folder again.`
                )
                return
            }
            nativeFolderPickerBusyRef.current = true
            void (async () => {
                addLog('info', 'Opening Windows folder dialog via the local engine (reads the folder on disk — no browser copy).')
                try {
                    const raw = (await ipc.invoke('dialog:open-folder-files')) as {
                        items?: StagingItem[]
                        unsupported?: { fileName: string }[]
                        selectedPath?: string | null
                        nativeFolderPickerAvailable?: boolean
                    }
                    if (raw?.nativeFolderPickerAvailable === false) {
                        setBrowserFolderUserHint(
                            'Native folder pick works on Windows with the local engine. Use “Open browser folder” below, or run the app on Windows with the engine started.'
                        )
                        return
                    }
                    const r = resolveProcessResult(raw)
                    const selectedPath =
                        typeof raw?.selectedPath === 'string' && raw.selectedPath.length > 0 ? raw.selectedPath : undefined
                    if (!selectedPath) {
                        addLog(
                            'info',
                            'No folder was chosen from the engine dialog. Drag a folder onto this zone, use Files, or use Add folder again.'
                        )
                        return
                    }
                    await ingestResolvedBrowserFiles(r.items, r.unsupported, selectedPath)
                } catch (err) {
                    addLog(
                        'warn',
                        `Engine folder failed (${ENGINE_BASE}): ${err instanceof Error ? err.message : String(err)}. Start the engine on this PC if it is not running.`
                    )
                    setBrowserFolderUserHint(
                        `The Windows folder dialog could not run via the local engine (${ENGINE_BASE}). Start the engine (e.g. npm run dev -w engine), ensure this site can reach it, then click “Add folder” again — or use “Open browser folder” below (pick in the same browser session).`
                    )
                } finally {
                    nativeFolderPickerBusyRef.current = false
                }
            })()
            return
        }

        if (isWindowsClient() && !shouldUseEngineNativeFolderDialog()) {
            if (!canUseFileSystemAccessDirectoryPicker() && typeof window !== 'undefined' && window.isSecureContext === false) {
                addLog(
                    'warn',
                    'This page is not a secure context (use http://127.0.0.1 or HTTPS, not a LAN IP) so the modern folder dialog is unavailable. Using the legacy folder picker.'
                )
            }
        }
        openBrowserFolderPicker()
    }, [addLog, ingestResolvedBrowserFiles, openBrowserFolderPicker])

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
        <div className="flex w-full flex-shrink-0 flex-col items-stretch gap-2.5">
            <div
                className={cn(
                    "group relative flex min-h-[84px] w-full cursor-pointer flex-row items-center justify-center gap-3.5 overflow-hidden rounded-2xl border border-dashed px-4 py-3 transition-all duration-300",
                    isDragActive ? "scale-[1.01] border-[#24E1B1] bg-[#24E1B1]/7 shadow-[0_0_44px_rgba(36,225,177,0.16)]" : "border-white/[0.12] bg-white/[0.035] hover:border-[#24E1B1]/45 hover:bg-white/[0.055]"
                )}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDragOver={onDragOver}
                onDrop={handleDrop}
                {...rootProps}
            >
                <input {...getInputProps()} />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_50%,rgba(36,225,177,0.14),transparent_22rem)] opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="relative flex-shrink-0">
                    <motion.div
                        animate={isDragActive ? { y: [0, -4, 0] } : {}}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.09] bg-black/30 shadow-lg transition-all group-hover:border-[#24E1B1]/45 group-hover:bg-[#24E1B1]/10"
                    >
                        <FolderOpen className={cn("w-5 h-5 transition-colors", isDragActive ? "text-[#24E1B1]" : "text-gray-400 group-hover:text-[#24E1B1]")} />
                    </motion.div>
                </div>
                <div className="text-left space-y-0.5 relative z-10 flex-1 min-w-0">
                    <h3 className="text-sm font-semibold tracking-tight text-white transition-colors group-hover:text-[#24E1B1]">
                        {isDragActive ? "Release to inspect" : "Select delivery media"}
                    </h3>
                    <div className="flex flex-wrap gap-1.5 items-center">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                            EXR • MOV • MP4 • JPG • PNG
                        </p>
                        {items.length > 0 && (
                            <div
                                className="flex items-center gap-1.5 bg-[#24E1B1]/10 border border-[#24E1B1]/20 rounded-md px-2 py-0.5 max-w-full"
                                title={items[0].engineInputPath ? `Engine path: ${items[0].engineInputPath}` : undefined}
                            >
                                <span className="text-[9px] font-black text-[#24E1B1] uppercase shrink-0">Staged:</span>
                                <span className="text-[10px] text-white font-bold truncate min-w-0">
                                    {shotCodeHint?.trim()
                                        ? <span className="text-[#24E1B1]/90">{shotCodeHint.trim()}</span>
                                        : null}
                                    {shotCodeHint?.trim() ? <span className="text-gray-500 mx-1">·</span> : null}
                                    {items.length === 1 && items[0].frameStart != null && items[0].frameEnd != null
                                        ? `${items[0].fileName} [${items[0].frameStart}–${items[0].frameEnd}]`
                                        : `${items[0].fileName}${items.length > 1 ? ` (+${items.length - 1})` : ''}`}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="relative z-20 flex flex-col gap-2 shrink-0 pointer-events-auto sm:flex-row">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleBrowseFiles(); }}
                        className="h-8 rounded-lg border-white/[0.1] bg-black/25 text-[10px] font-bold uppercase text-gray-300 hover:border-[#24E1B1]/40 hover:bg-[#24E1B1]/10"
                    >
                        <FileUp className="w-3.5 h-3.5 mr-1.5" />
                        Files
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleAddFolder(); }}
                        className="h-8 rounded-lg border-white/[0.1] bg-black/25 text-[10px] font-bold uppercase text-gray-300 hover:border-[#24E1B1]/40 hover:bg-[#24E1B1]/10"
                    >
                        <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                        Add folder
                    </Button>
                    {items.length > 0 && onClear && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); onClear(); }}
                            className="h-8 rounded-lg border-amber-500/40 bg-black/25 text-[10px] font-bold uppercase text-amber-400 hover:border-amber-500/60 hover:bg-amber-500/10"
                        >
                            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                            Reset
                        </Button>
                    )}
                </div>
            </div>

            {browserFolderUserHint ? (
                <div className="flex flex-col gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] leading-snug text-amber-100/95">{browserFolderUserHint}</p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleOpenBrowserFolderFromHint}
                        className="h-8 shrink-0 rounded-lg border-amber-500/50 bg-black/30 text-[10px] font-bold uppercase text-amber-200 hover:bg-amber-500/15"
                    >
                        <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                        Open browser folder
                    </Button>
                </div>
            ) : null}

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
                <p className="text-[10px] text-gray-500 uppercase tracking-wider flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-1.5">
                    <span className="flex items-center gap-1.5">
                        <MousePointer2 className="w-3 h-3 shrink-0" />
                        Ready to inspect local media
                    </span>
                    <span className="normal-case tracking-normal text-gray-600 sm:before:content-['·'] sm:before:mr-1.5">
                        {shouldUseBrowserFolderPickerForAddFolder()
                            ? 'VITE_USE_BROWSER_FOLDER_PICKER=true: legacy browser folder input. Prefer engine for real paths on Windows.'
                            : 'Add folder uses your local engine first (real disk paths on this PC when native picker is available). Web UI can be remote; files and FFmpeg live on the machine running the engine. Set VITE_USE_ENGINE_FOLDER_DIALOG_FIRST=false to prefer browser folder pickers.'}
                    </span>
                </p>
            )}
        </div>
    )
}
