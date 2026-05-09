"use client"

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useProjects, useEpisodes, useShots } from '@/hooks/use-ctrack-data'
import { Monitor, Tv, Clapperboard } from 'lucide-react'
import { useContextStore } from '@/hooks/use-context-store'
import { cn } from "@/lib/utils"

export function ContextBar({ onNavigateToQueue }: { onNavigateToQueue?: () => void } = {}) {
    const { projectId, setProjectId, episodeId, setEpisodeId, shotId, setShotId } = useContextStore()
    const { data: projects, isLoading: projectsLoading } = useProjects()
    const { data: episodes, isLoading: episodesLoading } = useEpisodes(projectId || undefined)
    const { data: shots, isLoading: shotsLoading } = useShots(projectId || undefined, episodeId || undefined)
    const selectedProjectObj = projects?.find(p => p.id === projectId)
    const selectedShotObj = shots?.find(s => s.id === shotId)

    return (
    <>
        <div className="w-full shrink-0 border-b border-white/[0.06] bg-[#141414]/95 backdrop-blur-sm">
            <div className="mx-auto flex max-w-[1320px] flex-col gap-4 px-4 py-3 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:gap-6 lg:px-8">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <div className="flex min-w-[min(100%,220px)] flex-1 flex-col gap-1.5 sm:max-w-[260px]">
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 flex items-center gap-1.5">
                        <Monitor className="w-3 h-3 text-[#24E1B1]" /> Project
                    </span>
                    <div className="flex items-center gap-2">
                        <Select
                            onValueChange={(id) => {
                                const p = projects?.find(x => x.id === id)
                                setProjectId(id, p?.code || null)
                            }}
                            value={projectId || ""}
                        >
                            <SelectTrigger className={cn(
                                "h-9 text-sm font-medium bg-[#0f0f0f] border-white/[0.08] text-white hover:border-white/15 flex-1 rounded-lg shadow-inner",
                                !projectId && "text-gray-400"
                            )}>
                                <SelectValue placeholder={projectsLoading ? "Loading..." : "Select Project..."} />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1a1a] border-white/[0.08] text-white">
                                {projects?.map(p => (
                                    <SelectItem key={p.id} value={p.id} className="text-sm text-white focus:bg-[#0096D6] focus:text-white">
                                        {p.name} <span className="text-xs text-gray-400 ml-2">[{p.code}]</span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {selectedProjectObj?.project_type === 'TV Episode' && (
                    <>
                        <div className="hidden h-8 w-px bg-white/[0.08] sm:block self-end mb-2" />
                        <div className="flex min-w-[min(100%,220px)] flex-1 flex-col gap-1.5 sm:max-w-[260px]">
                            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 flex items-center gap-1.5">
                                <Tv className="w-3 h-3 text-[#24E1B1]" /> Episode
                            </span>
                            <Select
                                disabled={!projectId || episodesLoading}
                                onValueChange={(id) => {
                                    if (id === "ALL_EPISODES") {
                                        setEpisodeId(null, null);
                                    } else {
                                        const ep = episodes?.find(x => x.id === id);
                                        setEpisodeId(id, ep?.code || null);
                                    }
                                }}
                                value={episodeId || "ALL_EPISODES"}
                            >
                                <SelectTrigger className={cn(
                                    "h-9 text-sm font-medium bg-[#0f0f0f] border-white/[0.08] text-white hover:border-white/15 rounded-lg shadow-inner",
                                    !episodeId && "text-gray-400"
                                )}>
                                    <SelectValue placeholder={episodesLoading ? "Loading..." : "Select Episode..."} />
                                </SelectTrigger>
                                <SelectContent className="bg-[#1a1a1a] border-white/[0.08] text-white">
                                    <SelectItem value="ALL_EPISODES" className="text-sm italic text-gray-400 focus:bg-[#0096D6] focus:text-white">
                                        All Episodes
                                    </SelectItem>
                                    {episodes?.map(e => (
                                        <SelectItem key={e.id} value={e.id} className="text-sm text-white focus:bg-[#0096D6] focus:text-white">
                                            {e.name} <span className="text-xs text-gray-400 ml-2">[{e.code}]</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </>
                )}

                <div className="hidden h-8 w-px bg-white/[0.08] sm:block self-end mb-2" />
                <div className="flex min-w-[min(100%,240px)] flex-[1.1] flex-col gap-1.5 sm:max-w-[280px]">
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500 flex items-center gap-1.5">
                        <Clapperboard className="w-3 h-3 text-[#24E1B1]" /> Shot
                    </span>
                    <Select
                        disabled={!projectId || shotsLoading}
                        onValueChange={(id) => {
                            const s = shots?.find(x => x.id === id)
                            // Handle Supabase join result which might be an array or object depending on types
                            const epResult = s?.episodes as any
                            const epCode = Array.isArray(epResult) ? epResult[0]?.code : epResult?.code
                            setShotId(id, s?.shot_code || null, s?.sequence_name || null, epCode || null, s?.episode_id || null)
                        }}
                        value={shotId || ""}
                    >
                        <SelectTrigger className={cn(
                            "h-9 text-sm font-medium bg-[#0f0f0f] border-white/[0.08] text-white hover:border-white/15 rounded-lg shadow-inner",
                            !shotId && "text-gray-400"
                        )}>
                            <SelectValue placeholder={shotsLoading ? "Loading..." : "Select Shot..."} />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a1a1a] border-white/[0.08] text-white max-h-[320px]">
                            {shots?.map(s => (
                                <SelectItem key={s.id} value={s.id} className="text-sm text-white focus:bg-[#0096D6] focus:text-white">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            {s.shot_code}
                                        </div>
                                        {s.sequence_name && <span className="text-xs text-gray-400">({s.sequence_name})</span>}
                                    </div>
                                </SelectItem>
                            ))}
                            {shots?.length === 0 && (
                                <div className="p-4 text-center text-sm text-gray-400">No shots found</div>
                            )}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            {projectId && shotId && (
                <div className="flex w-full min-w-0 shrink-0 lg:max-w-md lg:justify-end">
                    <div className="w-full rounded-xl border border-white/[0.08] bg-[#0a0a0a]/90 px-4 py-2.5 shadow-inner lg:w-auto">
                        <div className="flex flex-col min-w-0">
                            <span className="text-[9px] font-semibold text-[#24E1B1] uppercase tracking-wide">Context</span>
                            <span className="text-xs font-medium text-gray-300 truncate">
                                {selectedProjectObj?.code || "—"}
                                {useContextStore.getState().episodeCode && ` › ${useContextStore.getState().episodeCode}`}
                                {` › ${selectedShotObj?.shot_code || "—"}`}
                            </span>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    </>
    )
}
