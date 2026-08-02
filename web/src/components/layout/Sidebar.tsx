"use client"

import { useState } from "react"
import { Send, Layers, Activity, Settings, LogOut, User, PlusCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ProjectCreationWizard } from "@/components/project-creation-wizard/ProjectCreationWizard"
import { canOpenProjectCreationWizard } from "@/lib/publisher-permissions"

export type TabId = "quick-publish" | "bulk-ingest" | "queue" | "settings"

interface SidebarProps {
    activeTab: TabId
    setActiveTab: (tab: TabId) => void
    onNavigateToQueue?: () => void
    className?: string
}

export function Sidebar({ activeTab, setActiveTab, onNavigateToQueue, className }: SidebarProps) {
    const { profile, signOut } = useAuth()
    const [wizardOpen, setWizardOpen] = useState(false)
    const canCreateProject = canOpenProjectCreationWizard(profile?.role)

    const navItems = [
        {
            id: "quick-publish" as TabId,
            name: "Quick Publish",
            icon: Send,
        },
        {
            id: "bulk-ingest" as TabId,
            name: "Bulk Ingest",
            icon: Layers,
        },
        {
            id: "queue" as TabId,
            name: "Queue",
            icon: Activity,
        },
        {
            id: "settings" as TabId,
            name: "Settings",
            icon: Settings,
        },
    ]

    return (
        <div className={cn("relative z-20 mr-2 flex h-full w-[188px] shrink-0 flex-col rounded-2xl border border-white/[0.075] bg-[#070b10]/90 shadow-[18px_0_64px_rgba(0,0,0,0.32)] backdrop-blur-xl", className)}>
            <div className="p-3 pb-2">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-2.5">
                    <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg border border-[#24E1B1]/25 bg-[#0b1118] shadow-[0_0_20px_rgba(36,225,177,0.12)]">
                            <img src="/ctrack-icon.png" alt="CTrack" className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0">
                            <span className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">CTrack</span>
                            <span className="block truncate text-base font-semibold tracking-tight text-white">Publisher</span>
                        </div>
                    </div>
                </div>
            </div>

            <Separator className="mx-3 w-auto bg-white/[0.06]" />

            <nav className="flex-1 space-y-1 px-2.5 py-3">
                {canCreateProject && (
                    <button
                        onClick={() => setWizardOpen(true)}
                        className="mb-2.5 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-[#24E1B1]/35 bg-[#24E1B1]/[0.04] px-2.5 py-2 text-xs font-semibold text-[#24E1B1] transition-all duration-200 hover:border-[#24E1B1]/70 hover:bg-[#24E1B1]/10"
                    >
                        <PlusCircle className="h-4 w-4 shrink-0" />
                        Create Project
                    </button>
                )}
                {navItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={cn(
                            "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-all duration-200",
                            activeTab === item.id
                                ? "bg-gradient-to-r from-[#0096D6] to-[#24E1B1]/80 text-white shadow-[0_12px_32px_rgba(0,150,214,0.22)]"
                                : "text-slate-400 hover:bg-white/[0.055] hover:text-white"
                        )}
                    >
                        <item.icon className={cn(
                            "h-4 w-4 shrink-0 transition-colors",
                            activeTab === item.id ? "text-white" : "text-gray-400 group-hover:text-white"
                        )} />
                        {item.name}
                    </button>
                ))}
            </nav>

            <div className="mt-auto p-2.5">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-2.5 shadow-inner">
                    <div className="mb-2.5 flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06]">
                            {profile?.avatar_url ? (
                                <img src={profile.avatar_url} alt={profile.full_name} className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-5 h-5 text-gray-400" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="truncate text-xs font-semibold text-white" title={profile?.full_name || undefined}>{profile?.full_name || "User"}</p>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{profile?.role || "Artist"}</p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-full justify-start gap-2 rounded-lg text-gray-300 hover:bg-red-500/10 hover:text-red-400"
                        onClick={() => signOut()}
                    >
                        <LogOut className="h-4 w-4 shrink-0" />
                        <span className="text-xs font-medium">Sign Out</span>
                    </Button>
                </div>
            </div>
            <ProjectCreationWizard
                open={wizardOpen}
                onOpenChange={setWizardOpen}
                onNavigateToQueue={onNavigateToQueue}
            />
        </div>
    )
}
