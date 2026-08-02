"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useEngineHealth, type EngineHealthState } from "@/hooks/use-engine-health"
import { useEngineConsoleLog } from "@/hooks/use-engine-console-log"

const EngineHealthContext = createContext<EngineHealthState | null>(null)

export function EngineHealthProvider({ children }: { children: ReactNode }) {
  const engineHealth = useEngineHealth()
  useEngineConsoleLog(engineHealth)
  return <EngineHealthContext.Provider value={engineHealth}>{children}</EngineHealthContext.Provider>
}

export function useEngineHealthContext(): EngineHealthState {
  const value = useContext(EngineHealthContext)
  if (!value) {
    throw new Error("useEngineHealthContext must be used within EngineHealthProvider")
  }
  return value
}
