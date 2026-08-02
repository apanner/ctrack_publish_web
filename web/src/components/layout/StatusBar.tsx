"use client"

import type { ComponentType } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useEngineHealthContext } from "@/context/engine-health-context"
import { useEnginePairing } from "@/hooks/use-engine-pairing"
import { useEngineRelease } from "@/hooks/use-engine-release"
import {
    AlertTriangle,
    CheckCircle2,
    Cloud,
    Database,
    Link2,
    PlugZap,
    RefreshCw,
    Upload,
    User as UserIcon,
    Wifi
} from "lucide-react"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

interface StatusPillProps {
    icon: ComponentType<{ className?: string }>
    label: string
    value: string
    tone: "ok" | "warn" | "error" | "muted"
    title?: string
    isPulsing?: boolean
}

const toneClasses: Record<StatusPillProps["tone"], string> = {
    ok: "text-[#24E1B1]",
    warn: "text-amber-400",
    error: "text-red-400",
    muted: "text-gray-500",
}

function compareSemverVersion(left: string, right: string): number {
    const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0)
    const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0)
    const total = Math.max(leftParts.length, rightParts.length)
    for (let index = 0; index < total; index += 1) {
        const leftPart = leftParts[index] ?? 0
        const rightPart = rightParts[index] ?? 0
        if (leftPart > rightPart) return 1
        if (leftPart < rightPart) return -1
    }
    return 0
}

function StatusPill({ icon: Icon, label, value, tone, title, isPulsing = false }: StatusPillProps) {
    return (
        <div className="flex items-center gap-2 group cursor-default" title={title}>
            <Icon className={cn("w-3 h-3 transition-colors", toneClasses[tone])} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-gray-500 transition-colors group-hover:text-gray-300">
                {label}: <span className={toneClasses[tone]}>{value}</span>
            </span>
            {isPulsing && (
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={cn("w-1 h-1 rounded-full animate-pulse", tone === "ok" ? "bg-[#24E1B1]" : "bg-amber-400")}
                />
            )}
        </div>
    )
}

