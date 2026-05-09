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

export function AppShell() {
    useOSNotifications()
    const [activeTab, setActiveTab] = useState<TabId>("quick-publish")

    return (
        <div className="flex h-screen w-full bg-[#121212] font-sans selection:bg-[#0096D6]/30 text-white overflow-hidden">
            <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onNavigateToQueue={() => setActiveTab("queue")} />

            <main className="flex-1 min-w-0 h-full relative overflow-hidden flex flex-col">
                <div className="flex-1 overflow-hidden relative">
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
    )
}
