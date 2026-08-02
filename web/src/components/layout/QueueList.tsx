"use client"

import { PublishJob } from "@/hooks/usePublishQueue"
import { CheckCircle2, CircleDashed, AlertCircle, Loader2, Target, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

interface QueueListProps {
    queue: PublishJob[]
    onRemove?: (id: string) => void
}

export function QueueList({ queue, onRemove }: QueueListProps) {
    if (queue.length === 0) return null

    return (
        <div className="flex flex-col gap-3 py-4 overflow-y-auto max-h-[400px] scrollbar-hide pr-2">
            <AnimatePresence initial={false}>
                {queue.map((job, idx) => (
                    <motion.div
                        key={job.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20, scale: 0.95 }}
                        transition={{ delay: idx * 0.05 }}
                        className={cn(
                            "group p-4 rounded-2xl border border-white/5 bg-[#1A1A1A] hover:bg-white/5 transition-all relative overflow-hidden",
                            job.status === 'error' && "border-destructive/20 bg-destructive/5"
                        )}
                    >
                        {/* Status bar */}
                        <div
                            className={cn(
                                "absolute left-0 top-0 bottom-0 w-1 transition-colors",
                                job.status === 'completed' ? "bg-green-500" :
                                    job.status === 'error' ? "bg-destructive" :
                                        job.status === 'idle' ? "bg-white/10" : "bg-primary"
                            )}
                        />

                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className={cn(
                                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                        job.status === 'completed' ? "bg-green-500/10 text-green-500" :
                                            job.status === 'error' ? "bg-destructive/10 text-destructive" : "bg-white/5 text-muted-foreground"
                                    )}>
                                        {job.status === 'idle' && <CircleDashed className="w-4 h-4" />}
                                        {(job.status === 'transcoding' || job.status === 'uploading') && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                                        {job.status === 'completed' && <CheckCircle2 className="w-4 h-4" />}
                                        {job.status === 'error' && <AlertCircle className="w-4 h-4" />}
                                    </div>

                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-black text-white/90 truncate uppercase tracking-tighter">
                                            {job.filePath.split(/[\\\/]/).pop()}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <Target className="w-2.5 h-2.5 text-muted-foreground/40" />
                                            <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                                                {job.context?.shotId ? `Shot: ${job.context.shotId.slice(0, 8)}` : 'Wait for Context'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={() => onRemove?.(job.id)}
                                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-white/5 rounded-lg transition-all"
                                >
                                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                                </button>
                            </div>

                            {/* Progress bar */}
                            {(job.status !== 'idle' && job.status !== 'completed' && job.status !== 'error') && (
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-primary/60">
                                        <span>{job.status}...</span>
                                        <span>{job.progress}%</span>
                                    </div>
                                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${job.progress}%` }}
                                            className="h-full bg-primary"
                                        />
                                    </div>
                                </div>
                            )}

                            {job.error && (
                                <p className="text-[9px] font-black text-destructive/80 uppercase tracking-tight leading-relaxed italic">
                                    {job.error}
                                </p>
                            )}
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