export function StatusBar() {
    const { user, isAuthenticated } = useAuth()
    const engineHealth = useEngineHealthContext()
    const shouldCheckPairing = isAuthenticated && engineHealth.isOnline
    const { pairStatusQuery } = useEnginePairing({ enabled: shouldCheckPairing })
    const latestReleaseQuery = useEngineRelease({ enabled: isAuthenticated })
    const localVersion = engineHealth.health?.version?.trim() ?? ""
    const latestVersion = latestReleaseQuery.data?.version?.trim() ?? ""
    const isUpdateAvailable = !!localVersion && !!latestVersion && compareSemverVersion(latestVersion, localVersion) > 0
    const dependencyTitle = engineHealth.missingDependencies.length > 0
        ? `Missing: ${engineHealth.missingDependencies.join(", ")}`
        : "Python modules and FFmpeg dependency check passed"
    const engineTitle = engineHealth.error
        ? `${engineHealth.engineBase} - ${engineHealth.error}`
        : `${engineHealth.engineBase}${engineHealth.lastCheckedAt ? ` - checked ${new Date(engineHealth.lastCheckedAt).toLocaleTimeString()}` : ""}`

    return (
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-white/[0.06] bg-[#06090d]/92 px-3 select-none backdrop-blur-xl sm:px-4">
            <div className="flex min-w-0 items-center gap-4">
                <StatusPill
                    icon={PlugZap}
                    label="Engine"
                    value={
                        engineHealth.isChecking
                            ? "Checking"
                            : engineHealth.isOnline
                              ? "Online"
                              : "Offline"
                    }
                    tone={
                        engineHealth.isChecking
                            ? "warn"
                            : engineHealth.isOnline
                              ? "ok"
                              : "error"
                    }
                    title={engineTitle}
                    isPulsing={engineHealth.isOnline || engineHealth.isChecking}
                />
                {engineHealth.isOnline ? (
                    <StatusPill
                        icon={Wifi}
                        label="Connection"
                        value={engineHealth.engineBase.replace(/^https?:\/\//, "")}
                        tone="ok"
                        title={`Connected to local engine${engineHealth.health?.version ? ` v${engineHealth.health.version}` : ""}`}
                        isPulsing
                    />
                ) : !engineHealth.isChecking ? (
                    <StatusPill
                        icon={Wifi}
                        label="Connection"
                        value="No engine"
                        tone="error"
                        title={engineHealth.offlineHelpText ?? `Expected engine at ${engineHealth.engineBase}`}
                    />
                ) : null}
                {!engineHealth.isOnline && !engineHealth.isChecking && engineHealth.offlineHelpText && (
                    <div
                        className="hidden items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300 lg:flex"
                        title={engineHealth.offlineHelpText}
                    >
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[320px]">{engineHealth.offlineHelpText}</span>
                    </div>
                )}
                {shouldCheckPairing && pairStatusQuery.data && !pairStatusQuery.data.paired && (
                    <div
                        className="hidden items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300 lg:flex"
                        title="This workstation is not paired to your account. Pairing enables secure installer updates."
                    >
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span>Not paired</span>
                    </div>
                )}
                {isAuthenticated && engineHealth.isOnline && isUpdateAvailable && (
                    <div
                        className="hidden items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-medium text-cyan-200 lg:flex"
                        title={`Update available: local v${localVersion} -> latest v${latestVersion}`}
                    >
                        <Upload className="h-3 w-3 shrink-0" />
                        <span>Update available (v{latestVersion})</span>
                    </div>
                )}
                <StatusPill
                    icon={Database}
                    label="Setup"
                    value={engineHealth.isSetupComplete ? "Ready" : "Needs Config"}
                    tone={engineHealth.isSetupComplete ? "ok" : "warn"}
                    title="Engine setup is complete when Supabase and storage env values are saved."
                />
                <StatusPill
                    icon={Cloud}
                    label="Python"
                    value={engineHealth.isPythonReady ? "Ready" : "Missing"}
                    tone={engineHealth.isPythonReady ? "ok" : "error"}
                    title={engineHealth.health?.engineRoot ? `Engine root: ${engineHealth.health.engineRoot}` : "Python sidecar not confirmed yet"}
                />
                <StatusPill
                    icon={engineHealth.areDependenciesReady ? CheckCircle2 : engineHealth.isChecking ? RefreshCw : AlertTriangle}
                    label="Deps"
                    value={engineHealth.areDependenciesReady ? "Ready" : engineHealth.isChecking ? "Checking" : `${engineHealth.missingDependencies.length} Missing`}
                    tone={engineHealth.areDependenciesReady ? "ok" : engineHealth.isChecking ? "warn" : "error"}
                    title={dependencyTitle}
                    isPulsing={engineHealth.isChecking}
                />
                {engineHealth.isOnline && (
                    <StatusPill
                        icon={CheckCircle2}
                        label="EXR"
                        value={engineHealth.activeExrBackend ?? "none"}
                        tone={engineHealth.activeExrBackend ? "ok" : "warn"}
                        title={
                            engineHealth.nukeInstallCount > 0
                                ? `Nuke installs: ${engineHealth.nukeInstallCount}. Order: Nuke → OIIO → FFmpeg`
                                : "No Nuke found; OIIO or FFmpeg will be used for EXR review"
                        }
                    />
                )}
            </div>

            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <Wifi className="w-3 h-3 text-gray-500" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-gray-500">Local Network</span>
                </div>

                <div className="h-4 w-px bg-[#404040]" />

                {isAuthenticated && user && (
                    <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1">
                        <UserIcon className="w-3 h-3 text-[#24E1B1]" />
                        <span className="text-xs font-medium text-gray-300 truncate max-w-[180px]">
                            {user.user_metadata?.full_name || user.email}
                        </span>
                    </div>
                )}
            </div>
        </div>
    )
}
