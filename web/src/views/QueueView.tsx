"use client"

import { Card, CardContent } from "@/components/ui/card"
import { History, CheckCircle2, Clock, AlertCircle, PlayCircle, Loader2, X, FileText, ScrollText } from "lucide-react"
import { usePublishQueue } from "@/hooks/usePublishQueue"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { useState, useEffect, useCallback } from "react"

interface LogEntry {
    id: number
    job_id: string
    run_id: string | null
    attempt: number
    level: "info" | "warn" | "error"
    component: "renderer" | "main" | "python" | "s3" | "db" | "queue"
    stage: string | null
    event_type: "log" | "started" | "progress" | "completed" | "failed" | "heartbeat"
    message: string
    payload_json: string | null
    created_at: string
}

interface IpcRendererLike {
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => unknown
}

function LogViewerModal({ jobId, fileName, onClose, getJobEvents }: { jobId: string, fileName: string, onClose: () => void, getJobEvents: (id: string) => Promise<LogEntry[]> }) {
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [loading, setLoading] = useState(true)

    const fetchLogs = useCallback(async () => {
        try {
            const data = await getJobEvents(jobId)
            setLogs(data)
        } catch (err) {
            console.error("Failed to fetch logs", err)
        } finally {
            setLoading(false)
        }
    }, [jobId, getJobEvents])

    useEffect(() => {
        fetchLogs()
        const ipc = (window as unknown as Window & { ipcRenderer?: IpcRendererLike }).ipcRenderer
        if (!ipc?.on) return
        const handler = (_event: unknown, eventRowCandidate: unknown) => {
            if (!eventRowCandidate || typeof eventRowCandidate !== "object") return
            const eventRow = eventRowCandidate as LogEntry
            if (eventRow.job_id !== jobId) return
            setLogs((prev) => {
                if (prev.some((entry) => entry.id === eventRow.id)) return prev
                return [...prev, eventRow]
            })
        }
        const off = ipc.on("queue:log-appended", handler)
        return () => {
            if (typeof off === "function") (off as () => void)()
        }
    }, [fetchLogs, jobId])

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-2xl bg-[#1A1A1A] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden"
            >
                <div className="p-4 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ScrollText className="w-5 h-5 text-[#24E1B1]" />
                        <div>
                            <h3 className="text-sm font-black text-white uppercase tracking-wider leading-none">{fileName}</h3>
                            <p className="text-[10px] text-muted-foreground uppercase font-bold mt-1 tracking-widest">Process Logs</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-muted-foreground hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-black/20 font-mono text-[11px] space-y-2">
                    {loading && logs.length === 0 ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 text-[#24E1B1] animate-spin" />
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground uppercase tracking-widest font-black opacity-30">
                            No logs found for this job
                        </div>
                    ) : (
                        logs.map((log) => (
                            <div key={log.id} className="flex gap-4 group">
                                <span className="text-gray-600 select-none">[{new Date(log.created_at).toLocaleTimeString()}]</span>
                                <span className={cn(
                                    "text-gray-300",
                                    log.level === "error" && "text-destructive font-bold",
                                    log.level === "warn" && "text-amber-400",
                                    log.event_type === "completed" && "text-[#24E1B1]"
                                )}>
                                    [{log.component}{log.stage ? `/${log.stage}` : ""}] {log.message}
                                </span>
                            </div>
                        ))
                    )}
                </div>
                <div className="p-3 border-t border-white/5 bg-black/40 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={onClose} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-white">
                        Dismiss
                    </Button>
                </div>
            </motion.div>
        </div>
    )
}

export function QueueView() {
    const { queue, removeJob, startPublish, startPublishElement, processNextJob, clearQueue, purgeQueue, getJobEvents } = usePublishQueue()
    const [selectedJob, setSelectedJob] = useState<{ id: string, name: string } | null>(null)

    const completedJobs = queue.filter(j => j.status === 'completed')
    const activeJobs = queue.filter(j => j.status !== 'completed' && j.status !== 'idle' && j.status !== 'error')
    const pendingJobs = queue.filter(j => j.status === 'idle')

    const handleStartJob = (job: (typeof queue)[0]) => {
        const tab = job.meta?.tab
        if (tab === 'element') {
            startPublishElement(job.id)
        } else {
            startPublish(job.id)
        }
    }

    const handleProcessAll = () => {
        processNextJob()
    }

    const handleClearCompleted = async () => {
        await clearQueue()
    }

    const handlePurgeQueue = async () => {
        if (confirm("Are you sure you want to clear the entire queue?")) {
            await purgeQueue()
        }
    }

    return (
        <div className="p-8 h-full overflow-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-end justify-between">
                <div className="space-y-2">
                    <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Queue Monitor</h1>
                    <p className="text-muted-foreground font-medium uppercase tracking-widest text-xs">Live History & Processing</p>
                </div>
                <div className="flex gap-6 items-center">
                    {pendingJobs.length > 0 && (
                        <Button
                            size="lg"
                            onClick={handleProcessAll}
                            className="bg-[#0096D6] text-white hover:bg-[#0085bd] shadow-[0_0_20px_rgba(0,150,214,0.4)]"
                        >
                            <PlayCircle className="w-4 h-4 mr-2" />
                            Process all ({pendingJobs.length})
                        </Button>
                    )}
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-1">Total Finished</span>
                        <span className="text-3xl font-black text-green-500 tabular-nums">{completedJobs.length}</span>
                    </div>
                    <div className="h-10 w-px bg-white/5" />
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-1">Active Now</span>
                        <span className="text-3xl font-black text-primary tabular-nums">{activeJobs.length}</span>
                    </div>
                </div>
            </div>

            <div className="space-y-6">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground pb-2 border-b border-white/5">
                    <div className="flex gap-4">
                        <span className={cn(activeJobs.length > 0 && "text-primary")}>
                            {activeJobs.length} Processing
                        </span>
                        <span className={cn(pendingJobs.length > 0 && "text-primary")}>
                            {pendingJobs.length} Pending
                        </span>
                    </div>
                    <div className="flex gap-4">
                        <button
                            onClick={handlePurgeQueue}
                            className="text-red-500/60 hover:text-red-500 transition-colors flex items-center gap-1.5 group"
                            title="Permanently delete all history"
                        >
                            <AlertCircle className="w-3.5 h-3.5" />
                            Clear History
                        </button>
                        <button
                            onClick={handleClearCompleted}
                            className="hover:text-white transition-colors flex items-center gap-1.5 group"
                        >
                            <History className="w-3.5 h-3.5 group-hover:rotate-[-45deg] transition-transform" />
                            Clear Finished
                        </button>
                    </div>
                </div>

                {queue.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="py-32 flex flex-col items-center justify-center text-center space-y-6"
                    >
                        <div className="relative">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                                className="w-24 h-24 rounded-[2.5rem] bg-white/5 border border-white/10 flex items-center justify-center"
                            >
                                <Clock className="w-10 h-10 text-muted-foreground/30" />
                            </motion.div>
                            <motion.div
                                animate={{ scale: [1, 1.2, 1] }}
                                transition={{ duration: 4, repeat: Infinity }}
                                className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center backdrop-blur-md"
                            >
                                <PlayCircle className="w-4 h-4 text-primary" />
                            </motion.div>
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-2xl font-black text-white tracking-tighter uppercase italic">No Active Threads</h3>
                            <p className="text-xs text-muted-foreground max-w-[240px] font-bold uppercase tracking-widest opacity-60">
                                Launch a publish or ingest a delivery folder to populate your pipeline.
                            </p>
                        </div>
                    </motion.div>
                ) : (
                    <div className="space-y-3">
                        {queue.map((job, idx) => (
                            <motion.div
                                key={job.id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.05 }}
                            >
                                <Card
                                    className={cn(
                                        "border-white/5 bg-white/[0.02] hover:bg-white/5 transition-all duration-300 group overflow-hidden rounded-2xl",
                                        job.status === 'error' && "border-destructive/20 bg-destructive/5"
                                    )}
                                >
                                    <CardContent className="p-4 flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className={cn(
                                                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                                                    job.status === 'completed' ? "bg-green-500/10" :
                                                        job.status === 'error' ? "bg-destructive/10" : "bg-primary/10"
                                                )}>
                                                    {job.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                                                    {job.status === 'error' && <AlertCircle className="w-5 h-5 text-destructive" />}
                                                    {job.status === 'idle' && <Clock className="w-5 h-5 text-muted-foreground" />}
                                                    {job.status !== 'completed' && job.status !== 'error' && job.status !== 'idle' && (
                                                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <h4 className="text-sm font-black text-white flex items-center gap-2">
                                                        {job.filePath.split(/[\\/]/).pop()}
                                                        {job.status === 'idle' && (
                                                            <button
                                                                onClick={() => handleStartJob(job)}
                                                                className="text-primary hover:text-primary/80 transition-colors"
                                                            >
                                                                <PlayCircle className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </h4>
                                                    <div className="flex items-center gap-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                                        <span className={cn(
                                                            "px-1.5 py-0.5 rounded-sm bg-white/5",
                                                            job.status === 'completed' && "text-green-500 bg-green-500/5",
                                                            job.status === 'error' && "text-destructive bg-destructive/5"
                                                        )}>{job.status}</span>
                                                        <span>•</span>
                                                        <span className={cn(
                                                            "px-1.5 py-0.5 rounded-sm",
                                                            job.context?.trackingNumber ? "bg-[#0096D6]/10 text-[#0096D6]" : "bg-white/5"
                                                        )}>
                                                            {job.context?.trackingNumber ? `CTS: ${job.context.trackingNumber}` : (job.context?.shotCode ? `Shot: ${job.context.shotCode}` : (job.context?.shotId ? `Shot: ${job.context.shotId.slice(0, 8)}` : 'No Context'))}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6">
                                                <div className="w-40 space-y-2">
                                                    <div className="flex justify-between text-[9px] font-black uppercase tracking-tighter">
                                                        <span>{job.status}</span>
                                                        <span className="tabular-nums">{job.progress}%</span>
                                                    </div>
                                                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden min-w-[120px]">
                                                        <motion.div
                                                            initial={false}
                                                            animate={{ width: `${job.progress}%` }}
                                                            transition={{ duration: 0.3 }}
                                                            className="h-full bg-primary rounded-full"
                                                            style={{ minWidth: job.progress > 0 ? 4 : 0 }}
                                                        />
                                                    </div>
                                                </div>

                                                {job.status === 'error' && (
                                                    <p className="text-[10px] font-bold text-destructive max-w-[200px] truncate">{job.error}</p>
                                                )}

                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => setSelectedJob({ id: job.id, name: job.filePath.split(/[\\/]/).pop() || 'Job' })}
                                                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-muted-foreground hover:text-primary"
                                                        title="View processing logs"
                                                    >
                                                        <FileText className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => removeJob(job.id)}
                                                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-muted-foreground hover:text-destructive"
                                                        title="Remove from queue"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>

            <AnimatePresence>
                {selectedJob && (
                    <LogViewerModal
                        jobId={selectedJob.id}
                        fileName={selectedJob.name}
                        onClose={() => setSelectedJob(null)}
                        getJobEvents={getJobEvents}
                    />
                )}
            </AnimatePresence>
        </div>
    )
}
