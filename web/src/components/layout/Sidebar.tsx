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
        <div className={cn("h-full w-[240px] shrink-0 border-r border-white/[0.06] bg-[#121212] flex flex-col", className)}>
            <div className="p-5 pb-4">
                <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">CTrack</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-lg font-semibold tracking-tight text-[#24E1B1]">Publisher</span>
                    </div>
                </div>
            </div>

            <Separator className="bg-white/[0.06] mx-4 w-auto" />

            <nav className="flex-1 space-y-1.5 px-3 py-6">
                {canCreateProject && (
                    <button
                        onClick={() => setWizardOpen(true)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 text-[#24E1B1] hover:bg-[#24E1B1]/10 border border-dashed border-[#24E1B1]/40"
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
                            "flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 group text-left",
                            activeTab === item.id
                                ? "bg-[#0096D6] text-white shadow-[0_4px_20px_rgba(0,150,214,0.25)]"
                                : "text-gray-400 hover:bg-white/[0.04] hover:text-white"
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

            <div className="p-4 mt-auto">
                <div className="rounded-xl p-3 border border-white/[0.06] bg-white/[0.02] shadow-inner">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 shrink-0 rounded-full bg-[#404040] flex items-center justify-center overflow-hidden">
                            {profile?.avatar_url ? (
                                <img src={profile.avatar_url} alt={profile.full_name} className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-5 h-5 text-gray-400" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate" title={profile?.full_name || undefined}>{profile?.full_name || "User"}</p>
                            <p className="text-xs text-gray-400 uppercase font-medium tracking-wide">{profile?.role || "Artist"}</p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2 hover:bg-red-500/10 hover:text-red-400 h-8 rounded-md text-gray-300"
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
