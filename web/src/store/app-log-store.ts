import { create } from "zustand"

const MAX_ENTRIES = 100

export type LogLevel = "info" | "warn" | "error"

export interface LogEntry {
  id: string
  level: LogLevel
  message: string
  timestamp: string
}

interface AppLogState {
  entries: LogEntry[]
  addLog: (level: LogLevel, message: string) => void
  clear: () => void
}

export const useAppLogStore = create<AppLogState>((set) => ({
  entries: [],
  addLog: (level: LogLevel, message: string) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      message,
      timestamp: new Date().toISOString(),
    }
    set((state) => ({
      entries: [...state.entries, entry].slice(-MAX_ENTRIES),
    }))
  },
  clear: () => set({ entries: [] }),
}))
