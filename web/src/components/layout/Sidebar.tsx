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
        <div className={cn("h-full w-64 border-r border-[#404040] bg-[#1A1A1A] flex flex-col", className)}>
            <div className="p-5">
                <div className="flex items-center gap-2">
                    <span className="text-xl font-bold tracking-tight text-[#24E1B1]">CTrack</span>
                    <span className="text-xl font-bold tracking-tight text-gray-300">Publisher</span>
                </div>
            </div>

            <Separator className="bg-[#404040] mx-4 w-auto" />

            <nav className="flex-1 space-y-1.5 px-3 py-6">
                {canCreateProject && (
                    <button
                        onClick={() => setWizardOpen(true)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 text-[#24E1B1] hover:bg-[#2A2A2A] border border-dashed border-[#24E1B1]/50"
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
                            "flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 group",
                            activeTab === item.id
                                ? "bg-[#0096D6] text-white"
                                : "text-gray-400 hover:bg-[#2A2A2A] hover:text-white"
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
                <div className="bg-[#2A2A2A] rounded-lg p-4 border border-[#404040]">
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
