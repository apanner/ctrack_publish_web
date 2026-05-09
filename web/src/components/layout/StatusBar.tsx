"use client"

import { useAuth } from "@/hooks/use-auth"
import { Database, Cloud, User as UserIcon, Wifi } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

export function StatusBar() {
    const { user, isAuthenticated } = useAuth()

    // In a real app, these would come from S3/Supabase health hooks
    const isS3Healthy = true
    const isDBHealthy = true

    return (
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/[0.06] bg-[#121212]/98 px-4 select-none backdrop-blur-sm sm:px-6">
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 group cursor-default">
                    <Database className={cn(
                        "w-3 h-3 transition-colors",
                        isDBHealthy ? "text-green-500" : "text-red-500"
                    )} />
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-400 group-hover:text-gray-300 transition-colors">
                        DB: {isDBHealthy ? "CONNECTED" : "OFFLINE"}
                    </span>
                    {isDBHealthy && (
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="w-1 h-1 rounded-full bg-green-500 animate-pulse"
                        />
                    )}
                </div>

                <div className="flex items-center gap-2 group cursor-default">
                    <Cloud className={cn(
                        "w-3 h-3 transition-colors",
                        isS3Healthy ? "text-[#0096D6]" : "text-red-500"
                    )} />
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-400 group-hover:text-gray-300 transition-colors">
                        S3: {isS3Healthy ? "READY" : "ERROR"}
                    </span>
                    {isS3Healthy && (
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="w-1 h-1 rounded-full bg-primary animate-pulse"
                        />
                    )}
                </div>
            </div>

            <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                    <Wifi className="w-3 h-3 text-gray-500" />
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Local Network</span>
                </div>

                <div className="h-4 w-px bg-[#404040]" />

                {isAuthenticated && user && (
                    <div className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-[#2A2A2A] border border-[#404040]">
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
