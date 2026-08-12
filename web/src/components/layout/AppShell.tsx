"use client"

import { useState } from "react"
import { Sidebar, TabId } from "./Sidebar"
import { QuickPublishView } from "@/views/QuickPublishView"
import { BulkIngestView } from "@/views/BulkIngestView"
import { QueueView } from "@/views/QueueView"
import { SettingsView } from "@/views/SettingsView"
import { StatusBar } from "./StatusBar"
import { AppConsole } from "./AppConsole"
import { motion, AnimatePresence } from "framer-motion"
import { useOSNotifications } from "@/hooks/use-os-notifications"
import { HostedGatewayBanner } from "@/components/engine/HostedGatewayBanner"
import { EngineHealthProvider } from "@/context/engine-health-context"

export function AppShell() {
    useOSNotifications()
    const [activeTab, setActiveTab] = useState<TabId>("quick-publish")

    return (
        <EngineHealthProvider>
        <div className="relative flex h-screen w-full flex-col overflow-hidden bg-transparent font-sans text-white antialiased selection:bg-[#0096D6]/30">
            <HostedGatewayBanner />
            <div className="relative flex min-h-0 flex-1 overflow-hidden p-2">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.032)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:36px_36px] opacity-[0.18]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/[0.055] to-transparent" />
            <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onNavigateToQueue={() => setActiveTab("queue")} />

            <main className="relative z-10 flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.075] bg-[#081018]/68 shadow-[-18px_0_64px_rgba(0,0,0,0.3)] backdrop-blur-xl">
                <div className="relative flex-1 overflow-hidden">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 1.02 }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                            className="h-full w-full"
                        >
                            {activeTab === 'quick-publish' && <QuickPublishView onNavigateToQueue={() => setActiveTab('queue')} />}
                            {activeTab === 'bulk-ingest' && <BulkIngestView onNavigateToQueue={() => setActiveTab('queue')} />}
                            {activeTab === 'queue' && <QueueView />}
                            {activeTab === 'settings' && <SettingsView />}
                        </motion.div>
                    </AnimatePresence>
                </div>

                <AppConsole />
                <StatusBar />
            </main>
            </div>
        </div>
        </EngineHealthProvider>
    )
}
